import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MeetingConnection } from "@/server/conference/connections";

/**
 * The video-call menu in the meeting form (docs/features/meetings.md), and
 * above all what it does to the link when the provider changes: the old
 * provider's link must never ride along into a save for the new one.
 *
 * Each choice is a button in a radio group.
 */

vi.mock("@/app/app/[orgSlug]/meetings/actions", () => ({
  meetingConnectionsAction: vi.fn(async () => []),
}));
const { ConferencePicker } = await import("./conference-picker");

function connection(provider: string, label: string, connected = true): MeetingConnection {
  return {
    provider,
    slug: provider.toLowerCase(),
    label,
    connected,
    needsReauth: false,
    available: true,
    accountEmail: null,
    consoleUrl: "https://example.com",
    missingEnv: [],
  };
}

const CONNECTIONS = [
  connection("GOOGLE_MEET", "Google Meet"),
  connection("ZOOM", "Zoom"),
  connection("MICROSOFT_TEAMS", "Microsoft Teams"),
];

const ZOOM_LINK = "https://us02web.zoom.us/j/98765432100";

function picker(props: Partial<Parameters<typeof ConferencePicker>[0]> = {}) {
  const onProviderChange = vi.fn();
  const onUrlChange = vi.fn();
  render(
    <ConferencePicker
      connections={CONNECTIONS}
      provider="ZOOM"
      onProviderChange={onProviderChange}
      conferenceUrl={ZOOM_LINK}
      onUrlChange={onUrlChange}
      {...props}
    />,
  );
  return { onProviderChange, onUrlChange };
}

const item = (name: RegExp) => screen.getByRole("radio", { name });

afterEach(() => cleanup());

describe("ConferencePicker: the link when the provider changes", () => {
  it("drops the link we made when a meeting we made moves to another provider", () => {
    const { onProviderChange, onUrlChange } = picker({ managed: true });

    fireEvent.click(item(/Google Meet/));

    expect(onProviderChange).toHaveBeenCalledWith("MEET");
    expect(onUrlChange).toHaveBeenCalledWith("");
  });

  it("drops it when a meeting we made becomes a link to paste, so only the pasted one is saved", () => {
    const { onProviderChange, onUrlChange } = picker({ managed: true });

    fireEvent.click(item(/Paste link/));

    expect(onProviderChange).toHaveBeenCalledWith("OTHER");
    expect(onUrlChange).toHaveBeenCalledWith("");
  });

  it("drops it when the call is taken off", () => {
    const { onUrlChange } = picker({ managed: true });

    fireEvent.click(item(/None/));

    expect(onUrlChange).toHaveBeenCalledWith("");
  });

  it("drops a pasted link when a provider that makes its own is chosen", () => {
    const { onProviderChange, onUrlChange } = picker({
      provider: "OTHER",
      conferenceUrl: "https://example.com/room",
    });

    fireEvent.click(item(/^Zoom/));

    expect(onProviderChange).toHaveBeenCalledWith("ZOOM");
    expect(onUrlChange).toHaveBeenCalledWith("");
  });

  it("keeps the link when the same provider is picked again", () => {
    const { onUrlChange } = picker({ managed: true });

    fireEvent.click(item(/^Zoom/));

    expect(onUrlChange).not.toHaveBeenCalled();
  });
});
