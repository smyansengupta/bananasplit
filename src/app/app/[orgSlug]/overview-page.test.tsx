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
  latestSentPulse: vi.fn(),
  weeklyDoneTrend: vi.fn(),
  nextRsvpGoalEvent: vi.fn(),
}));

vi.mock("@/server/overview/queries", () => ({
  loadTaskExtras: vi.fn(async () => new Map()),
  loadEventGoing: vi.fn(async () => new Map()),
  loadPollStats: vi.fn(
    async (_db: unknown, _org: string, _user: string, polls: { id: string }[], n: number) =>
      polls.map((p) => ({ ...p, voters: 0, eligible: n, mine: false, faces: [] })),
  ),
  nextRsvpGoalEvent: mocks.nextRsvpGoalEvent,
  rsvpSeatsTaken: vi.fn(async () => 64),
}));
vi.mock("@/app/app/[orgSlug]/tasks/actions", () => ({ setTaskStatus: vi.fn() }));
vi.mock("@/server/pulse/queries", () => ({
  latestSentPulse: mocks.latestSentPulse,
  weeklyDoneTrend: mocks.weeklyDoneTrend,
  getPulseIssue: vi.fn(async () => null),
  nextPulseLabel: () => "Fri, Oct 9 at 5:00 PM",
}));

const db = {
  user: { findUnique: vi.fn() },
  task: { count: vi.fn() },
  event: { count: vi.fn() },
  availabilityPoll: { findMany: vi.fn() },
  poll: { findMany: vi.fn() },
  membership: { findMany: vi.fn(), count: vi.fn() },
  budgetPeriod: { count: vi.fn() },
  note: { count: vi.fn() },
  databaseDefinition: { count: vi.fn() },
  // Cards the viewer hid from their own Up next; nobody has hidden any here.
  upNextDismissal: { findMany: vi.fn(async () => []) },
};

