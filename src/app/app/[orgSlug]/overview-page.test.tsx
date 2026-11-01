import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The org overview, at the page level: that no one sees the club's money
 * here, what "my tasks" asks for and how it reads, which timezone the events
 * use, and the member's own board of widgets. The
 * queries themselves run under RLS (private tasks and other people's private
 * notes are not there); here they are mocked, so this pins the page's own
 * decisions. The newer widgets' loaders are mocked too (each has its own
 * tests); what's pinned here is that one failing loses only its own card.
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
  loadLinkedChips: vi.fn(),
  loadDecisions: vi.fn(),
  loadVotes: vi.fn(),
}));

vi.mock("@/server/overview/queries", async (actual) => ({
  // Home's Open forms is the real merge of what the Forms list shows.
  loadOpenForms: (await actual<typeof import("@/server/overview/queries")>()).loadOpenForms,
  loadTaskExtras: vi.fn(async () => new Map()),
  loadEventGoing: vi.fn(async () => new Map()),
  loadPollStats: vi.fn(
    async (_db: unknown, _org: string, _user: string, polls: { id: string }[], n: number) =>
      polls.map((p) => ({ ...p, voters: 0, eligible: n, mine: false, faces: [] })),
  ),
  loadLinkedChips: mocks.loadLinkedChips,
  loadEventDetails: vi.fn(async () => new Map()),
  loadLastInSeries: vi.fn(async () => new Map()),
  loadPickUpChanges: vi.fn(async () => new Map()),
  loadPinStates: vi.fn(async () => ({})),
  loadFormResponsesSince: vi.fn(async () => new Map()),
  loadEventTurnout: vi.fn(async () => ({ seats: new Map(), rates: new Map() })),
}));
// The newer widgets' loaders: each has its own tests.
vi.mock("@/server/overview/recap-week", () => ({ loadRecapWeek: vi.fn() }));
vi.mock("@/server/overview/since-you-were-here", () => ({
  loadSinceYouWereHere: vi.fn(async () => ({
    rows: [],
    total: 0,
    insight: null,
    sinceLabel: null,
  })),
  markHomeVisit: vi.fn(async () => null),
}));
vi.mock("@/server/overview/waiting-on-you", () => ({ loadWaitingOnYou: vi.fn() }));
vi.mock("@/server/overview/waiting-on-others", () => ({
  loadWaitingOnOthers: vi.fn(async () => ({ rows: [], insight: null })),
}));
vi.mock("@/server/overview/votes", () => ({
  loadVotes: mocks.loadVotes,
  votePolls: (shared: { questions: { formId: string | null }[] }) =>
    shared.questions.filter((q) => q.formId === null),
}));
vi.mock("@/server/overview/decisions", () => ({ loadDecisions: mocks.loadDecisions }));
vi.mock("@/server/overview/who-owns-what", () => ({ loadWhoOwnsWhat: vi.fn(async () => null) }));
vi.mock("@/server/overview/focus-time", () => ({ loadFocusTime: vi.fn() }));
// Actions the widgets' buttons call.
vi.mock("@/app/app/[orgSlug]/tasks/actions", () => ({
  setTaskStatus: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  selfAssignTask: vi.fn(),
  addTaskComment: vi.fn(),
}));
vi.mock("@/app/app/[orgSlug]/calendar/actions", () => ({
  rsvpToEvent: vi.fn(),
  updateEvent: vi.fn(),
}));
vi.mock("@/app/app/[orgSlug]/calendar/polls/question-actions", () => ({
  voteOnQuestionPoll: vi.fn(),
}));
vi.mock("@/app/app/[orgSlug]/links/actions", () => ({
  addLinkAction: vi.fn(),
  removeLinkAction: vi.fn(),
  listLinksAction: vi.fn(),
  peekAction: vi.fn(),
}));
vi.mock("@/app/app/[orgSlug]/search/actions", () => ({ searchWorkspaceAction: vi.fn() }));
vi.mock("@/app/app/[orgSlug]/notes/actions", () => ({ createNote: vi.fn() }));
vi.mock("@/app/app/[orgSlug]/finance/transactions-actions", () => ({
  approveExpense: vi.fn(),
  rejectExpense: vi.fn(),
}));
vi.mock("@/app/onboarding/profile/actions", () => ({ saveAvailabilityStep: vi.fn() }));
vi.mock("@/server/announcements/actions", () => ({ postRecapAnnouncement: vi.fn() }));
vi.mock("@/server/decisions/actions", () => ({
  createDecision: vi.fn(),
  decide: vi.fn(),
  dropDecision: vi.fn(),
  linkDecision: vi.fn(),
  takeDecision: vi.fn(),
}));
vi.mock("@/server/overview/home-visit-actions", () => ({ markHomeSeen: vi.fn() }));
vi.mock("@/server/overview/focus-time-actions", () => ({ saveFocusAvailability: vi.fn() }));
vi.mock("@/server/pulse/queries", () => ({
  latestSentPulse: mocks.latestSentPulse,
  weeklyDoneTrend: mocks.weeklyDoneTrend,
  getPulseIssue: vi.fn(async () => null),
  nextPulseLabel: () => "Fri, Oct 9 at 5:00 PM",
}));

