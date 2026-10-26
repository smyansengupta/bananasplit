import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Calendar's event page: what it hands the detail view, and so the edit
 * form it opens. The components are stubs; these cases read the props the
 * page set.
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
vi.mock("../queries", () => ({ getEventById: mocks.getEventById }));
vi.mock("@/lib/app-url", () => ({ appUrl: (path: string) => `https://app.test${path}` }));
vi.mock("@/components/calendar/event-detail-view", () => ({ EventDetailView: () => null }));

const { default: EventDetailPage } = await import("./page");

/** A Zoom meeting, with its link. */
function stored(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt_1",
    title: "Exec sync",
    description: null,
    startsAt: new Date("2026-11-02T22:00:00Z"),
    endsAt: new Date("2026-11-02T23:00:00Z"),
    allDay: false,
    location: null,
    locationDetails: null,
    conferenceProvider: "ZOOM",
    conferenceUrl: "https://us02web.zoom.us/j/98765432100",
    conferenceManaged: true,
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
    googleSyncState: "NOT_APPLICABLE",
    googleHtmlLink: null,
    googleSyncError: null,
    host: null,
    attendees: [],
    notes: [],
    rsvpEnabled: false,
    rsvpSlug: null,
    rsvpCapacity: null,
    ...overrides,
  };
}

type Props = Record<string, unknown> & { event: Record<string, unknown> };

async function page() {
  const tree = (await EventDetailPage({
    params: Promise.resolve({ orgSlug: "club", eventId: "evt_1" }),
    searchParams: Promise.resolve({}),
  } as unknown as PageProps<"/app/[orgSlug]/calendar/[eventId]">)) as ReactElement<Props>;
  return tree.props;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue({
    organization: { id: "org_1", timezone: "America/New_York" },
    user: { id: "user_1" },
    role: "ADMIN",
  });
  mocks.groupBy.mockResolvedValue([]);
  mocks.members.mockResolvedValue([]);
});

describe("the Calendar's event page: the edit form's video call", () => {
  it("says the meeting is one we made, so the form says its link is there already", async () => {
    mocks.getEventById.mockResolvedValue(stored());

    expect((await page()).event.conferenceManaged).toBe(true);
  });

  it("says a pasted link is not ours", async () => {
    mocks.getEventById.mockResolvedValue(
      stored({
        conferenceProvider: "OTHER",
        conferenceUrl: "https://example.com/room",
        conferenceManaged: false,
      }),
    );

    expect((await page()).event.conferenceManaged).toBe(false);
  });
});
