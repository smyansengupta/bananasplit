import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The org overview, at the page level: that no one sees the club's money
 * here, what "my tasks" asks for and how it reads, which timezone the events
 * use, and the member's own board of widgets. The
 * queries themselves run under RLS (private tasks and other people's private
 * notes are not there); here they are mocked, so this pins the page's own
 * decisions.
 */

const mocks = vi.hoisted(() => ({
  getOrgContextBySlug: vi.fn(),
  getMyOpenTasks: vi.fn(),
  getUpcomingEvents: vi.fn(),
  getViewerRsvps: vi.fn(),
  listPins: vi.fn(),
  listRecent: vi.fn(),
  loadSetupState: vi.fn(),
  loadSavedBoard: vi.fn(),
}));

const db = {
  user: { findUnique: vi.fn() },
  task: { count: vi.fn() },
  event: { count: vi.fn() },
  availabilityPoll: { findMany: vi.fn() },
  membership: { findMany: vi.fn(), count: vi.fn() },
  budgetPeriod: { count: vi.fn() },
  note: { count: vi.fn() },
};

vi.mock("@/server/db/context", () => ({
  getOrgContextBySlug: mocks.getOrgContextBySlug,
  withOrgTx: (_orgId: string, fn: (ctx: { db: typeof db }) => unknown) =>
    Promise.resolve(fn({ db })),
}));
vi.mock("@/server/tasks/queries", () => ({
  getMyOpenTasks: mocks.getMyOpenTasks,
  taskFilterWhere: () => ({}),
}));
vi.mock("@/app/app/[orgSlug]/calendar/queries", () => ({
  getUpcomingEvents: mocks.getUpcomingEvents,
  getViewerRsvps: mocks.getViewerRsvps,
}));
vi.mock("@/server/pins", () => ({ listPins: mocks.listPins, listRecent: mocks.listRecent }));
vi.mock("@/app/app/[orgSlug]/notes/queries", () => ({ getRecentNotes: vi.fn().mockResolvedValue([]) }));
vi.mock("@/server/notes/files", () => ({ listNoteFiles: vi.fn().mockResolvedValue([]) }));
vi.mock("@/server/boards", () => ({ loadSavedBoard: mocks.loadSavedBoard }));
vi.mock("@/app/app/[orgSlug]/_shell/board-actions", () => ({ saveBoardAction: vi.fn() }));
vi.mock("@/app/app/[orgSlug]/_shell/pin-actions", () => ({
  pinPathAction: vi.fn(),
  reorderPinsAction: vi.fn(),
  togglePinAction: vi.fn(),
  unpinAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/server/setup/progress", () => ({ loadSetupState: mocks.loadSetupState }));
vi.mock("@/server/onboarding/join-code", () => ({ getOrCreateJoinCode: vi.fn() }));
vi.mock("@/components/onboarding/join-code-card", () => ({ JoinCodeCard: () => null }));

const { default: OverviewPage } = await import("./page");

const viewer = { id: "u_viewer", email: "viewer@example.edu", name: "Viewer" };
const org = {
  id: "org_cbc",
  name: "Claude Builders Club",
  slug: "cbc",
  timezone: "America/New_York",
};
const props = {
  params: Promise.resolve({ orgSlug: "cbc" }),
  searchParams: Promise.resolve({}),
} as unknown as PageProps<"/app/[orgSlug]">;

// 10:00 on Monday, Oct 5 in Los Angeles, where the viewer lives.
const NOW = new Date("2026-10-05T17:00:00Z");

async function render() {
  return renderToStaticMarkup(await OverviewPage(props)).replace(/ /g, " ");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  mocks.getOrgContextBySlug.mockResolvedValue({ user: viewer, organization: org, role: "MEMBER" });
  db.user.findUnique.mockResolvedValue({ timezone: "America/Los_Angeles", name: "Viewer" });
  db.task.count.mockResolvedValue(0);
  db.event.count.mockResolvedValue(0);
  mocks.getMyOpenTasks.mockResolvedValue({ tasks: [], total: 0, overdue: 0 });
  mocks.getUpcomingEvents.mockResolvedValue([]);
  mocks.getViewerRsvps.mockResolvedValue(new Map());
  mocks.listPins.mockResolvedValue([]);
  mocks.listRecent.mockResolvedValue([]);
  mocks.loadSavedBoard.mockResolvedValue(null);
  db.availabilityPoll.findMany.mockResolvedValue([]);
  db.membership.findMany.mockResolvedValue([]);
  db.membership.count.mockResolvedValue(1);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("org overview", () => {
  it("shows no one the club's money, not even a treasurer", async () => {
    mocks.getOrgContextBySlug.mockResolvedValue({ user: viewer, organization: org, role: "TREASURER" });
    const html = await render();
    expect(html).not.toContain("Money owed to you");
    expect(html).not.toContain("Club balance");
    // Greets them by first name, in their own timezone (10:00 in Los Angeles).
    expect(html).toContain("Good morning, Viewer");
  });

  it("builds the member's own board, and offers every widget but the admin ones", async () => {
    mocks.loadSavedBoard.mockResolvedValue([
      { id: "week", type: "week", w: 4, h: null },
      { id: "task-stats", type: "task-stats", w: 1, h: 240 },
    ]);
    const html = await render();
    expect(html).toContain("This week");
    expect(html).toContain("My week at a glance");
    expect(html).toContain("height:240px");
    // Not on this member's board.
    expect(html).not.toContain(">Meetings<");
  });

  it("asks for my open tasks against my own today, and links each one to its page", async () => {
    // 19:00 on Oct 5 in Los Angeles is already Oct 6 in UTC.
    vi.setSystemTime(new Date("2026-10-06T02:00:00Z"));
    mocks.getMyOpenTasks.mockResolvedValue({
      total: 8,
      overdue: 1,
      tasks: [
        {
          id: "t_late",
          title: "Book the room",
          status: "IN_PROGRESS",
          visibility: "ORG",
          dueDate: new Date("2026-10-01T00:00:00Z"),
          blockedReason: null,
          project: { name: "Fall kickoff" },
          parentTask: null,
        },
        {
          id: "t_stuck",
          title: "Order pizza",
          status: "BLOCKED",
          visibility: "PRIVATE",
          dueDate: new Date("2026-10-05T00:00:00Z"),
          blockedReason: "Waiting on the budget",
          project: null,
          parentTask: { title: "Fall kickoff logistics" },
        },
      ],
    });

    const html = await render();
    expect(mocks.getMyOpenTasks).toHaveBeenCalledWith(db, "org_cbc", "u_viewer", {
      limit: 8,
      today: new Date("2026-10-05T00:00:00Z"),
    });
    expect(html).toContain('href="/app/cbc/tasks/t_late"');
    expect(html).toContain('href="/app/cbc/tasks/t_stuck"');
    expect(html).toContain("8 open");
    expect(html).toContain("1 overdue");
    expect(html).toContain("Overdue · Thu, Oct 1");
    expect(html).toContain("Blocked");
    expect(html).toContain("Subtask of Fall kickoff logistics");
    expect(html).toContain('aria-label="Private task"');
    expect(html).toContain("View all 8");
  });

  it("puts events in the viewer's timezone with their own RSVP", async () => {
    mocks.getUpcomingEvents.mockResolvedValue([
      {
        id: "e_1",
        title: "Intro to agents",
        startsAt: new Date("2026-10-06T01:00:00Z"),
        endsAt: new Date("2026-10-06T03:00:00Z"),
        allDay: false,
        kind: "WORKSHOP",
        visibility: "INTERNAL",
        location: "Curry 342",
        googleSyncState: "NOT_APPLICABLE",
        needsReview: false,
      },
    ]);
    mocks.getViewerRsvps.mockResolvedValue(new Map([["e_1", "YES"]]));

    const html = await render();
    expect(mocks.getUpcomingEvents).toHaveBeenCalledWith(db, "org_cbc", NOW, 6, "events");
    expect(mocks.getUpcomingEvents).toHaveBeenCalledWith(db, "org_cbc", NOW, 6, "meetings");
    expect(html).toContain('href="/app/cbc/calendar/e_1"');
    expect(html).toContain("Today, 6:00 PM – 8:00 PM");
    expect(html).toContain("Workshop");
    expect(html).toContain("Curry 342");
    expect(html).toContain("Going");
  });

  it("lists the viewer's pins and the pages they opened recently", async () => {
    mocks.listPins.mockResolvedValue([
      { id: "pin_1", href: "/app/cbc/notes/n_1", label: "E-board minutes", kind: "note" },
    ]);
    mocks.listRecent.mockResolvedValue([
      {
        href: "/app/cbc/databases/sessions",
        label: "Sessions",
        kind: "database",
        visitedAt: new Date("2026-10-05T15:00:00Z"),
      },
    ]);

    const html = await render();
    expect(mocks.listPins).toHaveBeenCalledWith(db, "org_cbc", "cbc", "u_viewer");
    expect(mocks.listRecent).toHaveBeenCalledWith(db, "org_cbc", "cbc", "u_viewer", 8);
    expect(html).toContain('href="/app/cbc/notes/n_1"');
    expect(html).toContain("E-board minutes");
    expect(html).toContain('href="/app/cbc/databases/sessions"');
    expect(html).toContain("2 hours ago");
  });

  it("shows a next step when there is nothing pinned or coming up", async () => {
    const html = await render();
    expect(html).toContain("Nothing pinned yet");
    expect(html).toContain("No meetings coming up");
    expect(html).toContain("No events coming up");
  });
});
