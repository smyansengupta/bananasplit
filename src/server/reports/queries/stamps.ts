import { num } from "../sql";
import type { StampsReport } from "../types";
import { sessionsInRange, type ReportQuery } from "./common";

/**
 * 7. Stamp-card progress: for each OrgSettings.stampMilestones value m, the
 * stamp cards that reached m in the range, i.e. check-ins at a session of
 * the range with Attendance.stampNumber = m (the 4b rollup: the n-th
 * non-suppressed check-in of that person in that term). Stamps reset each
 * term, so a card is one person in one term; for a single-term range this
 * equals ContactTermStats.stampCount >= m restricted to people who got
 * there in the range. stampHolders = people with any stamp in the range.
 */
export const queryStamps: ReportQuery<StampsReport> = async (db, args) => {
  const rows = await db.$queryRaw<{ milestone: number | null; reached: number; holders: number }[]>`
    WITH s AS (${sessionsInRange(args)}),
    att AS (
      SELECT a."contactId", a."stampNumber"
        FROM public."Attendance" a
        JOIN s ON s."id" = a."eventId"
       WHERE a."organizationId" = ${args.orgId} AND a."suppressedAt" IS NULL
    ),
    m AS (
      SELECT DISTINCT x.milestone
        FROM public."OrgSettings" st, unnest(st."stampMilestones") AS x(milestone)
       WHERE st."organizationId" = ${args.orgId} AND x.milestone > 0
    )
    SELECT m.milestone,
           (SELECT count(*)::int FROM att WHERE att."stampNumber" = m.milestone) AS reached,
           (SELECT count(DISTINCT att."contactId")::int FROM att) AS holders
      FROM (SELECT 1) one
      LEFT JOIN m ON true
     ORDER BY m.milestone`;

  return {
    milestones: rows
      .filter((r) => r.milestone !== null)
      .map((r) => ({ milestone: num(r.milestone), reached: num(r.reached) })),
    stampHolders: num(rows[0]?.holders),
  };
};
