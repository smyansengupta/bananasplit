// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Home's loaders against a mocked database (no real one): which meeting a
 * decision can go on next, which event Who owns what picks, who may read
 * individual ballots (the SQL rule, mirrored), and that a Home view right
 * after the last one doesn't write.
 */

const decisions = vi.hoisted(() => ({
  listOpenDecisions: vi.fn(),
  countOpenDecisions: vi.fn(),
}));
vi.mock("@/server/decisions/decisions", () => decisions);
vi.mock("@/server/db/context", () => ({ withOrgTx: vi.fn() }));
vi.mock("@/server/databases/ballot-results", () => ({ loadPollResults: vi.fn() }));
vi.mock("@/server/polls/question-polls", () => ({ pollVoteCounts: vi.fn(async () => []) }));

const { loadDecisions } = await import("./decisions");
const { loadWhoOwnsWhat } = await import("./who-owns-what");
const { seesBallots } = await import("./votes");
const { markHomeVisit } = await import("./since-you-were-here");

const NOW = new Date("2026-11-01T15:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

beforeEach(() => vi.clearAllMocks());

describe("loadDecisions", () => {
  const open = (id: string, meetingIds: string[]) => ({
    id,
    question: `Question ${id}`,
    detail: null,
    status: "OPEN",
    owner: null,
    createdAt: day(-3),
    dueAt: null,
    links: meetingIds.map((m) => ({
      kind: "meeting",
      label: m,
      href: `/app/cbc/meetings/${m}`,
    })),
    poll: null,
  });

  it("puts a decision on its linked meeting ahead, else the next one in a past meeting's series", async () => {
    decisions.listOpenDecisions.mockResolvedValue([
      open("d_past", ["e_sync_old"]),
      open("d_ahead", ["e_retro"]),
      open("d_none", []),
    ]);
    const db = {
      decision: {
        findMany: vi.fn(async () => [
          { id: "d_past", createdById: "u_raiser" },
          { id: "d_ahead", createdById: null },
          { id: "d_none", createdById: "u_me" },
        ]),
      },
      event: {
        findMany: vi
          .fn()
          // The meetings they link to.
          .mockResolvedValueOnce([
            {
              id: "e_sync_old",
              title: "Exec sync",
              startsAt: day(-6),
              seriesId: "s_sync",
              description: "- Budget",
            },
            {
              id: "e_retro",
              title: "Retro",
              startsAt: day(2),
              seriesId: null,
              description: "- Question d_ahead",
            },
          ])
          // What's next in the past one's series.
          .mockResolvedValueOnce([
            {
              id: "e_sync_next",
              title: "Exec sync",
              startsAt: day(1),
              seriesId: "s_sync",
              description: "- Budget",
            },
          ]),
      },
    };
    const out = await loadDecisions(db as never, "org", "cbc", {
      now: NOW,
      timeZone: "UTC",
      viewer: { userId: "u_me", role: "MEMBER" },
    });
    const byId = new Map(out.rows.map((r) => [r.id, r]));
    expect(byId.get("d_past")?.agenda).toMatchObject({
      eventId: "e_sync_next",
      href: "/app/cbc/meetings/e_sync_next",
      dayKey: "2026-11-02",
      onAgenda: false,
    });
    // Already written in the agenda.
    expect(byId.get("d_ahead")?.agenda).toMatchObject({ eventId: "e_retro", onAgenda: true });
    expect(byId.get("d_none")?.agenda).toBeNull();
    // Who raised each, for who may settle it.
    expect(byId.get("d_past")?.createdById).toBe("u_raiser");
    // The series read only asks for what's still ahead.
    expect(db.event.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ seriesId: { in: ["s_sync"] }, startsAt: { gte: NOW } }),
      }),
    );
    // Fewer than the page's worth: the count is the rows, no second read.
    expect(out.total).toBe(3);
    expect(decisions.countOpenDecisions).not.toHaveBeenCalled();
  });

  it("counts every open decision when the list is full", async () => {
    decisions.listOpenDecisions.mockResolvedValue([open("a", []), open("b", [])]);
    decisions.countOpenDecisions.mockResolvedValue(10);
    const db = { decision: { findMany: vi.fn(async () => []) }, event: { findMany: vi.fn() } };
    const out = await loadDecisions(db as never, "org", "cbc", {
      now: NOW,
      timeZone: "UTC",
      viewer: { userId: "u_me", role: "MEMBER" },
      limit: 2,
    });
    expect(out.rows).toHaveLength(2);
    expect(out.total).toBe(10);
  });
});

