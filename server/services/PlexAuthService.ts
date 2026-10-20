import { createHash, randomBytes } from "crypto";
import { AppError } from "../middleware/errorHandler.js";
import prisma from "../prisma/singleton.js";
import { dbWriteTransaction } from "../utils/dbWrite.js";

const FLOW_TTL = 10 * 60 * 1000;
const MAX_PENDING = 500;
const POLL_INTERVAL = 2000;
interface Pending {
  pinId: number;
  code: string;
  binding: string;
  expires: number;
  nextPoll: number;
  busy: boolean;
  linkUserId: number | undefined;
}
const pending = new Map<string, Pending>();
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export function plexConfig() {
  if (process.env.PLEX_AUTH_ENABLED !== "true") return null;
  const clientId = process.env.PLEX_CLIENT_IDENTIFIER?.trim();
  const publicUrl = process.env.PLEX_PUBLIC_URL?.trim();
  if (!clientId || !publicUrl)
    throw new Error("Plex requires PLEX_CLIENT_IDENTIFIER and PLEX_PUBLIC_URL");
  const url = new URL(publicUrl);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname)
      ))
  ) {
    throw new Error(
      "PLEX_PUBLIC_URL must be an HTTPS origin (HTTP localhost is allowed for development)"
    );
  }
  if (url.protocol === "https:" && process.env.SECURE_COOKIES !== "true") {
    throw new Error("Plex HTTPS deployments require SECURE_COOKIES=true");
  }
  return {
    clientId,
    origin: url.origin,
    product: process.env.PLEX_PRODUCT?.trim() ?? "Peek Stash Browser",
  };
}

function config() {
  const value = plexConfig();
  if (!value) throw new AppError("Plex sign-in is disabled", 404);
  return value;
}

