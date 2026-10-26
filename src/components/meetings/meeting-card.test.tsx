import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConferenceStatus } from "@/lib/meetings/conference-status";
import { FORMAT_LABEL } from "@/lib/meetings/shape";

/**
 * One meeting on the Meetings list (docs/features/meetings.md): its shape, its
 * one-click join and copy, and the single link to its page.
 */

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  writeText: vi.fn(),
}));

vi.mock("@/components/ui/toaster", () => ({ toast: mocks.toast }));

const { MeetingCard } = await import("./meeting-card");

const JOIN = "https://us02web.zoom.us/j/98765432100?pwd=abc";
const HOST = "https://us02web.zoom.us/s/98765432100?zak=host-token";

type Props = Parameters<typeof MeetingCard>[0];
type Row = Props["event"];

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: "e1",
    title: "Exec sync",
    startsAt: new Date("2026-11-02T22:00:00Z"),
    endsAt: new Date("2026-11-02T23:00:00Z"),
    allDay: false,
    rsvpEnabled: false,
    rsvpSlug: null,
    rsvpCapacity: null,
    rsvpCover: null,
    kind: "BOARD_MEETING",
    format: "ONLINE",
    location: null,
    conferenceProvider: "ZOOM",
    conferenceManaged: true,
    conferenceUrl: JOIN,
    conferenceSyncState: "SYNCED",
    conferenceSyncError: null,
    ...overrides,
  };
}

function base(overrides: Partial<Props> = {}): Props {
  return {
    event: row(),
    canManage: false,
    status: { kind: "ready" },
    href: "/app/acme/meetings/e1",
    timeZone: "America/New_York",
    going: 0,
    waiting: 0,
    mine: null,
    ...overrides,
  };
}

function card(overrides: Partial<Props> = {}) {
  return render(
    <ul>
      <MeetingCard {...base(overrides)} />
    </ul>,
  );
}

beforeEach(() => {
  mocks.toast.mockReset();
  mocks.writeText.mockReset();
  mocks.writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: mocks.writeText },
    configurable: true,
  });
});
afterEach(() => cleanup());

describe("MeetingCard: the link to the meeting", () => {
  it("links the title to the meeting's page", () => {
    card();

    const title = screen.getByRole("link", { name: "Exec sync" });
    expect(title.getAttribute("href")).toBe("/app/acme/meetings/e1");
  });

  it("has no link inside a link and no button inside a link", () => {
    const { container } = card({
      event: row({ rsvpEnabled: true, rsvpSlug: "exec" }),
      canManage: true,
      going: 3,
    });

    expect(container.querySelectorAll("a a, a button").length).toBe(0);
  });

  it("keeps Join and Copy out of the title's link", () => {
    card();

    const title = screen.getByRole("link", { name: "Exec sync" });
    expect(title.contains(screen.getByRole("link", { name: "Join Exec sync" }))).toBe(false);
    expect(title.contains(screen.getByRole("button", { name: "Copy link for Exec sync" }))).toBe(
      false,
    );
  });
});

describe("MeetingCard: its shape", () => {
  it.each(["ONLINE", "IN_PERSON", "HYBRID"] as const)("shows the %s badge", (format) => {
    card({ event: row({ format }) });

    expect(screen.getByText(FORMAT_LABEL[format])).toBeTruthy();
  });

  it("shows a Sign-ups badge when the meeting takes sign-ups", () => {
    card({ event: row({ rsvpEnabled: true, rsvpSlug: "exec" }) });

    expect(screen.getByText("Sign-ups")).toBeTruthy();
  });

  it("shows no Sign-ups badge when it does not", () => {
    card({ event: row({ rsvpEnabled: false, rsvpSlug: null }) });

    expect(screen.queryByText("Sign-ups")).toBeNull();
  });

  it("says when a sign-up page exists but is turned off", () => {
    card({ event: row({ rsvpEnabled: false, rsvpSlug: "exec" }) });

    expect(screen.getByText("Sign-ups off")).toBeTruthy();
    expect(screen.queryByText("Sign-ups")).toBeNull();
  });

  it("shows where an in-person meeting is", () => {
    card({
      event: row({
        format: "IN_PERSON",
        location: "Curry 342",
        conferenceProvider: "NONE",
        conferenceUrl: null,
      }),
      status: { kind: "none" },
    });

    expect(screen.getByText("Curry 342")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /join/i })).toBeNull();
  });

  it("names the provider of an online meeting", () => {
    card({ event: row({ conferenceProvider: "TEAMS" }) });

    expect(screen.getByText("Microsoft Teams")).toBeTruthy();
  });

  it("does not repeat Online for a link someone pasted", () => {
    card({ event: row({ conferenceProvider: "OTHER", conferenceManaged: false }) });

    expect(screen.getAllByText("Online")).toHaveLength(1);
  });
});

