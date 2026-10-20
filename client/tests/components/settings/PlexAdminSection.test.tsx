import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { plexApi } from "@/api/plex";
import PlexAdminSection from "@/components/settings/PlexAdminSection";

vi.mock("@/api/plex", () => ({ plexApi: vi.fn() }));
const request = vi.mocked(plexApi);
beforeEach(() => {
  request.mockReset();
  request.mockImplementation(async (_path, _body, method) => {
    await Promise.resolve();
    return method === "PUT"
      ? { success: true }
      : {
          enabled: true,
          identities: [
            {
              accountId: "12345",
              approved: true,
              userId: 2,
              user: { id: 2, username: "plex-user", disabled: false },
            },
          ],
          users: [{ id: 2, username: "plex-user", disabled: false }],
        };
  });
});
describe("Plex administration", () => {
  it("approves numeric account IDs", async () => {
    render(<PlexAdminSection />);
    fireEvent.change(await screen.findByLabelText("Plex account ID"), {
      target: { value: "54321" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Approve Plex ID" }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        "/admin/approval",
        { accountId: "54321", approved: true },
        "PUT"
      )
    );
  });
  it("revokes approval without deleting the profile", async () => {
    render(<PlexAdminSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Revoke" }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        "/admin/approval",
        { accountId: "12345", approved: false },
        "PUT"
      )
    );
  });
  it("shows failures from disabling accounts", async () => {
    render(<PlexAdminSection />);
    await screen.findByRole("button", { name: "Disable" });
    request.mockRejectedValueOnce(
      new Error("Keep a local administrator available for recovery")
    );
    fireEvent.click(screen.getByRole("button", { name: "Disable" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Keep a local administrator"
    );
  });
});
