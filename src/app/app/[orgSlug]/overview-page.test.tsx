import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { computeRunway } from "@/lib/finance/stats";

/**
 * The org overview, at the page level: who sees the club's money, what "my
 * tasks" asks for and how it reads, and which timezone the events use. The
 * queries themselves run under RLS (private tasks and other people's private
 * notes are not there); here they are mocked, so this pins the page's own
 * decisions.
 */

const mocks = vi.hoisted(() => ({
  getOrgContextBySlug: vi.fn(),
  getMyOpenTasks: vi.fn(),
  getUpcomingEvents: vi.fn(),
  getViewerRsvps: vi.fn(),
  getRecentNotes: vi.fn(),
  getDashboardData: vi.fn(),
  getMoneyOwedToUser: vi.fn(),
  loadSetupState: vi.fn(),
}));

const db = {
  user: { findUnique: vi.fn() },
  task: { count: vi.fn() },
  event: { count: vi.fn() },
};

vi.mock("@/server/db/context", () => ({
  getOrgContextBySlug: mocks.getOrgContextBySlug,
  withOrgTx: (_orgId: string, fn: (ctx: { db: typeof db }) => unknown) =>
    Promise.resolve(fn({ db })),
}));
vi.mock("@/server/tasks/queries", () => ({ getMyOpenTasks: mocks.getMyOpenTasks }));
vi.mock("@/app/app/[orgSlug]/calendar/queries", () => ({
  getUpcomingEvents: mocks.getUpcomingEvents,
  getViewerRsvps: mocks.getViewerRsvps,
}));
vi.mock("@/app/app/[orgSlug]/notes/queries", () => ({ getRecentNotes: mocks.getRecentNotes }));
vi.mock("@/app/app/[orgSlug]/finance/queries", () => ({
  getDashboardData: mocks.getDashboardData,
  getMoneyOwedToUser: mocks.getMoneyOwedToUser,
}));
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
  db.user.findUnique.mockResolvedValue({ timezone: "America/Los_Angeles" });
  db.task.count.mockResolvedValue(0);
  db.event.count.mockResolvedValue(0);
  mocks.getMyOpenTasks.mockResolvedValue({ tasks: [], total: 0, overdue: 0 });
  mocks.getUpcomingEvents.mockResolvedValue([]);
  mocks.getViewerRsvps.mockResolvedValue(new Map());
  mocks.getRecentNotes.mockResolvedValue([]);
  mocks.getMoneyOwedToUser.mockResolvedValue(1_250);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("org overview", () => {
  it("shows a member what the club owes them, and never reads the club's finances", async () => {
    const html = await render();
    expect(mocks.getDashboardData).not.toHaveBeenCalled();
    expect(html).toContain("Money owed to you");
    expect(html).toContain("$12.50");
    expect(html).not.toContain("Club balance");
  });

  it("shows a treasurer the balance and when it runs out", async () => {
    mocks.getOrgContextBySlug.mockResolvedValue({
      user: viewer,
      organization: org,
      role: "TREASURER",
    });
    const period = { startsOn: new Date("2026-07-01"), endsOn: new Date("2027-06-30") };
    mocks.getDashboardData.mockResolvedValue({
      period: { id: "p_1", label: "FY 2026-27", ...period },
      balanceCents: 30_000,
      runway: computeRunway({
        period,
        balanceCents: 30_000,
        spending: [{ amountCents: 90_000, occurredAt: new Date("2026-09-01") }],
        expectedIncomeCents: 0,
        meetingStarts: [],
        now: NOW,
      }),
    });

    const html = await render();
    expect(mocks.getDashboardData).toHaveBeenCalledWith(db, "org_cbc", NOW);
    expect(html).toContain("Club balance");
    expect(html).toContain("$300.00 · FY 2026-27");
    // $900 over the 90-day window is $10 a day: $300 lasts 30 days.
    expect(html).toContain("Runs out Nov 4, 2026");
    expect(html).toContain("$12.50 owed to you");
    expect(html).not.toContain("Money owed to you");
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
      limit: 6,
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
    expect(mocks.getUpcomingEvents).toHaveBeenCalledWith(db, "org_cbc", NOW, 5);
    expect(html).toContain('href="/app/cbc/calendar/e_1"');
    expect(html).toContain("Today, 6:00 PM – 8:00 PM");
    expect(html).toContain("Workshop");
    expect(html).toContain("Curry 342");
    expect(html).toContain("Going");
  });

  it("lists recently edited notes the viewer may read", async () => {
    mocks.getRecentNotes.mockResolvedValue([
      {
        id: "n_1",
        title: "E-board minutes",
        visibility: "ORGANIZATION",
        updatedAt: new Date("2026-10-05T15:00:00Z"),
        updatedBy: { id: "u_2", name: "Oliver Ward", image: null, avatar: null },
      },
    ]);

    const html = await render();
    expect(mocks.getRecentNotes).toHaveBeenCalledWith(db, "org_cbc", "u_viewer", 5);
    expect(html).toContain('href="/app/cbc/notes/n_1"');
    expect(html).toContain("E-board minutes");
    expect(html).toContain("Oliver Ward · about 2 hours ago");
  });
});