const db = {
  user: { findUnique: vi.fn() },
  // findMany: my deadlines for This week and the stat strip's sentence.
  task: {
    count: vi.fn(),
    findMany: vi.fn(async (): Promise<{ id: string; title: string; dueDate: Date }[]> => []),
  },
  event: { count: vi.fn() },
  availabilityPoll: { findMany: vi.fn() },
  poll: { findMany: vi.fn() },
  // Open forms (filtered to what's open in SQL), their responses, and elections.
  form: { findMany: vi.fn() },
  formResponse: {
    findMany: vi.fn(async () => []),
    groupBy: vi.fn(async (): Promise<{ formId: string; _count: { _all: number } }[]> => []),
  },
  ballotDefinition: { findMany: vi.fn() },
  ballot: { groupBy: vi.fn(async () => []) },
  membership: { findMany: vi.fn(), count: vi.fn() },
  budgetPeriod: { count: vi.fn() },
  orgChartVersion: { count: vi.fn(async () => 0) },
  note: { count: vi.fn() },
  databaseDefinition: { count: vi.fn(), findFirst: vi.fn(async () => ({ key: "ballots" })) },
  // Cards the viewer hid from their own Up next; nobody has hidden any here.
  upNextDismissal: { findMany: vi.fn(async () => []) },
};

