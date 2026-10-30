import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Meetings list (docs/features/meetings.md): where each card goes, what
 * its video call says, and above all what the list loads, since the host's
 * start link must never reach someone without `events.write`.
 *
 * The cards are stubs. The page returns an element tree and these cases read
 * the props it handed each card.
 */

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  findMany: vi.fn(),
  groupBy: vi.fn(),
  attendees: vi.fn(),
  registrations: vi.fn(),
  connections: vi.fn(),
  members: vi.fn(),
  Card: () => null,
  NewButton: () => null,
}));

vi.mock("@/server/db/context", () => ({
  getOrgContextBySlug: mocks.context,
  withOrgTx: async (_orgId: string, fn: (ctx: unknown) => unknown) =>
    fn({
      db: {
        event: { findMany: mocks.findMany },
        eventRegistration: { groupBy: mocks.groupBy },
        eventAttendee: { findMany: mocks.attendees },
      },
    }),
}));
vi.mock("@/server/rsvp/my-registrations", () => ({ myRsvpRegistrations: mocks.registrations }));
vi.mock("@/server/conference/connections", () => ({ loadMeetingConnections: mocks.connections }));
vi.mock("@/server/conference/connect", () => ({ CONFERENCE_CALLBACK_MESSAGES: {} }));
vi.mock("@/lib/auth/email-verification", () => ({ getUserIdentity: async () => null }));
vi.mock("@/lib/auth/org-creation", () => ({ isPlatformAdmin: () => false }));
vi.mock("@/components/meetings/meeting-card", () => ({
  MeetingCard: mocks.Card,
  Cover: () => null,
  listWhen: () => "",
}));
vi.mock("@/components/meetings/video-connections", () => ({ VideoConnections: () => null }));
vi.mock("@/components/meetings/new-meeting-button", () => ({ NewMeetingButton: mocks.NewButton }));
vi.mock("@/server/members", () => ({
  getOrgMembersForPicker: mocks.members,
  userPublicSelect: { id: true, name: true, image: true, avatar: true },
}));

const { default: MeetingsPage } = await import("./page");

const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
const FUTURE_END = new Date(FUTURE.getTime() + 60 * 60 * 1000);

function stored(overrides: Record<string, unknown> = {}) {
  return {
    id: "e1",
    title: "Exec sync",
    startsAt: FUTURE,
    endsAt: FUTURE_END,
    allDay: false,
    rsvpEnabled: false,
    rsvpSlug: null,
    rsvpCapacity: null,
    rsvpCover: null,
    kind: "BOARD_MEETING",
    format: "ONLINE",
    location: null,
    meetingType: null,
    hostUserId: null,
    featured: false,
    conferenceProvider: "ZOOM",
    conferenceManaged: true,
    conferenceUrl: "https://us02web.zoom.us/j/98765432100",
    conferenceSyncState: "SYNCED",
    conferenceSyncError: null,
    ...overrides,
  };
}

function signIn(
  role: "OWNER" | "ADMIN" | "MEMBER",
  settings: {
    meetingReminderMinutes?: number[];
    eventTypes?: { name: string; color: string }[];
  } | null = null,
) {
  mocks.context.mockResolvedValue({
    organization: { id: "org_1", kind: "CLUB", timezone: "America/New_York" },
    user: { id: "user_1" },
    role,
    settings,
  });
}

/**
 * The props of every element of `type`, wherever the page put it: in its
 * children, or in a prop that takes an element (the header's actions).
 */
function propsOf(node: ReactNode, type: unknown): Record<string, unknown>[] {
  if (Array.isArray(node)) return node.flatMap((child) => propsOf(child, type));
  if (!isValidElement(node)) return [];
  const el = node as ReactElement<Record<string, ReactNode>>;
  const own = el.type === type ? [el.props as Record<string, unknown>] : [];
  return [...own, ...Object.values(el.props).flatMap((value) => propsOf(value, type))];
}

async function render(search: Record<string, string | string[]> = {}) {
  return MeetingsPage({
    params: Promise.resolve({ orgSlug: "club" }),
    searchParams: Promise.resolve(search),
  } as unknown as PageProps<"/app/[orgSlug]/meetings">);
}

/** Every MeetingCard's props. */
async function cards(search: Record<string, string | string[]> = {}) {
  return propsOf(await render(search), mocks.Card);
}

/** Every New meeting button's props, header first. */
async function newButtons(search: Record<string, string | string[]> = {}) {
  return propsOf(await render(search), mocks.NewButton);
}