describe("MeetingCard: joining and copying", () => {
  it("has a Join link to the call, in a new tab", () => {
    card();

    const join = screen.getByRole("link", { name: "Join Exec sync" });
    expect(join.getAttribute("href")).toBe(JOIN);
    expect(join.getAttribute("target")).toBe("_blank");
    expect(join.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("copies the link and says so", async () => {
    card();

    fireEvent.click(screen.getByRole("button", { name: "Copy link for Exec sync" }));

    await waitFor(() => expect(mocks.writeText).toHaveBeenCalledWith(JOIN));
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Link copied" })),
    );
  });

  it("says when the browser would not copy", async () => {
    mocks.writeText.mockRejectedValue(new Error("denied"));
    card();

    fireEvent.click(screen.getByRole("button", { name: "Copy link for Exec sync" }));

    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: expect.stringMatching(/couldn't copy/i), tone: "error" }),
      ),
    );
    expect(mocks.toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Link copied" }));
  });

  it("still reads Join and Copy link, and names each for its meeting", () => {
    card();

    const join = screen.getByRole("link", { name: "Join Exec sync" });
    expect(join.textContent).toBe("Join");
    const copy = screen.getByRole("button", { name: "Copy link for Exec sync" });
    expect(copy.textContent).toBe("Copy link");
  });

  it("names them apart on a list of cards", () => {
    render(
      <ul>
        <MeetingCard {...base({ event: row({ id: "e1", title: "Exec sync" }) })} />
        <MeetingCard {...base({ event: row({ id: "e2", title: "Design review" }) })} />
      </ul>,
    );

    expect(screen.getByRole("link", { name: "Join Exec sync" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Join Design review" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy link for Exec sync" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy link for Design review" })).toBeTruthy();
  });

  it("a past meeting has no Join or Copy link", () => {
    card({ past: true });

    expect(screen.queryByRole("link", { name: /join/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /copy link/i })).toBeNull();
    // It is still a card for the meeting.
    expect(screen.getByRole("link", { name: "Exec sync" }).getAttribute("href")).toBe(
      "/app/acme/meetings/e1",
    );
  });

  it("offers neither while there is no link", () => {
    card({
      event: row({ conferenceUrl: null, conferenceSyncState: "PENDING" }),
      status: { kind: "pending", line: "Getting the Zoom link…" },
    });

    expect(screen.queryByRole("link", { name: /join/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /copy link/i })).toBeNull();
  });
});

describe("MeetingCard: while the link is made, and when that fails", () => {
  it("says the link is on its way", () => {
    card({
      event: row({ conferenceUrl: null, conferenceSyncState: "PENDING" }),
      status: { kind: "pending", line: "Getting the Zoom link…" },
    });

    expect(screen.getByText("Getting the Zoom link…")).toBeTruthy();
  });

  it("shows a failed status's line", () => {
    const failed: ConferenceStatus = {
      kind: "failed",
      line: "Couldn't make the Zoom meeting.",
      reason: "Zoom needs to be reconnected from Meetings.",
    };
    card({
      event: row({ conferenceUrl: null, conferenceSyncState: "FAILED" }),
      status: failed,
      canManage: true,
    });

    expect(screen.getByText("Couldn't make the Zoom meeting.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /join/i })).toBeNull();
  });

  it("keeps the old link a failed update left behind", () => {
    card({
      event: row({ conferenceSyncState: "FAILED" }),
      status: { kind: "failed", line: "Couldn't make the Zoom meeting.", reason: null },
    });

    expect(screen.getByText("Couldn't make the Zoom meeting.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Join Exec sync" }).getAttribute("href")).toBe(JOIN);
  });
});

describe("MeetingCard: the host's link", () => {
  it("is never rendered, even if the row somehow carries it", () => {
    const leaky = { ...row(), conferenceHostUrl: HOST } as unknown as Row;
    const { container } = card({ event: leaky, canManage: true });

    expect(container.innerHTML).not.toContain(HOST);
    expect(container.innerHTML).not.toContain("zak=");
    expect(container.querySelector(`a[href="${HOST}"]`)).toBeNull();
    expect(screen.queryByText(/start as host/i)).toBeNull();
  });
});

describe("MeetingCard: sign-ups on the right", () => {
  it("shows hosts the head count", () => {
    card({
      event: row({ rsvpEnabled: true, rsvpSlug: "exec", rsvpCapacity: 20 }),
      canManage: true,
      going: 7,
      waiting: 2,
    });

    // "7" and " of 20 going · 2 waitlisted" are sibling spans.
    expect(screen.getByText(/going/).parentElement?.textContent).toBe(
      "7 of 20 going · 2 waitlisted",
    );
  });

  it("offers hosts a sign-up page when there is none", () => {
    card({ canManage: true });

    expect(screen.getByText("No sign-up page")).toBeTruthy();
  });

  it("tells a member they are going", () => {
    card({ event: row({ rsvpEnabled: true, rsvpSlug: "exec" }), mine: "GOING" });

    expect(screen.getByText("You're going")).toBeTruthy();
  });

  it("tells a member they are waitlisted", () => {
    card({ event: row({ rsvpEnabled: true, rsvpSlug: "exec" }), mine: "WAITLIST" });

    expect(screen.getByText("On the waitlist")).toBeTruthy();
  });

  it("invites a member who has not signed up to RSVP", () => {
    card({ event: row({ rsvpEnabled: true, rsvpSlug: "exec" }), mine: null });

    expect(screen.getByText("RSVP")).toBeTruthy();
  });
});

describe("MeetingCard: the featured card", () => {
  it("says it is next up, and is still one card", () => {
    card({ featured: true });

    const item = screen.getByText("Next up").closest("li") as HTMLElement;
    expect(within(item).getByRole("link", { name: "Exec sync" })).toBeTruthy();
  });
});