describe("loadWhoOwnsWhat", () => {
  const owner = { id: "u_o", name: "Oliver Wu", image: null, avatar: null };

  it("picks the event with the most live, visible tasks linked to it", async () => {
    const db = {
      itemLink: {
        findMany: vi.fn(async () => [
          // Three links to the social, but two of the tasks are deleted or private.
          { id: "l1", fromKind: "event", fromId: "e_social", toKind: "task", toId: "t_gone" },
          { id: "l2", fromKind: "task", fromId: "t_hidden", toKind: "event", toId: "e_social" },
          { id: "l3", fromKind: "event", fromId: "e_social", toKind: "task", toId: "t_a" },
          // Two to the workshop, both there.
          { id: "l4", fromKind: "event", fromId: "e_workshop", toKind: "task", toId: "t_b" },
          { id: "l5", fromKind: "task", fromId: "t_c", toKind: "event", toId: "e_workshop" },
        ]),
      },
      task: {
        findMany: vi
          .fn()
          // Which linked tasks are there for the viewer.
          .mockResolvedValueOnce([{ id: "t_a" }, { id: "t_b" }, { id: "t_c" }])
          // The chosen event's tasks.
          .mockResolvedValueOnce([
            {
              id: "t_b",
              title: "Book the room",
              type: "TASK",
              color: null,
              parentTask: {
                id: "ep",
                title: "Workshop",
                type: "EPIC",
                color: null,
                parentTask: null,
              },
              status: "IN_PROGRESS",
              dueDate: null,
              blockedReason: null,
              owner,
            },
            {
              id: "t_c",
              title: "Print handouts",
              type: "TASK",
              color: null,
              parentTask: null,
              status: "COMPLETED",
              dueDate: null,
              blockedReason: null,
              owner,
            },
          ]),
      },
      taskLabel: { findMany: vi.fn(async () => []) },
    };
    const out = await loadWhoOwnsWhat(db as never, "org", "cbc", {
      now: NOW,
      todayKey: "2026-11-01",
      timeZone: "UTC",
      upcoming: [
        { id: "e_past", title: "Yesterday", startsAt: day(-1) },
        { id: "e_social", title: "Fall Social", startsAt: day(3) },
        { id: "e_workshop", title: "Workshop", startsAt: day(5) },
        { id: "e_far", title: "Gala", startsAt: day(40) },
      ],
    });
    expect(out?.event).toMatchObject({ id: "e_workshop", href: "/app/cbc/calendar/e_workshop" });
    // Only the events in the next three weeks are asked about, and only their task links.
    expect(db.itemLink.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            {
              fromKind: "event",
              fromId: { in: ["e_social", "e_workshop"] },
              toKind: { in: ["task"] },
            },
            {
              toKind: "event",
              toId: { in: ["e_social", "e_workshop"] },
              fromKind: { in: ["task"] },
            },
          ],
        }),
      }),
    );
    expect(db.task.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ where: expect.objectContaining({ deletedAt: null }) }),
    );
    // Nobody's seat is empty, so no suggestions were read.
    expect(out?.suggestions).toEqual([]);
  });

  it("is nothing when no event coming up has work linked", async () => {
    const db = { itemLink: { findMany: vi.fn(async () => []) }, task: { findMany: vi.fn() } };
    const out = await loadWhoOwnsWhat(db as never, "org", "cbc", {
      now: NOW,
      todayKey: "2026-11-01",
      timeZone: "UTC",
      upcoming: [{ id: "e_social", title: "Fall Social", startsAt: day(3) }],
    });
    expect(out).toBeNull();
    expect(db.task.findMany).not.toHaveBeenCalled();
  });
});

describe("seesBallots", () => {
  it("mirrors app.can_view_ballot_rows: owner only by default", () => {
    expect(seesBallots("OWNER", null)).toBe(true);
    expect(seesBallots("ADMIN", null)).toBe(false);
    expect(seesBallots("OWNER", "OWNER_ONLY")).toBe(true);
    expect(seesBallots("ADMIN", "OWNER_ONLY")).toBe(false);
  });

  it("lets admins in only with OWNER_AND_ADMINS, and nobody with NOBODY", () => {
    expect(seesBallots("ADMIN", "OWNER_AND_ADMINS")).toBe(true);
    expect(seesBallots("OWNER", "OWNER_AND_ADMINS")).toBe(true);
    expect(seesBallots("MEMBER", "OWNER_AND_ADMINS")).toBe(false);
    // A treasurer reads ballots as a member does.
    expect(seesBallots("TREASURER", "OWNER_AND_ADMINS")).toBe(false);
    expect(seesBallots("OWNER", "NOBODY")).toBe(false);
  });
});

describe("markHomeVisit", () => {
  const prefs = (homeVisitAt: Date | null) => ({
    memberPrefs: {
      findUnique: vi.fn(async () => ({ homeVisitAt, homePrevVisitAt: day(-2) })),
      upsert: vi.fn(async () => ({ userId: "u" })),
    },
  });

  it("doesn't write when the last stamp is under a minute old", async () => {
    const db = prefs(new Date(NOW.getTime() - 20_000));
    expect(await markHomeVisit(db as never, "org", "u", NOW)).toEqual(day(-2));
    expect(db.memberPrefs.upsert).not.toHaveBeenCalled();
  });

  it("stamps the visit otherwise", async () => {
    const db = prefs(new Date(NOW.getTime() - 5 * 60_000));
    await markHomeVisit(db as never, "org", "u", NOW);
    expect(db.memberPrefs.upsert).toHaveBeenCalledTimes(1);
  });
});