beforeEach(() => {
  vi.clearAllMocks();
  signIn("ADMIN");
  mocks.findMany.mockResolvedValue([stored()]);
  mocks.groupBy.mockResolvedValue([]);
  mocks.attendees.mockResolvedValue([]);
  mocks.registrations.mockResolvedValue([]);
  mocks.connections.mockResolvedValue([]);
  mocks.members.mockResolvedValue([]);
});

describe("the Meetings list: what it loads", () => {
  it("never loads the host's start link", async () => {
    await cards();

    const { select } = mocks.findMany.mock.calls[0]![0] as { select: Record<string, boolean> };
    expect(Object.keys(select)).not.toContain("conferenceHostUrl");
    // What the card's status needs, and nothing that starts the call as host.
    expect(select.conferenceManaged).toBe(true);
    expect(select.conferenceSyncError).toBe(true);
  });

  it("loads the same fields for a member", async () => {
    signIn("MEMBER");

    await cards();

    const { select } = mocks.findMany.mock.calls[0]![0] as { select: Record<string, boolean> };
    expect(Object.keys(select)).not.toContain("conferenceHostUrl");
  });
});

describe("the Meetings list: where a card goes", () => {
  it("sends a host to the meeting's page, not its sign-up manager", async () => {
    mocks.findMany.mockResolvedValue([stored({ rsvpEnabled: true, rsvpSlug: "exec" })]);

    const [card] = await cards();

    expect(card?.href).toBe("/app/club/meetings/e1");
  });

  it("sends a member to the meeting's page, not the public page or the Calendar", async () => {
    signIn("MEMBER");
    mocks.findMany.mockResolvedValue([
      stored({ id: "e1", rsvpEnabled: true, rsvpSlug: "exec" }),
      stored({ id: "e2", rsvpEnabled: false, rsvpSlug: null }),
    ]);

    const found = await cards();

    expect(found.map((c) => c.href)).toEqual(["/app/club/meetings/e1", "/app/club/meetings/e2"]);
  });
});

describe("the Meetings list: what each card says about its call", () => {
  const failed = stored({
    conferenceUrl: null,
    conferenceSyncState: "FAILED",
    conferenceSyncError: "Zoom needs to be reconnected from Meetings.",
  });

  it("says the link is on its way for a call still being made", async () => {
    mocks.findMany.mockResolvedValue([
      stored({ conferenceUrl: null, conferenceSyncState: "PENDING" }),
    ]);

    const [card] = await cards();

    expect(card?.status).toEqual({ kind: "pending", line: "Getting the Zoom link…" });
  });

  it("gives a host the reason a call failed", async () => {
    mocks.findMany.mockResolvedValue([failed]);

    const [card] = await cards();

    expect(card?.canManage).toBe(true);
    expect(card?.status).toEqual({
      kind: "failed",
      line: "Couldn't make the Zoom meeting.",
      reason: "Zoom needs to be reconnected from Meetings.",
    });
  });

  it("keeps the reason from a member", async () => {
    signIn("MEMBER");
    mocks.findMany.mockResolvedValue([{ ...failed, rsvpEnabled: true }]);

    const [card] = await cards();

    expect(card?.canManage).toBe(false);
    expect(card?.status).toEqual({
      kind: "failed",
      line: "Couldn't make the Zoom meeting.",
      reason: null,
    });
    // Nor does the stored error ride along on the row it was read from.
    expect(JSON.stringify(card)).not.toContain("reconnected");
  });
});

describe("the Meetings list: meetings that are over", () => {
  it("marks the Past list's cards, and only those, as past", async () => {
    const lastWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    mocks.findMany.mockResolvedValue([
      stored({
        id: "old",
        startsAt: lastWeek,
        endsAt: new Date(lastWeek.getTime() + 60 * 60 * 1000),
      }),
      stored({ id: "soon" }),
    ]);

    const found = await cards();

    const pastOf = (id: string) => found.find((c) => (c.event as { id: string }).id === id)?.past;
    expect(pastOf("old")).toBe(true);
    expect(pastOf("soon")).toBe(false);
  });
});

describe("the Meetings list: sign-ups on the card", () => {
  it("hands a host the head count and a member their own ticket", async () => {
    mocks.findMany.mockResolvedValue([stored({ rsvpEnabled: true, rsvpSlug: "exec" })]);
    mocks.groupBy.mockResolvedValue([
      { eventId: "e1", status: "GOING", _count: { _all: 4 } },
      { eventId: "e1", status: "WAITLIST", _count: { _all: 1 } },
    ]);

    const [host] = await cards();
    expect(host).toMatchObject({ going: 4, waiting: 1, mine: null });

    signIn("MEMBER");
    mocks.registrations.mockResolvedValue([{ eventId: "e1", status: "WAITLIST" }]);

    const [member] = await cards();
    expect(member).toMatchObject({ going: 0, waiting: 0, mine: "WAITLIST" });
  });
});

