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
    // Two hours before the meeting in row().
    now: new Date("2026-11-02T20:00:00Z"),
    going: 0,
    waiting: 0,
    mine: null,
    myRsvp: null,
    crowd: null,
    ...overrides,
  };
}

const COVER = { key: "k", s480: "/covers/k-480.webp", s960: "/covers/k-960.webp" };

const ADA = { id: "u1", name: "Ada Lovelace", image: null, avatar: null };
const GRACE = { id: "u2", name: "Grace Hopper", image: null, avatar: null };

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

  it("has none with everything on it: a picture, the faces and your answer", () => {
    const { container } = card({
      event: row({ rsvpEnabled: true, rsvpSlug: "exec", rsvpCover: COVER }),
      canManage: true,
      featured: true,
      going: 3,
      myRsvp: "YES",
      crowd: { faces: [ADA, GRACE], going: 2, maybe: 0, awaited: 0, invited: 2 },
    });

    expect(container.querySelectorAll("a a, a button").length).toBe(0);
    // Your answer sits beside the title, not inside its link.
    expect(screen.getByRole("link", { name: "Exec sync" }).textContent).toBe("Exec sync");
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

  it("says nothing about sign-ups on a meeting without a sign-up page", () => {
    card({ canManage: true });

    expect(screen.queryByText("No sign-up page")).toBeNull();
    expect(screen.queryByText(/going/)).toBeNull();
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

describe("MeetingCard: a long title", () => {
  // jsdom has no CSS, so this pins the classes. `line-clamp-2` only cuts at two
  // lines on a -webkit-box, and `block` after it in the stylesheet would turn
  // that back into a plain block and let a long title stretch the card.
  it("is cut at two lines: line-clamp-2, and no class that would override its display", () => {
    card();

    const title = screen.getByRole("link", { name: "Exec sync" });
    expect(title.classList.contains("line-clamp-2")).toBe(true);
    expect(title.classList.contains("block")).toBe(false);
  });

  it("keeps the stretched-link overlay", () => {
    card();

    expect(screen.getByRole("link", { name: "Exec sync" }).classList).toContain("after:absolute");
    expect(screen.getByRole("link", { name: "Exec sync" }).classList).toContain("after:inset-0");
  });

  it("is a block box on the featured card, which does not clamp", () => {
    card({ featured: true });

    const title = screen.getByRole("link", { name: "Exec sync" });
    expect(title.classList.contains("block")).toBe(true);
    expect(title.classList.contains("line-clamp-2")).toBe(false);
  });
});

describe("MeetingCard: the featured card", () => {
  it("says it is next up, and is still one card", () => {
    card({ featured: true });

    const item = screen.getByText("Next up").closest("li") as HTMLElement;
    expect(within(item).getByRole("link", { name: "Exec sync" })).toBeTruthy();
  });

  it("says next up on a featured card with a picture", () => {
    card({ featured: true, event: row({ rsvpCover: COVER }) });

    expect(screen.getByText("Next up")).toBeTruthy();
  });

  it("says next up on the first card even when it is not wide", () => {
    card({ first: true });

    expect(screen.getByText("Next up")).toBeTruthy();
  });

  it("says nothing of the kind on the others", () => {
    card();

    expect(screen.queryByText("Next up")).toBeNull();
  });
});

describe("MeetingCard: its picture", () => {
  it("shows the sign-up picture when there is one", () => {
    const { container } = card({ event: row({ rsvpCover: COVER }) });

    expect(container.querySelector("img")?.getAttribute("src")).toBe(COVER.s960);
  });

  it("shows no placeholder when there is none, and leads with the date and how soon", () => {
    const { container } = card();

    expect(container.querySelector("img")).toBeNull();
    // No big first letter standing in for a picture.
    expect(screen.queryByText("E")).toBeNull();
    // The date leaf (Nov 2, in New York) and the time to go.
    expect(screen.getByText("Nov")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("in 2 hours")).toBeTruthy();
  });

  it("says nothing about how soon once a meeting has started", () => {
    card({ now: new Date("2026-11-02T22:30:00Z") });

    expect(screen.queryByText(/^in /)).toBeNull();
    expect(screen.queryByText("under way")).toBeNull();
  });
});

describe("MeetingCard: who is coming", () => {
  it("shows the faces of the people going, and the numbers", () => {
    card({
      crowd: { faces: [ADA, GRACE], going: 2, maybe: 1, awaited: 1, invited: 4 },
    });

    expect(screen.getByText("AL")).toBeTruthy();
    expect(screen.getByText("GH")).toBeTruthy();
    expect(screen.getByText("2 going · 1 maybe · 1 yet to answer")).toBeTruthy();
  });

  it("says how many were asked before anyone has said yes", () => {
    card({ crowd: { faces: [ADA, GRACE], going: 0, maybe: 0, awaited: 2, invited: 2 } });

    expect(screen.getByText("2 invited")).toBeTruthy();
  });

  it("leaves the row out when nobody was invited", () => {
    card({ crowd: null });

    expect(screen.queryByText(/invited|going/)).toBeNull();
  });
});

describe("MeetingCard: your own answer", () => {
  it("says you're going when you said yes", () => {
    card({ myRsvp: "YES" });

    expect(screen.getByText("You're going")).toBeTruthy();
  });

  it("says you said maybe", () => {
    card({ myRsvp: "MAYBE" });

    expect(screen.getByText("You said maybe")).toBeTruthy();
  });

  it("says nothing while you have not answered, or said no", () => {
    for (const myRsvp of ["PENDING", "NO", null] as const) {
      const { unmount } = card({ myRsvp });
      expect(screen.queryByText("You're going")).toBeNull();
      expect(screen.queryByText("You said maybe")).toBeNull();
      unmount();
    }
  });
});
