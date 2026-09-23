// @vitest-environment node
// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { TZDate } from "@date-fns/tz";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The report SQL against the real roles and policies of the local database,
 * on a hand-built fixture org whose numbers are known by construction
 * (./testing/fixture.ts). Every query runs on the service path
 * (withSystemOrgTx, app_service, no user GUC) exactly as the cached loaders
 * run it. Skipped when the database is not reachable.
 */

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock }));

import { parseDbViewParams } from "@/lib/databases/href";
import { nextCache } from "@/server/cache/invalidate";
import { tags } from "@/server/cache/tags";
import { disconnectAll } from "@/server/db/clients";
import { withOrgAction, withSystemOrgTx, type TxClient } from "@/server/db/context";

import { getReport } from "./cache";
import { markReportsDataChanged } from "./data-version";
import { reportLinks } from "./links";
import { queryAttendance } from "./queries/attendance";
import { queryBallots } from "./queries/ballots";
import type { ReportQueryArgs } from "./queries/common";
import { queryLastSession } from "./queries/last-session";
import { queryRetention } from "./queries/retention";
import { querySessionTypes } from "./queries/session-types";
import { querySignups } from "./queries/signups";
import { queryStamps } from "./queries/stamps";
import { addDays } from "./range";
import { createReportFixture, FIXTURE_AS_OF, FIXTURE_TZ, ownerClient, type ReportFixture } from "./testing/fixture";
import type { ReportTier } from "./types";
import { queryDatabaseVisibility, visibleReportIds } from "./visibility";

const owner = ownerClient();
let reachable = false;
if (owner) {
  try {
    await owner.$queryRaw`SELECT 1`;
    reachable = true;
  } catch {
    reachable = false;
  }
}

const FALL = { from: "2026-07-01", to: "2026-12-31" };
const SEPTEMBER = { from: "2026-09-01", to: "2026-09-30" };
const SPRING = { from: "2026-01-01", to: "2026-06-30" };
const ALL = { from: null, to: null };