describe("the Meetings list: who is coming", () => {
  const person = (id: string) => ({ id, name: id, image: null, avatar: null });

  it("reads this organization's invitees of the listed meetings, and no email", async () => {
    mocks.findMany.mockResolvedValue([stored({ id: "e1" }), stored({ id: "e2" })]);

    await cards();

    const { where, select } = mocks.attendees.mock.calls[0]![0] as {
      where: { organizationId: string; eventId: { in: string[] } };
      select: { user: { select: Record<string, boolean> } };
    };
    expect(where).toEqual({ organizationId: "org_1", eventId: { in: ["e1", "e2"] } });
    expect(Object.keys(select.user.select)).not.toContain("email");
  });

  it("hands a card the faces of the people going, the numbers, and your own answer", async () => {
    mocks.attendees.mockResolvedValue([
      { eventId: "e1", rsvp: "YES", user: person("user_1") },
      { eventId: "e1", rsvp: "MAYBE", user: person("u2") },
      { eventId: "e1", rsvp: "PENDING", user: person("u3") },
      { eventId: "e1", rsvp: "NO", user: person("u4") },
    ]);

    const [card] = await cards();

    expect(card?.crowd).toEqual({
      faces: [person("user_1")],
      going: 1,
      maybe: 1,
      awaited: 1,
      invited: 4,
    });
    // user_1 is the one signed in.
    expect(card?.myRsvp).toBe("YES");
  });

  it("shows who was asked, five at most, before anyone has said yes", async () => {
    mocks.attendees.mockResolvedValue(
      ["u1", "u2", "u3", "u4", "u5", "u6"].map((id) => ({
        eventId: "e1",
        rsvp: "PENDING",
        user: person(id),
      })),
    );

    const [card] = await cards();

    const crowd = card?.crowd as { faces: { id: string }[]; going: number; invited: number };
    expect(crowd.faces.map((f) => f.id)).toEqual(["u1", "u2", "u3", "u4", "u5"]);
    expect(crowd).toMatchObject({ going: 0, invited: 6 });
    expect(card?.myRsvp).toBeNull();
  });

  it("gives a meeting nobody was invited to no crowd", async () => {
    mocks.findMany.mockResolvedValue([stored({ id: "e1" }), stored({ id: "e2" })]);
    mocks.attendees.mockResolvedValue([{ eventId: "e1", rsvp: "YES", user: person("u2") }]);

    const found = await cards();

    expect(found.find((c) => (c.event as { id: string }).id === "e2")?.crowd).toBeNull();
  });
});

describe("the Meetings list: the next one and the wide one", () => {
  const COVER = { key: "k", s480: "/covers/k-480.webp", s960: "/covers/k-960.webp" };

  it("makes the first meeting the wide card, picture or not", async () => {
    mocks.findMany.mockResolvedValue([stored({ id: "a" }), stored({ id: "b", rsvpCover: COVER })]);

    const [a, b] = await cards();

    expect(a).toMatchObject({ featured: true, first: true });
    expect(b).toMatchObject({ featured: false, first: false });
  });

  it("widens a Featured meeting instead, and still lights the first", async () => {
    mocks.findMany.mockResolvedValue([stored({ id: "a" }), stored({ id: "b", featured: true })]);

    const [a, b] = await cards();

    expect(a).toMatchObject({ featured: false, first: true });
    expect(b).toMatchObject({ featured: true, first: false });
  });

  it("does not widen a lone meeting", async () => {
    mocks.findMany.mockResolvedValue([stored({ id: "a" })]);

    const [a] = await cards();

    expect(a).toMatchObject({ featured: false, first: true });
  });

  it("widens and lights nothing on the Past list", async () => {
    const lastWeek = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    mocks.findMany.mockResolvedValue([
      stored({
        id: "old",
        rsvpCover: COVER,
        featured: true,
        startsAt: lastWeek,
        endsAt: new Date(lastWeek.getTime() + 60 * 60 * 1000),
      }),
    ]);

    const [old] = await cards();

    expect(old).toMatchObject({ featured: false, first: false, past: true });
  });
});

