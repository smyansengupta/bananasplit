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
  registrations: vi.fn(),
  connections: vi.fn(),
  Card: () => null,
}));

vi.mock("@/server/db/context", () => ({
  getOrgContextBySlug: mocks.context,
  withOrgTx: async (_orgId: string, fn: (ctx: unknown) => unknown) =>
    fn({
      db: { event: { findMany: mocks.findMany }, eventRegistration: { groupBy: mocks.groupBy } },
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
    conferenceProvider: "ZOOM",
    conferenceManaged: true,
    conferenceUrl: "https://us02web.zoom.us/j/98765432100",
    conferenceSyncState: "SYNCED",
    conferenceSyncError: null,
    ...overrides,
  };
}

function signIn(role: "OWNER" | "ADMIN" | "MEMBER") {
  mocks.context.mockResolvedValue({
    organization: { id: "org_1", kind: "CLUB", timezone: "America/New_York" },
    user: { id: "user_1" },
    role,
    settings: null,
  });
}

/** Every MeetingCard's props, wherever the page put it. */
function cardProps(node: ReactNode): Record<string, unknown>[] {
  if (Array.isArray(node)) return node.flatMap(cardProps);
  if (!isValidElement(node)) return [];
  const el = node as ReactElement<{ children?: ReactNode }>;
  const own = el.type === mocks.Card ? [el.props as Record<string, unknown>] : [];
  return [...own, ...cardProps(el.props.children)];
}

async function cards() {
  const tree = await MeetingsPage({
    params: Promise.resolve({ orgSlug: "club" }),
    searchParams: Promise.resolve({}),
  } as unknown as PageProps<"/app/[orgSlug]/meetings">);
  return cardProps(tree);
}

beforeEach(() => {
  vi.clearAllMocks();
  signIn("ADMIN");
  mocks.findMany.mockResolvedValue([stored()]);
  mocks.groupBy.mockResolvedValue([]);
  mocks.registrations.mockResolvedValue([]);
  mocks.connections.mockResolvedValue([]);
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
