import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MeetingConnection } from "@/server/conference/connections";

/**
 * The Video calls bar: which account each provider is connected as, and the
 * disconnect that asks first (docs/features/meetings.md).
 */

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  disconnect: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/app/app/[orgSlug]/meetings/actions", () => ({
  disconnectMeetingProviderAction: mocks.disconnect,
}));

const { VideoConnections } = await import("./video-connections");

function connection(overrides: Partial<MeetingConnection>): MeetingConnection {
  return {
    provider: "ZOOM",
    slug: "zoom",
    label: "Zoom",
    connected: false,
    needsReauth: false,
    available: true,
    accountEmail: null,
    consoleUrl: "https://example.test",
    missingEnv: [],
    ...overrides,
  };
}

const CONNECTIONS = [
  connection({
    provider: "GOOGLE_MEET",
    slug: "google-meet",
    label: "Google Meet",
    connected: true,
    accountEmail: "club@example.org",
  }),
  connection({
    provider: "ZOOM",
    label: "Zoom",
    needsReauth: true,
    accountEmail: "zoom@example.org",
  }),
  connection({
    provider: "MICROSOFT_TEAMS",
    slug: "microsoft-teams",
    label: "Microsoft Teams",
  }),
];

function bar(canConnect = true) {
  return render(
    <VideoConnections orgId="org_1" connections={CONNECTIONS} canConnect={canConnect} />,
  );
}

beforeEach(() => {
  mocks.refresh.mockReset();
  mocks.disconnect.mockReset();
});
afterEach(() => cleanup());

describe("VideoConnections", () => {
  it("names the account on every connected or needs-reconnecting row, and only those", () => {
    bar();

    expect(screen.getByText("Connected as club@example.org")).toBeTruthy();
    expect(screen.getByText("Connected as zoom@example.org")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Disconnect Google Meet" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Disconnect Zoom" })).toBeTruthy();
    // Teams was never connected: it offers Connect and nothing to disconnect.
    expect(screen.queryByRole("button", { name: "Disconnect Microsoft Teams" })).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Disconnect / })).toHaveLength(2);
  });

  it("asks first, then disconnects, shows the message and refreshes", async () => {
    mocks.disconnect.mockResolvedValue({
      ok: true,
      message: "Disconnected. Access was revoked at Zoom.",
    });
    bar();

    fireEvent.click(screen.getByRole("button", { name: "Disconnect Zoom" }));

    // The question, in the words the plan gives it. Nothing has happened yet.
    expect(await screen.findByText("Disconnect Zoom?")).toBeTruthy();
    expect(
      screen.getByText(
        "Meetings already made keep their links. Changing or cancelling them won't reach Zoom until you connect again.",
      ),
    ).toBeTruthy();
    expect(mocks.disconnect).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));

    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(mocks.disconnect).toHaveBeenCalledWith("org_1", "ZOOM");
    expect((await screen.findByRole("status")).textContent).toBe(
      "Disconnected. Access was revoked at Zoom.",
    );
  });

  it("cancelling does nothing", async () => {
    bar();

    fireEvent.click(screen.getByRole("button", { name: "Disconnect Google Meet" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByText("Disconnect Google Meet?")).toBeNull());
    expect(mocks.disconnect).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("a refusal stays in the dialog and refreshes nothing", async () => {
    mocks.disconnect.mockResolvedValue({
      ok: false,
      message: "You don't have permission to do that.",
    });
    bar();

    fireEvent.click(screen.getByRole("button", { name: "Disconnect Zoom" }));
    fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "You don't have permission to do that.",
    );
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("someone who cannot connect cannot disconnect either", () => {
    bar(false);

    expect(
      (screen.getByRole("button", { name: "Disconnect Zoom" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("tells whoever runs the platform what an organization needs, in Meetings' words", () => {
    // Nothing switched on yet: the one case that explains itself in a sentence.
    render(
      <VideoConnections
        orgId="org_1"
        canConnect
        platformAdmin
        connections={CONNECTIONS.map((c) =>
          connection({ ...c, connected: false, needsReauth: false, available: false }),
        )}
      />,
    );

    const line = screen.getByText(/need an app with each provider/);
    expect(line.textContent).toContain("before any organization can connect them");
    expect(line.textContent).not.toMatch(/club/i);
  });
});