describe("the Meetings list: your part and the type", () => {
  it("tells a card you are hosting it", async () => {
    mocks.findMany.mockResolvedValue([
      stored({ id: "a", hostUserId: "user_1" }),
      stored({ id: "b", hostUserId: "user_2" }),
    ]);

    const [a, b] = await cards();

    expect(a).toMatchObject({ hosting: true });
    expect(b).toMatchObject({ hosting: false });
  });

  it("gives a card its type in the organization's colour", async () => {
    signIn("ADMIN", { eventTypes: [{ name: "Standup", color: "#22aa66" }] });
    mocks.findMany.mockResolvedValue([
      stored({ id: "a", meetingType: "Standup" }),
      stored({ id: "b", meetingType: "Retired type" }),
      stored({ id: "c" }),
    ]);

    const [a, b, c] = await cards();

    expect(a).toMatchObject({ type: { name: "Standup", color: "#22aa66" } });
    // A type no longer on the organization's list has no colour to draw.
    expect(b).toMatchObject({ type: null });
    expect(c).toMatchObject({ type: null });
  });

  it("shows only the chosen type with ?type=", async () => {
    signIn("ADMIN", { eventTypes: [{ name: "Standup", color: "#22aa66" }] });
    mocks.findMany.mockResolvedValue([
      stored({ id: "a", meetingType: "Standup" }),
      stored({ id: "b" }),
    ]);

    expect((await cards({ type: "Standup" })).map((c) => (c.event as { id: string }).id)).toEqual([
      "a",
    ]);
    expect((await cards({ type: "-" })).map((c) => (c.event as { id: string }).id)).toEqual(["b"]);
    // A type nothing here has any more shows everything.
    expect((await cards({ type: "Gone" })).map((c) => (c.event as { id: string }).id)).toEqual([
      "a",
      "b",
    ]);
  });
});

describe("the Meetings list: New meeting", () => {
  const MEMBERS = [{ id: "u1", name: "Ada", image: null, avatar: null, title: null }];

  it("hands the button what the form needs: the members, the timezone and the reminders", async () => {
    mocks.members.mockResolvedValue(MEMBERS);

    const [button] = await newButtons();

    expect(mocks.members).toHaveBeenCalledExactlyOnceWith("org_1");
    expect(button).toMatchObject({
      orgId: "org_1",
      timeZone: "America/New_York",
      members: MEMBERS,
      // The built-in default, when the organization has not set its own.
      defaultReminderMinutes: [1440, 60],
    });
  });

  it("starts a new meeting from the organization's own reminders", async () => {
    signIn("ADMIN", { meetingReminderMinutes: [10080, 30] });

    const [button] = await newButtons();

    expect(button?.defaultReminderMinutes).toEqual([10080, 30]);
  });

  it("is in the header, and again in the empty state", async () => {
    mocks.findMany.mockResolvedValue([]);

    const buttons = await newButtons();

    expect(buttons).toHaveLength(2);
    expect(buttons.map((b) => b.variant)).toEqual(["create", "secondary"]);
  });

  it("is only in the header once there are meetings", async () => {
    const buttons = await newButtons();

    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.variant).toBe("create");
  });

  it("is not offered to a member, and the members are not loaded for one", async () => {
    signIn("MEMBER");
    mocks.findMany.mockResolvedValue([]);

    expect(await newButtons()).toEqual([]);
    expect(await newButtons({ new: "1" })).toEqual([]);
    expect(mocks.members).not.toHaveBeenCalled();
  });

  it("does not open on its own", async () => {
    const [button] = await newButtons();

    expect(button).toMatchObject({ startOpen: false, initialShape: null });
  });

  it("opens with no shape for ?new=1", async () => {
    const [button] = await newButtons({ new: "1" });

    expect(button).toMatchObject({ startOpen: true, initialShape: null });
  });

  it.each([
    ["online", "online"],
    ["in-person", "in-person"],
    ["event", "event"],
    // The RSVPs page's old link.
    ["rsvp", "event"],
  ])("opens on the shape for ?new=%s", async (asked, shape) => {
    const [button] = await newButtons({ new: asked });

    expect(button).toMatchObject({ startOpen: true, initialShape: shape });
  });

  it("does not open for a value it does not know", async () => {
    const [button] = await newButtons({ new: "maybe" });

    expect(button).toMatchObject({ startOpen: false, initialShape: null });
  });

  it("reads the first when ?new= is given twice", async () => {
    const [button] = await newButtons({ new: ["online", "event"] });

    expect(button).toMatchObject({ startOpen: true, initialShape: "online" });
  });

  it("opens only the header's button, not the empty state's copy of it", async () => {
    mocks.findMany.mockResolvedValue([]);

    const [header, empty] = await newButtons({ new: "event" });

    expect(header).toMatchObject({ startOpen: true, initialShape: "event" });
    expect(empty).toMatchObject({ startOpen: false, initialShape: null });
  });
});