describe.skipIf(!reachable)("report SQL on the fixture org", () => {
  let fx: ReportFixture;

  beforeAll(async () => {
    fx = await createReportFixture(owner!);
  }, 60_000);

  afterAll(async () => {
    await fx?.cleanup();
    await owner?.$disconnect();
    await disconnectAll();
  });

  const args = (range: { from: string | null; to: string | null }, tier: ReportTier = "OWNER"): ReportQueryArgs => ({
    orgId: fx.orgId,
    tier,
    tz: FIXTURE_TZ,
    asOf: FIXTURE_AS_OF,
    ...range,
  });

  /** Runs `fn` on the service path with the session TimeZone forced to `sessionTz`. */
  function service<T>(fn: (db: TxClient) => Promise<T>, sessionTz = "UTC"): Promise<T> {
    return withSystemOrgTx(fx.orgId, async ({ db }) => {
      await db.$queryRaw`SELECT set_config('TimeZone', ${sessionTz}, true) AS tz`;
      return fn(db);
    });
  }

  describe("1. last session", () => {
    it("compares the latest session with the one before it", async () => {
      const r = await service((db) => queryLastSession(db, args(FALL)));
      expect(r.current).toMatchObject({
        id: fx.events.e6,
        title: "Midnight Hack",
        kind: "HACKATHON",
        localDate: "2026-11-01",
        startsAt: "2026-11-01T04:00:00.000Z",
        checkIns: 3,
        firstTimers: 1,
      });
      expect(r.previous).toMatchObject({ id: fx.events.e5, localDate: "2026-10-31", checkIns: 2 });
      expect(r.delta).toBe(1);
      expect(r.deltaPct).toBe(50);
    });

    it("skips deleted events and board meetings with no check-ins", async () => {
      const r = await service((db) => queryLastSession(db, args(SEPTEMBER)));
      expect(r.current).toMatchObject({ id: fx.events.e4, checkIns: 2, firstTimers: 0 });
      expect(r.previous).toMatchObject({ id: fx.events.e3, checkIns: 3 });
      expect(r.delta).toBe(-1);
      expect(r.deltaPct).toBe(-33.3);
    });

    it("has no delta for the first session ever", async () => {
      const r = await service((db) => queryLastSession(db, args(SPRING)));
      expect(r.current).toMatchObject({ id: fx.events.e1, checkIns: 2 });
      expect(r.previous).toBeNull();
      expect(r.delta).toBeNull();
      expect(r.deltaPct).toBeNull();
    });

    it("is empty for a range without sessions", async () => {
      const r = await service((db) => queryLastSession(db, args({ from: "2026-12-01", to: "2026-12-31" })));
      expect(r).toEqual({ current: null, previous: null, delta: null, deltaPct: null });
    });
  });

  describe("2. attendance over time", () => {
    it("has one point per session, oldest first, with totals", async () => {
      const r = await service((db) => queryAttendance(db, args(FALL)));
      expect(r.sessions.map((s) => [s.title, s.localDate, s.checkIns])).toEqual([
        ["Kickoff Info Session", "2026-09-02", 4],
        ["Workshop A", "2026-09-09", 3],
        ["Welcome Social", "2026-09-12", 2],
        ["Workshop B", "2026-10-31", 2],
        ["Midnight Hack", "2026-11-01", 3],
      ]);
      expect(r.totalSessions).toBe(5);
      expect(r.totalCheckIns).toBe(14);
      expect(r.average).toBe(2.8);
      expect(r.peak?.id).toBe(fx.events.e2);
    });

    it("covers every term for all time", async () => {
      const r = await service((db) => queryAttendance(db, args(ALL)));
      expect(r.totalSessions).toBe(6);
      expect(r.totalCheckIns).toBe(16);
      expect(r.average).toBe(2.7);
    });
  });

  describe("3. session breakdown", () => {
    it("averages attendance per session type", async () => {
      const r = await service((db) => querySessionTypes(db, args(FALL)));
      expect(r.rows).toEqual([
        { kind: "INFO_SESSION", sessions: 1, checkIns: 4, average: 4, median: 4, max: 4 },
        { kind: "HACKATHON", sessions: 1, checkIns: 3, average: 3, median: 3, max: 3 },
        { kind: "WORKSHOP", sessions: 2, checkIns: 5, average: 2.5, median: 2.5, max: 3 },
        { kind: "SOCIAL", sessions: 1, checkIns: 2, average: 2, median: 2, max: 2 },
      ]);
    });
  });

  describe("4. retention", () => {
    it("splits new and returning, counts regulars and the lapsed", async () => {
      const r = await service((db) => queryRetention(db, args(FALL)));
      expect(r.perSession.map((s) => [s.title, s.newAttendees, s.returning])).toEqual([
        ["Kickoff Info Session", 2, 2],
        ["Workshop A", 1, 2],
        ["Welcome Social", 0, 2],
        ["Workshop B", 0, 2],
        ["Midnight Hack", 1, 2],
      ]);
      expect(r).toMatchObject({
        attendees: 6,
        newAttendees: 4,
        returning: 2,
        regulars: 2,
        lapsedTotal: 3,
        lapsedInRange: 3,
        lapsedAfterSessions: 2,
      });
    });

    it("counts only the lapses that began in a shorter range", async () => {
      const r = await service((db) => queryRetention(db, args(SEPTEMBER)));
      expect(r).toMatchObject({ attendees: 5, newAttendees: 3, returning: 2, regulars: 1, lapsedInRange: 2 });
    });
  });

  describe("5. signups", () => {
    it("buckets by org-local week and measures conversion", async () => {
      const r = await service((db) => querySignups(db, args(FALL)));
      expect(r.total).toBe(8);
      expect(r.converted).toBe(4);
      expect(r.conversionPct).toBe(50);
      expect(r.medianDaysToFirst).toBe(1.5);
      expect(r.byChannel).toEqual([
        { channel: "WEB", signups: 7, converted: 3 },
        { channel: "TYPEFORM", signups: 1, converted: 1 },
      ]);
      expect(r.weeks).toHaveLength(27);
      expect(r.weeks[0]).toEqual({ week: "2026-06-29", signups: 0, converted: 0 });
      expect(r.weeks.at(-1)).toEqual({ week: "2026-12-28", signups: 0, converted: 0 });
      expect(r.weeks.filter((w) => w.signups > 0)).toEqual([
        { week: "2026-08-24", signups: 1, converted: 1 },
        { week: "2026-08-31", signups: 1, converted: 1 },
        { week: "2026-10-19", signups: 1, converted: 0 },
        { week: "2026-10-26", signups: 4, converted: 2 },
        { week: "2026-11-02", signups: 1, converted: 0 },
      ]);
    });

    it("stops the weekly series at the current week", async () => {
      const r = await service((db) => querySignups(db, { ...args(FALL), asOf: "2026-10-28T12:00:00Z" }));
      expect(r.weeks.at(-1)?.week).toBe("2026-10-26");
      expect(r.total).toBe(8);
    });

    it("excludes suppressed signups and other terms", async () => {
      const r = await service((db) => querySignups(db, args(ALL)));
      expect(r.total).toBe(9);
      expect(r.weeks[0].week).toBe("2026-03-30");
    });
  });

  describe("6. ballots", () => {
    it("gives the owner every cell, with turnout against the linked session", async () => {
      const r = await service((db) => queryBallots(db, args(FALL, "OWNER")));
      expect(r.hidden).toBe(false);
      expect(r.fullCounts).toBe(true);
      expect(r.ballots.map((b) => b.id)).toEqual([fx.ballots.topics]);
      const [b] = r.ballots;
      expect(b.ballots).toBe(5);
      expect(b.linkedSession).toMatchObject({ id: fx.events.e2, checkIns: 4, localDate: "2026-09-02" });
      expect(b.turnoutPct).toBe(125);
      expect(b.freeTextQuestions).toBe(1);
      const topics = b.questions.find((q) => q.key === "topics")!;
      expect(topics.type).toBe("slots");
      expect(topics.ballots).toBe(5);
      expect(topics.options.map((o) => [o.key, o.votes, o.firstChoice, o.borda, o.suppressed])).toEqual([
        ["a", 5, 3, 9, false],
        ["b", 3, 1, 5, false],
        ["c", 3, 1, 5, false],
        ["d", 0, 0, 0, false],
      ]);
      const format = b.questions.find((q) => q.key === "format")!;
      expect(format.options.map((o) => [o.label, o.votes])).toEqual([
        ["In person", 4],
        ["Hybrid", 1],
      ]);
      const first = b.questions.find((q) => q.key === "first")!;
      expect(first.ballots).toBe(4);
      expect(first.options.map((o) => [o.label, o.votes])).toEqual([
        ["Yes", 3],
        ["No", 1],
      ]);
      expect(b.questions.some((q) => q.key === "notes")).toBe(false);
    });

    it("k-suppresses cells below ballotMinCellSize for a member, with no user GUC", async () => {
      const r = await service((db) => queryBallots(db, args(FALL, "MEMBER")));
      expect(r.fullCounts).toBe(false);
      expect(r.minCellSize).toBe(3);
      const [b] = r.ballots;
      const cells = (key: string) =>
        b.questions.find((q) => q.key === key)!.options.map((o) => [o.key, o.votes, o.suppressed]);
      expect(cells("topics")).toEqual([
        ["a", 5, false],
        ["b", 3, false],
        ["c", 3, false],
        ["d", null, true],
      ]);
      expect(cells("format")).toEqual([
        ["in-person", 4, false],
        ["hybrid", null, true],
      ]);
      expect(cells("first")).toEqual([
        ["yes", 3, false],
        ["no", null, true],
      ]);
      // Aggregates only: nothing in the payload names a voter or a free-text answer.
      expect(JSON.stringify(r)).not.toMatch(/voter|contact|"hi"/i);
    });

    it("treats an ADMIN as suppressed under OWNER_ONLY and full under OWNER_AND_ADMINS", async () => {
      const before = await service((db) => queryBallots(db, args(FALL, "ADMIN")));
      expect(before.fullCounts).toBe(false);
      await owner!.orgSettings.update({
        where: { organizationId: fx.orgId },
        data: { ballotIndividualVisibility: "OWNER_AND_ADMINS" },
      });
      try {
        const after = await service((db) => queryBallots(db, args(FALL, "ADMIN")));
        expect(after.fullCounts).toBe(true);
        const format = after.ballots[0].questions.find((q) => q.key === "format")!;
        expect(format.options.find((o) => o.key === "hybrid")?.votes).toBe(1);
      } finally {
        await owner!.orgSettings.update({
          where: { organizationId: fx.orgId },
          data: { ballotIndividualVisibility: "OWNER_ONLY" },
        });
      }
    });

    it("hides results from members when the org turns them off", async () => {
      await owner!.orgSettings.update({
        where: { organizationId: fx.orgId },
        data: { ballotResultsVisibleToMembers: false },
      });
      try {
        const member = await service((db) => queryBallots(db, args(FALL, "MEMBER")));
        expect(member).toMatchObject({ hidden: true, ballots: [] });
        const admin = await service((db) => queryBallots(db, args(FALL, "ADMIN")));
        expect(admin.hidden).toBe(false);
        expect(admin.ballots).toHaveLength(1);
      } finally {
        await owner!.orgSettings.update({
          where: { organizationId: fx.orgId },
          data: { ballotResultsVisibleToMembers: true },
        });
      }
    });

    it("lists ballots by window and never test polls", async () => {
      const all = await service((db) => queryBallots(db, args(ALL, "OWNER")));
      expect(all.ballots.map((b) => b.id)).toEqual([fx.ballots.nextTerm, fx.ballots.topics]);
      expect(all.ballots[0]).toMatchObject({ ballots: 0, linkedSession: null, turnoutPct: null });
      const spring = await service((db) => queryBallots(db, args(SPRING, "OWNER")));
      expect(spring.ballots).toEqual([]);
    });
  });

  describe("7. stamp-card progress", () => {
    it("counts the cards that reached each milestone in the range", async () => {
      const fall = await service((db) => queryStamps(db, args(FALL)));
      expect(fall).toEqual({
        milestones: [
          { milestone: 2, reached: 3 },
          { milestone: 3, reached: 2 },
          { milestone: 5, reached: 1 },
        ],
        stampHolders: 6,
      });
      const early = await service((db) => queryStamps(db, args({ from: "2026-09-01", to: "2026-10-31" })));
      expect(early.milestones.map((m) => m.reached)).toEqual([3, 2, 0]);
      expect(early.stampHolders).toBe(5);
    });
  });

  describe("timezone bucketing across the 2026-11-01 DST change", () => {
    for (const sessionTz of ["UTC", "America/New_York"]) {
      it(`is independent of the session TimeZone (${sessionTz})`, async () => {
        const weeks = await service(
          (db) => querySignups(db, args({ from: "2026-10-19", to: "2026-11-08" })),
          sessionTz,
        );
        expect(weeks.weeks).toEqual([
          { week: "2026-10-19", signups: 1, converted: 0 },
          { week: "2026-10-26", signups: 4, converted: 2 },
          { week: "2026-11-02", signups: 1, converted: 0 },
        ]);
        // Oct 25 00:00 through Nov 1 23:59 local: c7 (Oct 25 23:30 EDT) in,
        // c9 (Nov 1 23:30 EST) in, c10 (Nov 2 00:30 EST) out.
        const week = await service(
          (db) => querySignups(db, args({ from: "2026-10-25", to: "2026-11-01" })),
          sessionTz,
        );
        expect(week.total).toBe(5);
        // Nov 1 local holds only the midnight hack; Oct 31 18:00 EDT is the day before.
        const nov1 = await service(
          (db) => queryAttendance(db, args({ from: "2026-11-01", to: "2026-11-01" })),
          sessionTz,
        );
        expect(nov1.sessions.map((s) => [s.id, s.localDate])).toEqual([[fx.events.e6, "2026-11-01"]]);
        const oct31 = await service(
          (db) => queryLastSession(db, args({ from: "2026-10-31", to: "2026-10-31" })),
          sessionTz,
        );
        expect(oct31.current?.id).toBe(fx.events.e5);
        expect(oct31.current?.localDate).toBe("2026-10-31");
      });
    }
  });

  describe("visibility", () => {
    it("hides signups from members by default and shows everything to admins", async () => {
      const member = await service((db) => queryDatabaseVisibility(db, fx.orgId, "MEMBER"));
      expect(member.SIGNUPS).toBe(false);
      expect(visibleReportIds(member)).toEqual([
        "last-session",
        "attendance",
        "session-types",
        "retention",
        "ballots",
        "stamps",
      ]);
      const admin = await service((db) => queryDatabaseVisibility(db, fx.orgId, "ADMIN"));
      expect(visibleReportIds(admin)).toHaveLength(7);
    });

    it("follows a database made owner-only", async () => {
      await owner!.databaseDefinition.update({
        where: { organizationId_key: { organizationId: fx.orgId, key: "attendance" } },
        data: { memberVisibility: "OWNER" },
      });
      try {
        const admin = await service((db) => queryDatabaseVisibility(db, fx.orgId, "ADMIN"));
        expect(visibleReportIds(admin)).toEqual(["ballots"]);
        const ownerTier = await service((db) => queryDatabaseVisibility(db, fx.orgId, "OWNER"));
        expect(visibleReportIds(ownerTier)).toHaveLength(7);
      } finally {
        await owner!.databaseDefinition.update({
          where: { organizationId_key: { organizationId: fx.orgId, key: "attendance" } },
          data: { memberVisibility: "MEMBERS" },
        });
      }
    });
  });

  describe("the cached loader outside a request", () => {
    it("computes on its own service transaction from explicit arguments", async () => {
      const result = await getReport(
        "last-session",
        { orgId: fx.orgId, tier: "MEMBER", ...FALL, tz: FIXTURE_TZ, dataVersion: 0, settingsStamp: "" },
        300,
      );
      expect(result.id).toBe("last-session");
      expect(result.data.current?.id).toBe(fx.events.e6);
      expect(Number.isNaN(Date.parse(result.computedAt))).toBe(false);
    });
  });

  describe("invalidation after commit", () => {
    it("a rolled-back edit neither bumps the data version nor invalidates", async () => {
      requireUserMock.mockResolvedValue({ id: fx.userId, email: `${fx.slug}@example.test`, name: "Owner" });
      const updateTag = vi.spyOn(nextCache, "updateTag").mockImplementation(() => undefined);
      const revalidateTag = vi.spyOn(nextCache, "revalidateTag").mockImplementation(() => undefined);
      try {
        const version = () =>
          owner!.orgSettings
            .findUniqueOrThrow({ where: { organizationId: fx.orgId }, select: { reportsDataVersion: true } })
            .then((s) => s.reportsDataVersion);
        const start = await version();

        const failing = withOrgAction(async (ctx) => {
          await markReportsDataChanged(ctx);
          throw new Error("boom");
        });
        await expect(failing(fx.orgId)).rejects.toThrow("boom");
        expect(await version()).toBe(start);
        expect(updateTag).not.toHaveBeenCalled();
        expect(revalidateTag).not.toHaveBeenCalled();

        await withOrgAction(async (ctx) => markReportsDataChanged(ctx))(fx.orgId);
        expect(await version()).toBe(start + 1);
        expect(updateTag).toHaveBeenCalledTimes(1);
        expect(updateTag).toHaveBeenCalledWith(tags.reports(fx.orgId));
      } finally {
        updateTag.mockRestore();
        revalidateTag.mockRestore();
      }
    });
  });

  describe("deep links", () => {
    /**
     * A reference reading of the URL grammar for the attendance and signups
     * views (what B4's query builder does): f filters on the Prisma field,
     * from/to as org-local days on the primary date column. Rows of deleted
     * sessions are left out, as the reports leave them out.
     */
    function localDayStart(date: string): Date {
      const [y, m, d] = date.split("-").map(Number);
      return new Date(new TZDate(y, m - 1, d, 0, 0, 0, FIXTURE_TZ).getTime());
    }
    const NUMERIC = new Set(["stampNumber", "termStampTotal", "sessionsAttended", "stampCount"]);
    const BOOLEAN = new Set(["isFirstVisit"]);
    function whereFor(href: string, dateCol: string) {
      const url = new URL(href, "http://x");
      const view = parseDbViewParams(url.searchParams);
      const where: Record<string, unknown> = { organizationId: fx.orgId };
      for (const f of view.filters) {
        if (f.op === "isnull") where[f.col] = f.value === "true" ? null : { not: null };
        else if (f.op === "eq")
          where[f.col] = BOOLEAN.has(f.col) ? f.value === "true" : NUMERIC.has(f.col) ? Number(f.value) : f.value;
        else throw new Error(`unexpected op ${f.op}`);
      }
      const range: Record<string, Date> = {};
      if (view.from) range.gte = localDayStart(view.from);
      if (view.to) range.lt = localDayStart(addDays(view.to, 1));
      if (view.from || view.to) where[dateCol] = range;
      return { where, pathname: url.pathname };
    }

    it("attendance links count exactly what the cards count", async () => {
      const fall = { ...FALL, term: "fall-2026" };
      const [retention, stamps, last] = await Promise.all([
        service((db) => queryRetention(db, args(FALL))),
        service((db) => queryStamps(db, args(FALL))),
        service((db) => queryLastSession(db, args(FALL))),
      ]);
      const count = async (href: string) => {
        const { where, pathname } = whereFor(href, "checkedInAt");
        expect(pathname).toBe(`/app/${fx.slug}/databases/attendance`);
        return owner!.attendance.count({ where: { ...where, event: { deletedAt: null } } });
      };
      expect(await count(reportLinks.firstVisits(fx.slug, fall))).toBe(retention.newAttendees);
      for (const m of stamps.milestones) {
        expect(await count(reportLinks.stampMilestone(fx.slug, fall, m.milestone))).toBe(m.reached);
      }
      expect(await count(reportLinks.sessionCheckIns(fx.slug, last.current!.id))).toBe(last.current!.checkIns);
    });

    it("signup links count exactly what the card counts", async () => {
      const fall = { ...FALL, term: "fall-2026" };
      const signups = await service((db) => querySignups(db, args(FALL)));
      const count = async (href: string) => {
        const { where, pathname } = whereFor(href, "signedUpAt");
        expect(pathname).toBe(`/app/${fx.slug}/databases/signups`);
        return owner!.signup.count({ where });
      };
      expect(await count(reportLinks.signups(fx.slug, fall))).toBe(signups.total);
      expect(await count(reportLinks.convertedSignups(fx.slug, fall))).toBe(signups.converted);
    });
  });
});