// Fixed upstream only. Never expose upstream bodies, tokens or fetch errors.
async function plexRequest(
  path: string,
  options: { method?: string; body?: URLSearchParams; token?: string } = {}
) {
  const { clientId, product } = config();
  try {
    const response = await fetch(`https://plex.tv/api/v2/${path}`, {
      method: options.method ?? "GET",
      headers: {
        Accept: "application/json",
        "X-Plex-Client-Identifier": clientId,
        "X-Plex-Product": product,
        ...(options.body
          ? { "Content-Type": "application/x-www-form-urlencoded" }
          : {}),
        ...(options.token ? { "X-Plex-Token": options.token } : {}),
      },
      ...(options.body ? { body: options.body } : {}),
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error("upstream refused");
    return (await response.json()) as Record<string, unknown>;
  } catch {
    throw new AppError("Plex verification failed. Please start again.", 502);
  }
}

export async function startPlexFlow(binding: string, linkUserId?: number) {
  const settings = config();
  for (const [key, flow] of pending) {
    if (flow.expires <= Date.now()) pending.delete(key);
  }
  if (pending.size >= MAX_PENDING)
    throw new AppError("Too many pending sign-ins. Try again later.", 503);
  const pin = await plexRequest("pins", {
    method: "POST",
    body: new URLSearchParams({ strong: "true" }),
  });
  if (
    !Number.isSafeInteger(pin.id) ||
    typeof pin.code !== "string" ||
    !pin.code
  ) {
    throw new AppError("Plex returned an invalid PIN", 502);
  }
  const id = randomBytes(32).toString("base64url");
  // Other starts may have finished while Plex was answering.
  if (pending.size >= MAX_PENDING)
    throw new AppError("Too many pending sign-ins. Try again later.", 503);
  const upstreamExpiry =
    typeof pin.expiresAt === "string"
      ? Date.parse(pin.expiresAt)
      : Date.now() + FLOW_TTL;
  const expires = Math.min(
    Date.now() + FLOW_TTL,
    Number.isFinite(upstreamExpiry) ? upstreamExpiry : Date.now() + FLOW_TTL
  );
  pending.set(id, {
    pinId: pin.id as number,
    code: pin.code,
    binding: hash(binding),
    expires,
    nextPoll: 0,
    busy: false,
    linkUserId,
  });
  const params = new URLSearchParams({
    clientID: settings.clientId,
    code: pin.code,
    "context[device][product]": settings.product,
  });
  return {
    correlationId: id,
    authorizationUrl: `https://app.plex.tv/auth#?${params}`,
    expiresAt: new Date(expires).toISOString(),
  };
}

function flowFor(id: string, binding: string) {
  const flow = pending.get(id);
  if (!flow || flow.binding !== hash(binding))
    throw new AppError("Invalid or completed sign-in", 400);
  if (flow.expires <= Date.now()) {
    pending.delete(id);
    throw new AppError("Plex sign-in expired. Please start again.", 410);
  }
  return flow;
}

export function cancelPlexFlow(id: string, binding: string) {
  flowFor(id, binding);
  pending.delete(id);
}

export async function pollPlexFlow(
  id: string,
  binding: string,
  authenticatedUserId?: number
) {
  config();
  const flow = flowFor(id, binding);
  if (
    flow.linkUserId !== undefined &&
    flow.linkUserId !== authenticatedUserId
  ) {
    throw new AppError(
      "Sign in to the original local account to link Plex",
      403
    );
  }
  if (flow.busy || flow.nextPoll > Date.now())
    return { status: "pending" as const };
  flow.busy = true;
  flow.nextPoll = Date.now() + POLL_INTERVAL;
  try {
    const pin = await plexRequest(
      `pins/${flow.pinId}?${new URLSearchParams({ code: flow.code })}`
    );
    if (pin.authToken == null) return { status: "pending" as const };
    if (typeof pin.authToken !== "string" || !pin.authToken)
      throw new AppError("Plex token validation failed", 502);
    const account = await plexRequest("user", { token: pin.authToken });
    if (!Number.isSafeInteger(account.id) || (account.id as number) <= 0)
      throw new AppError("Plex account validation failed", 502);
    const accountId = String(account.id);
    const user = await dbWriteTransaction("plex-login", async (tx) => {
      // Check again inside the writer queue, so cancellation while waiting wins.
      flowFor(id, binding);
      const identity = await tx.plexIdentity.findUnique({
        where: { accountId },
        include: { user: true },
      });
      if (!identity?.approved)
        throw new AppError(
          `Plex account ${accountId} is not approved. Ask your Peek administrator to approve this ID.`,
          403
        );
      if (flow.linkUserId !== undefined) {
        const local = await tx.user.findUnique({
          where: { id: flow.linkUserId },
          include: { plexIdentity: true },
        });
        if (
          !local ||
          local.disabled ||
          local.plexOnly ||
          local.plexIdentity ||
          (identity.userId !== null && identity.userId !== local.id)
        ) {
          throw new AppError(
            "This account cannot be linked. Contact your administrator.",
            409
          );
        }
        await tx.plexIdentity.update({
          where: { accountId },
          data: { userId: local.id },
        });
        return local;
      }
      if (identity.user) {
        if (identity.user.disabled)
          throw new AppError("Account is disabled", 403);
        return identity.user;
      }
      // Random suffix avoids collisions with local names. No username/email matching.
      const created = await tx.user.create({
        data: {
          username: `plex-${accountId}-${randomBytes(6).toString("hex")}`,
          password: "!plex-only",
          plexOnly: true,
          role: "USER",
        },
      });
      await tx.plexIdentity.update({
        where: { accountId },
        data: { userId: created.id },
      });
      return created;
    });
    flowFor(id, binding);
    pending.delete(id);
    return {
      status: "complete" as const,
      user,
      accountId,
      linked: flow.linkUserId !== undefined,
    };
  } catch (error) {
    pending.delete(id);
    throw error;
  } finally {
    flow.busy = false;
  }
}

/** Used by every authentication path, including signed media. */
export async function plexAccessAllowed(
  userId: number,
  plexSession = false,
  linkedMedia = false
): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { disabled: true, plexOnly: true, plexIdentity: true },
  });
  if (!user || user.disabled) return false;
  return (
    !(user.plexOnly || plexSession || (linkedMedia && user.plexIdentity)) ||
    (process.env.PLEX_AUTH_ENABLED === "true" &&
      user.plexIdentity?.approved === true)
  );
}
