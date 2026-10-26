import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A meeting's own page (docs/features/meetings.md): what it hands the detail
 * view and the join card, and above all who it hands the host's start link to.
 *
 * The components are stubs. The page returns an element tree and these cases
 * read the props it set (and search the whole tree, serialized, for the host
 * link), which is exactly what would be sent to the browser.
 */

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  getEventById: vi.fn(),
  groupBy: vi.fn(),
  members: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/server/db/context", () => ({
  getOrgContextBySlug: mocks.context,
  withOrgTx: async (_orgId: string, fn: (ctx: unknown) => unknown) =>
    fn({ db: { eventRegistration: { groupBy: mocks.groupBy } } }),
}));
vi.mock("@/server/members", () => ({ getOrgMembersForPicker: mocks.members }));
vi.mock("@/app/app/[orgSlug]/calendar/queries", () => ({ getEventById: mocks.getEventById }));
vi.mock("@/lib/app-url", () => ({ appUrl: (path: string) => `https://app.test${path}` }));
vi.mock("@/components/calendar/event-detail-view", () => ({ EventDetailView: () => null }));
vi.mock("@/components/meetings/meeting-join-card", () => ({ MeetingJoinCard: () => null }));

const { default: MeetingPage } = await import("./page");

const HOST = "https://us02web.zoom.us/s/98765432100?zak=eyJ-host-token";
const JOIN = "https://us02web.zoom.us/j/98765432100?pwd=abc";

/** A Zoom meeting we made: link, host link, passcode and numbers all stored. */
function stored(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt_1",
    title: "Exec sync",
    description: null,
    startsAt: new Date("2026-11-02T22:00:00Z"),
    endsAt: new Date("2026-11-02T23:00:00Z"),
    allDay: false,
    location: "Curry 342",
    locationDetails: "Second floor.",
    format: "HYBRID",
    conferenceProvider: "ZOOM",
    conferenceUrl: JOIN,
    conferenceManaged: true,
    conferenceHostUrl: HOST,
    conferencePasscode: "482913",
    conferenceDialIn: [{ country: "US", number: "+1 646 558 8656", pin: null }],
    conferenceSyncState: "SYNCED",
    conferenceSyncError: null,
    kind: "BOARD_MEETING",
    visibility: "INTERNAL",
    hostUserId: null,
    hostName: null,
    rsvpUrl: null,
    capacityFull: false,
    featured: false,
    publicNote: null,
    stampSlot: null,
    reminderMinutes: [1440, 60],
    needsReview: false,
    googleSyncState: "FAILED",
    googleHtmlLink: null,
    googleSyncError: "Google rejected it.",
    host: null,
    attendees: [],
    notes: [],
    rsvpEnabled: false,
    rsvpSlug: null,
    rsvpCapacity: null,
    ...overrides,
  };
}

function signIn(role: "OWNER" | "ADMIN" | "MEMBER") {
  mocks.context.mockResolvedValue({
    organization: { id: "org_1", timezone: "America/New_York" },
    user: { id: "user_1" },
    role,
  });
}

type Props = Record<string, unknown> & {
  event: Record<string, unknown>;
  joinCard?: ReactElement<Record<string, unknown>>;
};

async function page(search: Record<string, string | string[] | undefined> = {}) {
  const tree = (await MeetingPage({
    params: Promise.resolve({ orgSlug: "club", id: "evt_1" }),
    searchParams: Promise.resolve(search),
  } as unknown as PageProps<"/app/[orgSlug]/meetings/[id]">)) as ReactElement<Props>;
  return { props: tree.props, tree };
}

beforeEach(() => {
  vi.clearAllMocks();
  signIn("ADMIN");
  mocks.getEventById.mockResolvedValue(stored());
  mocks.groupBy.mockResolvedValue([]);
  mocks.members.mockResolvedValue([]);
});

describe("the meeting page: the host's link", () => {
  it("hands it to an admin, for the Start as host button", async () => {
    const { props } = await page();

    expect(props.joinCard?.props.hostUrl).toBe(HOST);
  });

  it("hands it to an owner too", async () => {
    signIn("OWNER");

    const { props } = await page();

    expect(props.joinCard?.props.hostUrl).toBe(HOST);
  });

  it("never hands it to a member, anywhere in what the page returns", async () => {
    signIn("MEMBER");

    const { props, tree } = await page();

    expect(props.joinCard?.props.hostUrl).toBeNull();
    // Nor in any other prop, in any form: the whole tree, serialized.
    const everything = JSON.stringify(tree);
    expect(everything).not.toContain(HOST);
    expect(everything).not.toContain("zak=");
    expect(everything).not.toContain("host-token");
    // The join link, which every attendee gets, is there.
    expect(everything).toContain(JOIN);
  });

  it("never hands it to a treasurer either", async () => {
    mocks.context.mockResolvedValue({
      organization: { id: "org_1", timezone: "America/New_York" },
      user: { id: "user_1" },
      role: "TREASURER",
    });

    const { props, tree } = await page();

    expect(props.joinCard?.props.hostUrl).toBeNull();
    expect(JSON.stringify(tree)).not.toContain("zak=");
  });
});