vi.mock("@/app/app/[orgSlug]/getting-started-actions", () => ({
  setStartedStepSkipped: vi.fn(),
}));
vi.mock("@/server/db/context", () => ({
  getOrgContextBySlug: mocks.getOrgContextBySlug,
  withOrgTx: (_orgId: string, fn: (ctx: { db: typeof db }) => unknown) =>
    Promise.resolve(fn({ db })),
  // Up next's Hide pulls the server action in through the component.
  withOrgAction:
    (handler: (...a: unknown[]) => unknown) =>
    (...args: unknown[]) =>
      handler({ db, userId: "u_me", organizationId: "org_cbc" }, ...args.slice(1)),
}));
vi.mock("@/server/tasks/queries", () => ({
  getMyOpenTasks: mocks.getMyOpenTasks,
  // The phone's open-tasks bar (the same numbers as Tasks' stat strip).
  getTaskStats: async () => ({ open: 0, dueThisWeek: 0, overdue: 0, doneThisWeek: 0 }),
  taskFilterWhere: () => ({}),
}));
vi.mock("@/app/app/[orgSlug]/calendar/queries", () => ({
  getUpcomingEvents: mocks.getUpcomingEvents,
  getViewerRsvps: mocks.getViewerRsvps,
}));
vi.mock("@/server/pins", () => ({ listPins: mocks.listPins, listRecent: mocks.listRecent }));
vi.mock("@/app/app/[orgSlug]/notes/queries", () => ({
  getRecentNotes: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/server/notes/files", () => ({ listNoteFiles: vi.fn().mockResolvedValue([]) }));
vi.mock("@/server/boards", () => ({ loadSavedBoard: mocks.loadSavedBoard }));
vi.mock("@/app/app/[orgSlug]/_shell/board-actions", () => ({ saveBoardAction: vi.fn() }));
vi.mock("@/app/app/[orgSlug]/_shell/pin-actions", () => ({
  pinPathAction: vi.fn(),
  reorderPinsAction: vi.fn(),
  togglePinAction: vi.fn(),
  unpinAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));
vi.mock("@/server/setup/progress", () => ({ loadSetupState: mocks.loadSetupState }));
vi.mock("@/server/onboarding/join-code", () => ({ getOrCreateJoinCode: vi.fn() }));
vi.mock("@/components/onboarding/join-code-card", () => ({ JoinCodeCard: () => null }));
vi.mock("@/server/personal/home", () => ({
  loadPersonalHome: vi.fn(async () => ({ firstName: "Viewer", clubs: [], pendingInvites: [] })),
}));
vi.mock("@/components/personal/personal-home", () => ({
  PersonalHome: ({ orgSlug }: { orgSlug: string }) => <p>Personal home of {orgSlug}</p>,
}));

const { default: OverviewPage } = await import("./page");

const viewer = { id: "u_viewer", email: "viewer@example.edu", name: "Viewer" };
const org = {
  id: "org_cbc",
  name: "Claude Builders Club",
  slug: "cbc",
  kind: "CLUB",
  plan: "SOCIETY",
  trialEndsAt: null,
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
  db.poll.findMany.mockResolvedValue([]);
  db.membership.findMany.mockResolvedValue([]);
  db.membership.count.mockResolvedValue(1);
  mocks.latestSentPulse.mockResolvedValue(null);
  mocks.weeklyDoneTrend.mockResolvedValue([
    { weekStart: "2026-09-26", label: "Sep 26", done: 3 },
    { weekStart: "2026-10-03", label: "Oct 3", done: 0 },
  ]);
  mocks.nextRsvpGoalEvent.mockResolvedValue(null);
});

const meeting = {
  id: "e_meet",
  title: "Officer meeting",
  startsAt: new Date("2026-10-06T02:00:00Z"),
  endsAt: new Date("2026-10-06T03:00:00Z"),
  allDay: false,
  kind: "BOARD_MEETING",
  visibility: "INTERNAL",
  location: "Engineering Hall 112",
  googleSyncState: "NOT_APPLICABLE",
  needsReview: false,
};

afterEach(() => {
  vi.useRealTimers();
});

describe("a Personal space's home", () => {
  it("is the Personal dashboard, not a club's board", async () => {
    mocks.getOrgContextBySlug.mockResolvedValue({
      user: viewer,
      organization: { ...org, slug: "me-abc", kind: "PERSONAL", plan: "FREE" },
      role: "OWNER",
    });
    const html = await render();
    expect(html).toContain("Personal home of me-abc");
    expect(mocks.getMyOpenTasks).not.toHaveBeenCalled();
    expect(mocks.loadSavedBoard).not.toHaveBeenCalled();
  });
});

describe("org overview", () => {
  it("shows no one the club's money, not even a treasurer", async () => {
    mocks.getOrgContextBySlug.mockResolvedValue({
      user: viewer,
      organization: org,
      role: "TREASURER",
    });
    const html = await render();
    expect(html).not.toContain("Money owed to you");
    expect(html).not.toContain("Club balance");
    // Greets them by first name, in their own timezone (10:00 in Los Angeles).
    expect(html).toContain("Good morning, Viewer");
  });

  it("builds the member's own board, and offers every widget but the admin ones", async () => {
    mocks.loadSavedBoard.mockResolvedValue([
      { id: "week", type: "week", w: 4, h: null },
      { id: "polls", type: "polls", w: 1, h: 240 },
    ]);
    const html = await render();
    expect(html).toContain("This week");
    expect(html).toContain("Open polls");
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
          parentTask: null,
        },
        {
          id: "t_stuck",
          title: "Order pizza",
          status: "BLOCKED",
          visibility: "PRIVATE",
          dueDate: new Date("2026-10-05T00:00:00Z"),
          blockedReason: "Waiting on the budget",
          parentTask: {
            id: "s_1",
            title: "Fall kickoff logistics",
            type: "STORY",
            color: null,
            parentTask: { id: "e_1", title: "Fall kickoff", type: "EPIC", color: null },
          },
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
    expect(html).toContain("Part of Fall kickoff logistics");
    expect(html).toContain('aria-label="Private task"');
    expect(html).toContain("View all 8");
  });

  it("puts events in the viewer's timezone with their own RSVP", async () => {
    mocks.loadSavedBoard.mockResolvedValue([{ id: "events", type: "events", w: 2, h: null }]);
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

  it("lists open polls of both kinds, newest first", async () => {
    mocks.loadSavedBoard.mockResolvedValue([{ id: "polls", type: "polls", w: 1, h: null }]);
    db.availabilityPoll.findMany.mockResolvedValue([
      {
        id: "ap_1",
        title: "Exec sync time",
        closesAt: null,
        createdAt: new Date("2026-10-01T12:00:00Z"),
      },
    ]);
    db.poll.findMany.mockResolvedValue([
      {
        id: "qp_1",
        question: "Pizza or tacos?",
        closesAt: null,
        createdAt: new Date("2026-10-04T12:00:00Z"),
      },
    ]);

    const html = await render();
    expect(db.poll.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: "org_cbc", closedAt: null }),
      }),
    );
    // In the polls widget (Up next above it lists them by urgency instead).
    const widget = html.slice(html.lastIndexOf("Open polls"));
    expect(widget.indexOf("Pizza or tacos?")).toBeLessThan(widget.indexOf("Exec sync time"));
    expect(html).toContain('href="/app/cbc/calendar/polls/qp_1"');
    expect(html).toContain('href="/app/cbc/calendar/find-a-time/ap_1"');
    expect(html).toContain("Question · Open");
    expect(html).toContain("Find a time · Open");
  });

  it("shows a next step when there is nothing pinned or coming up", async () => {
    const html = await render();
    expect(html).toContain("Nothing pinned yet");
    expect(html).toContain("Nothing needs you this week");
    mocks.loadSavedBoard.mockResolvedValue([
      { id: "meetings", type: "meetings", w: 2, h: null },
      { id: "events", type: "events", w: 2, h: null },
    ]);
    const lists = await render();
    expect(lists).toContain("No meetings coming up");
    expect(lists).toContain("No events coming up");
  });
});

describe("the Moonstone Overview", () => {
  it("greets in the display face with the date and club on a plain line", async () => {
    const html = await render();
    expect(html).toContain("Monday, October 5, Claude Builders Club");
    expect(html).not.toContain('class="eyebrow');
  });

  it("heads every board with the stat strip, then Up next", async () => {
    mocks.getUpcomingEvents.mockImplementation(
      async (_db: unknown, _org: string, _now: Date, _n: number, only?: string) =>
        only === "meetings"
          ? []
          : [meeting, { ...meeting, id: "e_far", startsAt: new Date("2026-11-30T02:00:00Z") }],
    );
    db.task.count.mockResolvedValue(0);
    // Even a saved board that never had them.
    mocks.loadSavedBoard.mockResolvedValue([{ id: "polls", type: "polls", w: 1, h: null }]);
    const html = await render();
    expect(html).toContain("Due this week");
    expect(html).toContain("All clear");
    expect(html).toContain("Coming up in 14 days");
    expect(html).not.toContain("Open tasks");
    expect(html.indexOf("Due this week")).toBeLessThan(html.indexOf('id="up-next-heading"'));
    expect(html.indexOf('id="up-next-heading"')).toBeLessThan(html.indexOf("Open polls"));
  });

  it("shows owners the club's first steps until each is done or checked off", async () => {
    mocks.getOrgContextBySlug.mockResolvedValue({
      user: viewer,
      organization: { ...org, logo: null },
      role: "OWNER",
      settings: { startedSkipped: ["database"] },
    });
    db.budgetPeriod.count.mockResolvedValue(0);
    db.databaseDefinition.count.mockResolvedValue(0);
    const html = await render();
    expect(html).toContain("Get your club started");
    expect(html).toContain("Set up your budgets");
    expect(html).toContain("Create a task or an epic");
    expect(html).not.toContain("sections");
    expect(html).toContain("Checked off as not needed.");

    // Everything done or checked off: the card is gone.
    db.membership.count.mockResolvedValue(5);
    db.event.count.mockResolvedValue(2);
    db.task.count.mockResolvedValue(3);
    db.budgetPeriod.count.mockResolvedValue(1);
    mocks.getOrgContextBySlug.mockResolvedValue({
      user: viewer,
      organization: { ...org, logo: { key: "k" } },
      role: "OWNER",
      settings: { startedSkipped: ["database"] },
    });
    expect(await render()).not.toContain("Get your club started");
  });

  it("starts a new board with Up next and the Weekly pulse", async () => {
    mocks.getUpcomingEvents.mockImplementation(
      async (_db: unknown, _org: string, _now: Date, _n: number, only?: string) =>
        only === "meetings" ? [meeting] : [],
    );
    mocks.getViewerRsvps.mockResolvedValue(new Map([["e_meet", "PENDING"]]));
    const html = await render();
    expect(html).toContain('id="up-next-heading"');
    expect(html).toContain('aria-label="Weekly pulse"');
    // The RSVP waiting on the viewer is an answer block.
    expect(html).toContain("Your RSVP · Today · 7:00 PM");
    expect(html.indexOf('id="up-next-heading"')).toBeLessThan(
      html.indexOf('aria-label="My tasks"'),
    );
    expect(html).toContain("The first pulse goes out Fri, Oct 9 at 5:00 PM.");
  });

  it("shows the latest pulse's figure and tiles, and keeps a saved board's order", async () => {
    mocks.latestSentPulse.mockResolvedValue({
      id: "pi_1",
      weekStart: "2026-09-26",
      note: null,
      sentAt: new Date("2026-10-02T21:00:00Z"),
      data: {
        v: 1,
        range: { from: "2026-09-26", to: "2026-10-02" },
        doneCount: 9,
        byProject: [{ projectId: "p", name: "Fall Showcase", color: null, done: 9, open: 2 }],
        events: [
          {
            eventId: "e",
            title: "General meeting",
            startsAt: "2026-09-30T22:00:00Z",
            checkIns: 32,
          },
        ],
        newMembers: [],
        pollResults: [],
        nextWeek: [],
      },
    });
    mocks.loadSavedBoard.mockResolvedValue([
      { id: "weekly-pulse", type: "weekly-pulse", w: 4, h: null },
    ]);
    const html = await render();
    expect(html).toContain("Sent Fri, Oct 2");
    expect(html).toContain("tasks done last week");
    expect(html).toContain("32 at the General meeting");
    expect(html).toContain('href="/app/cbc/pulse/2026-09-26"');
    // Up next heads every board, saved or not.
    expect(html).toContain('id="up-next-heading"');
  });
});
