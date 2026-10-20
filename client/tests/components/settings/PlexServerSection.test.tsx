import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { plexApi } from "@/api/plex";
import PlexServerSection from "@/components/settings/PlexServerSection";

vi.mock("@/api/plex", () => ({ plexApi: vi.fn() }));
vi.mock("@/components/auth/PlexSignIn", () => ({
  default: () => <button>Connect Plex owner account</button>,
}));
vi.mock("@/hooks/useConfirmDialog", () => ({
  useConfirmDialog: () => ({
    confirm: () => Promise.resolve(true),
    dialog: null,
  }),
}));
const request = vi.mocked(plexApi);
let enabled = true;
beforeEach(() => {
  enabled = true;
  request.mockReset();
  request.mockImplementation(async (path) => {
    await Promise.resolve();
    if (path === "/config") return { enabled };
    if (path === "/admin/connection")
      return {
        connected: true,
        ownerName: "owner",
        serverId: "server-1",
        serverName: "Mothership",
        lastSyncedAt: null,
        lastError: null,
        syncIntervalMinutes: 30,
      };
    if (path === "/admin/servers")
      return { servers: [{ id: "server-1", name: "Mothership" }] };
    return { imported: 2, members: 3 };
  });
});
describe("Plex server connection", () => {
  it("shows the owner and lets an administrator select and import a server", async () => {
    render(<PlexServerSection />);
    await screen.findByRole("option", { name: "Mothership" });
    fireEvent.click(
      screen.getByRole("button", { name: "Select server and import users" })
    );
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith("/admin/server", {
        serverId: "server-1",
      })
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "2 new inactive profiles"
    );
  });
  it("offers manual sync and describes the automatic schedule", async () => {
    render(<PlexServerSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Sync now" }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith("/admin/sync", {})
    );
    expect(
      screen.getByText(/Automatic sync every 30 minutes/)
    ).toBeInTheDocument();
  });
  it("requires confirmation before disconnect and surfaces sync failures", async () => {
    render(<PlexServerSection />);
    await screen.findByRole("option", { name: "Mothership" });
    request.mockRejectedValueOnce(
      new Error("Plex sync failed. Existing access settings were preserved.")
    );
    fireEvent.click(screen.getByRole("button", { name: "Sync now" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Existing access settings were preserved"
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Disconnect Plex" })
      ).not.toBeDisabled()
    );
    fireEvent.click(screen.getByRole("button", { name: "Disconnect Plex" }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith("/admin/disconnect", {})
    );
  });
  it("hides the connection UI while Plex authentication is disabled", async () => {
    enabled = false;
    render(<PlexServerSection />);
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith("/config", undefined, "GET")
    );
    expect(screen.queryByText("Plex server connection")).toBeNull();
  });
});
