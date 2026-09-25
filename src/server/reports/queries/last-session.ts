import { Prisma } from "@/generated/prisma/client";

import { num, pct } from "../sql";
import type { LastSessionReport } from "../types";
import { sessionColumns, sessionsInRange, toSessionPoint, type ReportQuery, type SessionRow } from "./common";

/**
 * 1. Last session: the latest session in the range and the session right
 * before it (any date, so the first session of a range still has a
 * comparison), in ONE statement so the base and the delta always come from
 * the same snapshot. firstTimers counts check-ins that were the person's
 * first-ever visit (Attendance.isFirstVisit).
 */
export const queryLastSession: ReportQuery<LastSessionReport> = async (db, args) => {
  const rows = await db.$queryRaw<(SessionRow & { which: string; first_timers: number })[]>`
    WITH s AS (${sessionsInRange(args)}),
    cur AS (
      SELECT * FROM s ORDER BY s.starts_at DESC, s."id" DESC LIMIT 1
    ),
    prev AS (
      SELECT e."id", e."title", e."kind"::text AS kind, e."startsAt" AS starts_at, e."attendanceCount" AS n
        FROM public."Event" e, cur
       WHERE e."organizationId" = ${args.orgId}
         AND e."deletedAt" IS NULL
         AND e."mergedIntoId" IS NULL
         AND e."attendanceCount" > 0
         AND (e."startsAt", e."id") < (cur.starts_at, cur."id")
       ORDER BY e."startsAt" DESC, e."id" DESC
       LIMIT 1
    ),
    pair AS (
      SELECT 'current' AS which, cur.* FROM cur
      UNION ALL
      SELECT 'previous' AS which, prev.* FROM prev
    )
    SELECT p.which,
           ${sessionColumns(Prisma.sql`p`, args.tz)},
           (SELECT count(*)::int
              FROM public."Attendance" a
             WHERE a."organizationId" = ${args.orgId}
               AND a."eventId" = p."id"
               AND a."suppressedAt" IS NULL
               AND a."isFirstVisit") AS first_timers
      FROM pair p`;

  const cur = rows.find((r) => r.which === "current");
  const prev = rows.find((r) => r.which === "previous");
  const current = cur ? { ...toSessionPoint(cur), firstTimers: num(cur.first_timers) } : null;
  const previous = prev ? toSessionPoint(prev) : null;
  const delta = current && previous ? current.checkIns - previous.checkIns : null;
  return {
    current,
    previous,
    delta,
    deltaPct: delta !== null && previous ? pct(delta, previous.checkIns) : null,
  };
};
