import { AppError } from "../middleware/errorHandler.js";

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
export async function plexRequest(
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