describe("the meeting page: what it passes on", () => {
  it("shows the meetings section, with the place's directions and a map link", async () => {
    const { props } = await page();

    expect(props.section).toBe("meetings");
    expect(props.locationDetails).toBe("Second floor.");
    expect(props.showMapLink).toBe(true);
    expect(props.canEdit).toBe(true);
  });

  it("offers no map link for a meeting with no place", async () => {
    mocks.getEventById.mockResolvedValue(stored({ location: null, locationDetails: null }));

    const { props } = await page();

    expect(props.showMapLink).toBe(false);
    expect(props.locationDetails).toBeNull();
  });

  it("gives the join card what the meeting stored", async () => {
    const { props } = await page();

    expect(props.joinCard?.props).toMatchObject({
      orgId: "org_1",
      eventId: "evt_1",
      providerLabel: "Zoom",
      joinUrl: JOIN,
      passcode: "482913",
      dialIn: [{ country: "US", number: "+1 646 558 8656", pin: null }],
      status: { kind: "ready" },
      canEdit: true,
    });
  });

  it("gives no join card to a meeting with no video call", async () => {
    mocks.getEventById.mockResolvedValue(
      stored({
        conferenceProvider: "NONE",
        conferenceUrl: null,
        conferenceManaged: false,
        conferenceHostUrl: null,
        conferencePasscode: null,
        conferenceDialIn: null,
        conferenceSyncState: "NOT_APPLICABLE",
        format: "IN_PERSON",
      }),
    );

    const { props } = await page();

    expect(props.joinCard).toBeUndefined();
  });

  it("reads stored dial-in numbers defensively", async () => {
    mocks.getEventById.mockResolvedValue(stored({ conferenceDialIn: { number: "+1 646" } }));
    expect((await page()).props.joinCard?.props.dialIn).toEqual([]);

    mocks.getEventById.mockResolvedValue(
      stored({ conferenceDialIn: [null, { number: 7 }, { number: "+44 203 481 5240" }] }),
    );
    expect((await page()).props.joinCard?.props.dialIn).toEqual([
      { country: null, number: "+44 203 481 5240", pin: null },
    ]);
  });

  it("keeps the failure reason for an admin and hides it from a member", async () => {
    mocks.getEventById.mockResolvedValue(
      stored({
        conferenceUrl: null,
        conferenceManaged: false,
        conferenceHostUrl: null,
        conferenceSyncState: "FAILED",
        conferenceSyncError: "Zoom needs to be reconnected from Meetings.",
      }),
    );

    const admin = (await page()).props.joinCard?.props.status;
    expect(admin).toEqual({
      kind: "failed",
      line: "Couldn't make the Zoom meeting.",
      reason: "Zoom needs to be reconnected from Meetings.",
    });

    signIn("MEMBER");
    const { props, tree } = await page();
    expect(props.joinCard?.props.status).toEqual({
      kind: "failed",
      line: "Couldn't make the Zoom meeting.",
      reason: null,
    });
    expect(JSON.stringify(tree)).not.toContain("reconnected");
  });

  it("keeps the Google sync error for an admin only", async () => {
    expect((await page()).props.event.googleSyncError).toBe("Google rejected it.");

    signIn("MEMBER");
    expect((await page()).props.event.googleSyncError).toBeNull();
  });

  it("tells the edit form whether we made the meeting", async () => {
    expect((await page()).props.event.conferenceManaged).toBe(true);
  });

  it("hands on the meeting's own reminders, and the organization's for the edit form to compare", async () => {
    mocks.getEventById.mockResolvedValue(stored({ reminderMinutes: [120, 10] }));
    mocks.context.mockResolvedValue({
      organization: { id: "org_1", timezone: "America/New_York" },
      user: { id: "user_1" },
      role: "ADMIN",
      settings: { meetingReminderMinutes: [10080, 60] },
    });

    const { props } = await page();

    expect(props.event.reminderMinutes).toEqual([120, 10]);
    expect(props.defaultReminderMinutes).toEqual([10080, 60]);
  });

  it("falls back to a day's notice and an hour's when the organization has no settings row", async () => {
    // signIn() leaves `settings` off, as a context with no OrgSettings row does.
    const { props } = await page();

    expect(props.defaultReminderMinutes).toEqual([1440, 60]);
  });

  it("hands on an organization default of no reminders as it is", async () => {
    mocks.context.mockResolvedValue({
      organization: { id: "org_1", timezone: "America/New_York" },
      user: { id: "user_1" },
      role: "ADMIN",
      settings: { meetingReminderMinutes: [] },
    });

    expect((await page()).props.defaultReminderMinutes).toEqual([]);
  });

  it("passes ?edit=1 on as startInEdit, which the view honours only with canEdit", async () => {
    expect((await page({ edit: "1" })).props.startInEdit).toBe(true);
    expect((await page({ edit: ["1", "0"] })).props.startInEdit).toBe(true);
    expect((await page()).props.startInEdit).toBe(false);
    // A member who follows the link is still not an editor: the view opens nothing.
    signIn("MEMBER");
    const member = (await page({ edit: "1" })).props;
    expect(member.canEdit).toBe(false);
  });

  it("does not read the member list for a member", async () => {
    signIn("MEMBER");

    await page();

    expect(mocks.members).not.toHaveBeenCalled();
  });

  it("is not found for a meeting that does not exist", async () => {
    mocks.getEventById.mockResolvedValue(null);

    await expect(page()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