vi.mock("@/app/app/[orgSlug]/getting-started-actions", () => ({
  setStartedStepSkipped: vi.fn(),
  hideGettingStarted: vi.fn(),
  restoreStartedSkipped: vi.fn(),
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
vi.mock("@/server/boards", () => ({ loadSavedBoard: mocks.loadSavedBoard }));
vi.mock("@/server/presence", () => ({
  onlineNow: vi.fn().mockResolvedValue({ count: 3, faces: [], ids: ["u_a", "u_b"] }),
}));
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
  db.form.findMany.mockResolvedValue([]);
  db.formResponse.groupBy.mockResolvedValue([]);
  db.ballotDefinition.findMany.mockResolvedValue([]);
  mocks.loadDecisions.mockResolvedValue({
    rows: [],
    total: 0,
    todayKey: "2026-10-05",
    timeZone: "America/Los_Angeles",
  });
  mocks.loadVotes.mockResolvedValue({ cards: [], insight: null, total: 0 });
  db.availabilityPoll.findMany.mockResolvedValue([]);
  db.poll.findMany.mockResolvedValue([]);
  db.membership.findMany.mockResolvedValue([]);
  db.membership.count.mockResolvedValue(1);
  mocks.latestSentPulse.mockResolvedValue(null);
  mocks.weeklyDoneTrend.mockResolvedValue([
    { weekStart: "2026-09-26", label: "Sep 26", done: 3 },
    { weekStart: "2026-10-03", label: "Oct 3", done: 0 },
  ]);
  mocks.loadLinkedChips.mockResolvedValue(new Map());
  db.task.findMany.mockResolvedValue([]);
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
  it("is the Personal dashboard, not an organization's board", async () => {
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
  it("shows no one the organization's money, not even a treasurer", async () => {
    mocks.getOrgContextBySlug.mockResolvedValue({
      user: viewer,
      organization: org,
      role: "TREASURER",
    });
    const html = await render();
    expect(html).not.toContain("Money owed to you");
    expect(html).not.toContain("Organization balance");
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
    expect(html).toContain("Open forms");
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
    expect(html).toContain("Overdue, Thu, Oct 1");
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
    // One read for Pick up and Here now: Pick up shows the first eight.
    expect(mocks.listRecent).toHaveBeenCalledTimes(1);
    expect(mocks.listRecent).toHaveBeenCalledWith(db, "org_cbc", "cbc", "u_viewer", 12);
    expect(html).toContain('href="/app/cbc/notes/n_1"');
    expect(html).toContain("E-board minutes");
    expect(html).toContain('href="/app/cbc/databases/sessions"');
    expect(html).toContain("2 hours ago");
  });

  /** Two open forms (the SQL leaves drafts and closed ones out), a member poll and an election. */
  function openForms() {
    const form = (id: string, title: string, at: string, extra: object = {}) => ({
      id,
      title,
      kind: "FORM",
      access: "PUBLIC",
      anonymous: false,
      review: false,
      publishedAt: new Date(at),
      closedAt: null,
      closesAt: null,
      responseCap: null,
      deletedAt: null,
      createdAt: new Date(at),
      ...extra,
    });
    db.form.findMany.mockResolvedValue([
      form("f_app", "Organization application", "2026-10-03T12:00:00Z", {
        review: true,
        closesAt: new Date("2026-10-09T12:00:00Z"),
      }),
      form("f_quick", "Snack pick", "2026-10-02T12:00:00Z", {
        kind: "QUICK_POLL",
        access: "MEMBERS",
      }),
    ]);
    db.formResponse.groupBy.mockImplementation(async (args?: unknown) =>
      (args as { where: { status?: string } }).where.status === "NEW"
        ? [{ formId: "f_app", _count: { _all: 2 } }]
        : [
            { formId: "f_app", _count: { _all: 7 } },
            { formId: "f_quick", _count: { _all: 3 } },
          ],
    );
    db.membership.count.mockResolvedValue(12);
    db.ballotDefinition.findMany.mockResolvedValue([
      {
        id: "bd_1",
        slug: "fall-vote",
        title: "Fall social vote",
        isTest: false,
        linkedEventId: null,
        opensAt: new Date("2026-10-01T12:00:00Z"),
        closesAt: null,
        createdAt: new Date("2026-09-30T12:00:00Z"),
      },
    ]);
    db.ballot.groupBy.mockResolvedValue([
      { ballotDefinitionId: "bd_1", _count: { _all: 41 } },
    ] as never);
    db.poll.findMany.mockResolvedValue([
      {
        id: "qp_1",
        question: "Pizza or tacos?",
        closesAt: null,
        createdAt: new Date("2026-10-04T12:00:00Z"),
        formId: null,
        hideResultsUntilClosed: false,
      },
    ]);
  }

  it("lists what the Forms list shows as open, newest first, linking where Forms does", async () => {
    mocks.getOrgContextBySlug.mockResolvedValue({ user: viewer, organization: org, role: "ADMIN" });
    mocks.loadSavedBoard.mockResolvedValue([{ id: "polls", type: "polls", w: 1, h: null }]);
    openForms();

    const html = await render();
    // Only open forms are asked for: no drafts, nothing closed or past its date.
    expect(db.form.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ closedAt: null, publishedAt: { not: null } }),
        take: expect.any(Number),
      }),
    );
    // In the Open forms widget (Up next above it lists polls by urgency instead).
    const widget = html.slice(html.lastIndexOf("Open forms"));
    const order = ["Pizza or tacos?", "Organization application", "Snack pick", "Fall social vote"];
    for (let i = 1; i < order.length; i++)
      expect(widget.indexOf(order[i - 1])).toBeLessThan(widget.indexOf(order[i]));
    expect(widget).toContain('href="/app/cbc/forms/f_app"');
    expect(widget).toContain('href="/app/cbc/forms/f_quick"');
    expect(widget).toContain('href="/app/cbc/forms/polls/qp_1"');
    expect(widget).toContain('href="/app/cbc/databases/ballots?f=poll%3Aeq%3Afall-vote"');
    // Each is a bar of its responses: to who can answer when that's known.
    expect(widget).toContain("Form, closes Fri");
    expect(widget).toContain('aria-label="7 responses"');
    expect(widget).toContain("2 to review");
    expect(widget).toContain("Quick poll, open");
    expect(widget).toContain('aria-label="3 of 12 answered"');
    expect(widget).toContain("Member poll, open");
    expect(widget).toContain("Website poll, open");
    expect(widget).toContain('aria-label="41 responses"');
  });

  it("shows a member when forms close, not response counts they can't read", async () => {
    mocks.loadSavedBoard.mockResolvedValue([{ id: "polls", type: "polls", w: 1, h: null }]);
    openForms();
    const html = await render();
    const widget = html.slice(html.lastIndexOf("Open forms"));
    expect(widget).toContain("Organization application");
    expect(widget).toContain("Form, open until Fri");
    expect(widget).not.toContain('aria-label="7 responses"');
    expect(widget).not.toContain("3 of 12 answered");
    // Member polls and elections still show theirs.
    expect(widget).toContain('aria-label="41 responses"');
  });

  it("shows a widget whose read failed as its own card, and the rest of the board", async () => {
    mocks.loadSavedBoard.mockResolvedValue([
      { id: "decisions", type: "decisions", w: 2, h: null },
      { id: "polls", type: "polls", w: 1, h: null },
      { id: "votes", type: "votes", w: 1, h: null },
    ]);
    mocks.loadDecisions.mockRejectedValue(new Error("connection reset"));
    mocks.loadVotes.mockResolvedValue({
      cards: [
        {
          key: "poll:qp_1",
          kind: "poll",
          title: "Pizza or tacos?",
          href: "/app/cbc/forms/polls/qp_1",
          closes: null,
          voters: 2,
          eligible: 12,
          percent: 17,
          mine: false,
          leader: null,
        },
      ],
      insight: null,
      total: 3,
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = await render();
    expect(html).toContain("This couldn&#x27;t load. Refresh to try again.");
    expect(errors).toHaveBeenCalledWith(
      'Overview widget "decisions" failed to load',
      expect.any(Error),
    );
    // Everything else is there: Open forms, Votes with its real total, Up next.
    expect(html).toContain("Open forms");
    expect(html).toContain('aria-label="Vote: Pizza or tacos?"');
    expect(html).toContain('id="up-next-heading"');
    errors.mockRestore();
  });

  it("ties My tasks, This week and the stat strip to what's linked and due", async () => {
    const late = {
      id: "t_late",
      title: "Book the room",
      status: "NOT_STARTED",
      visibility: "ORG",
      dueDate: new Date("2026-10-01T00:00:00Z"),
      blockedReason: null,
      parentTask: null,
    };
    mocks.getMyOpenTasks.mockResolvedValue({ total: 4, overdue: 1, tasks: [late] });
    db.task.count.mockResolvedValue(1);
    // One late, and three in the week of the Fall Social (Fri, Oct 9).
    db.task.findMany.mockResolvedValue([
      { id: "t_late", title: "Book the room", dueDate: new Date("2026-10-01T00:00:00Z") },
      { id: "t_a", title: "Order pizza", dueDate: new Date("2026-10-06T00:00:00Z") },
      { id: "t_b", title: "Print flyers", dueDate: new Date("2026-10-07T00:00:00Z") },
      { id: "t_c", title: "Confirm the DJ", dueDate: new Date("2026-10-09T00:00:00Z") },
    ]);
    const social = {
      ...meeting,
      id: "e_social",
      title: "Fall Social",
      kind: "SOCIAL",
      startsAt: new Date("2026-10-10T00:00:00Z"),
      endsAt: new Date("2026-10-10T03:00:00Z"),
    };
    mocks.getUpcomingEvents.mockImplementation(
      async (_db: unknown, _org: string, _now: Date, _n: number, only?: string) =>
        only === "meetings" ? [] : [social],
    );
    mocks.loadLinkedChips.mockResolvedValue(
      new Map([
        [
          "task:t_late",
          [
            {
              kind: "event",
              label: "Fall Social",
              href: "/app/cbc/meetings/e_social",
              ref: { kind: "event", id: "e_social" },
            },
          ],
        ],
      ]),
    );
    const html = await render();
    // The stat strip's sentence.
    expect(html).toContain("is 4 days late");
    // My tasks: the task's linked event as a chip, and the crowded week.
    expect(html).toContain('title="Event: Fall Social"');
    expect(html).toContain("3 of your tasks land in Fall Social week:");
    // This week: deadlines beside the events, the late one on today.
    expect(html).toContain("Due: Order pizza");
    expect(html).toContain("Book the room, overdue");
    expect(html).toContain("free evenings");
  });

  it("no longer offers People, notes, uploads or the next sign-up on Home", async () => {
    const html = await render();
    expect(html).not.toContain("Recent notes");
    expect(html).not.toContain("Recent uploads");
    expect(html).not.toContain("Next sign-up");
    expect(html).toContain("Pick up where you left off");
  });

  it("shows a next step when there is nothing pinned or coming up", async () => {
    const html = await render();
    expect(html).toContain("Nothing pinned yet");
    expect(html).toContain("Nothing this week.");
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
  it("greets in the display face with the date and organization on a plain line", async () => {
    const html = await render();
    expect(html).toContain("Monday, October 5, Claude Builders Club");
    expect(html).not.toContain('class="eyebrow');
  });

  it("says beside the date how many members are online, opening People on its Online filter", async () => {
    const html = await render();
    expect(html).toContain("3 members online");
    expect(html).toContain("/people?online=1");
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
    expect(html).toContain("Next 14 days");
    expect(html).not.toContain("Open tasks");
    expect(html.indexOf("Due this week")).toBeLessThan(html.indexOf('id="up-next-heading"'));
    expect(html.indexOf('id="up-next-heading"')).toBeLessThan(html.indexOf("Open forms"));
  });

  it("shows owners the organization's first steps until each is done or checked off", async () => {
    mocks.getOrgContextBySlug.mockResolvedValue({
      user: viewer,
      organization: { ...org, logo: null },
      role: "OWNER",
      settings: { startedSkipped: ["database"] },
    });
    db.budgetPeriod.count.mockResolvedValue(0);
    db.databaseDefinition.count.mockResolvedValue(0);
    const html = await render();
    expect(html).toContain("Get your organization started");
    expect(html).toContain("Set up your budgets");
    expect(html).toContain("Create a task or an epic");
    expect(html).not.toContain("sections");
    expect(html).not.toContain("Name the organization");
    expect(html).toContain("Hide");

    // Everything done or checked off: the card is gone.
    db.membership.count.mockResolvedValue(5);
    db.event.count.mockResolvedValue(2);
    db.task.count.mockResolvedValue(3);
    db.budgetPeriod.count.mockResolvedValue(1);
    mocks.getOrgContextBySlug.mockResolvedValue({
      user: viewer,
      organization: { ...org, logo: { key: "k" } },
      role: "OWNER",
      settings: { startedSkipped: ["database", "teams"], eventTypes: [] },
    });
    expect(await render()).not.toContain("Get your organization started");
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
    expect(html).toContain("Today, 7:00 PM");
    expect(html).toContain("Can&#x27;t go");
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
