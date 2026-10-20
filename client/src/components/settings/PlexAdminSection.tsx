import { useEffect, useState } from "react";
import type { PlexAdminResponse } from "@peek/shared-types/api/auth.js";
import { plexApi } from "../../api/plex";
import { Button, Paper } from "../ui/index";

export default function PlexAdminSection() {
  const [data, setData] = useState<PlexAdminResponse | null>(null);
  const [accountId, setAccountId] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async () =>
    setData(await plexApi<PlexAdminResponse>("/admin", undefined, "GET"));
  useEffect(() => {
    void load().catch(() => setMessage("Could not load Plex approvals."));
  }, []);
  const save = async (path: string, body: unknown) => {
    setBusy(true);
    setMessage("");
    try {
      await plexApi(path, body, "PUT");
      await load();
      setMessage("Saved.");
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if ((!data && !message) || (data && !data.enabled)) return null;
  return (
    <Paper className="mb-6">
      <Paper.Header>
        <Paper.Title>Plex approvals and account access</Paper.Title>
      </Paper.Header>
      <Paper.Body>
        <p className="mb-3">
          Only approved Plex IDs can sign in. An unapproved user sees their ID
          after verifying with Plex. New profiles receive standard user access.
        </p>
        <form
          className="flex gap-2 mb-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save("/admin/approval", {
              accountId: accountId.trim(),
              approved: true,
            });
          }}
        >
          <input
            aria-label="Plex account ID"
            required
            pattern="[1-9][0-9]{0,15}"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            placeholder="Plex account ID"
            className="p-2 rounded text-black bg-white"
          />
          <Button type="submit" disabled={busy}>
            Approve Plex ID
          </Button>
        </form>
        <ul className="space-y-2 mb-4">
          {data?.identities.map((identity) => (
            <li key={identity.accountId} className="flex items-center gap-3">
              <span>
                {identity.accountId} ·{" "}
                {identity.user?.username ?? "No profile yet"} ·{" "}
                {identity.approved ? "Approved" : "Revoked"}
              </span>
              <Button
                disabled={busy}
                onClick={() =>
                  void save("/admin/approval", {
                    accountId: identity.accountId,
                    approved: !identity.approved,
                  })
                }
              >
                {identity.approved ? "Revoke" : "Approve"}
              </Button>
            </li>
          ))}
        </ul>
        <details>
          <summary>Enable or disable Peek accounts</summary>
          <ul className="space-y-2 mt-3">
            {data?.users.map((user) => (
              <li key={user.id} className="flex items-center gap-3">
                <span>
                  {user.username} · {user.disabled ? "Disabled" : "Enabled"}
                </span>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void save("/admin/disabled", {
                      userId: user.id,
                      disabled: !user.disabled,
                    })
                  }
                >
                  {user.disabled ? "Enable" : "Disable"}
                </Button>
              </li>
            ))}
          </ul>
        </details>
        {message && (
          <p role="status" className="mt-3">
            {message}
          </p>
        )}
      </Paper.Body>
    </Paper>
  );
}
