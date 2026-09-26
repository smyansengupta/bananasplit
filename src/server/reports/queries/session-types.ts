import { num, round1 } from "../sql";
import type { SessionTypesReport } from "../types";
import { sessionsInRange, type ReportQuery } from "./common";

/**
 * 3. Session breakdown: per Event.kind, the number of sessions, check-ins,
 * and the average, median and highest attendance per session. Sorted by
 * average attendance, highest first.
 */
export const querySessionTypes: ReportQuery<SessionTypesReport> = async (db, args) => {
  const rows = await db.$queryRaw<
    { kind: string; sessions: number; checkins: number; avg: number; median: number; max: number }[]
  >`
    WITH s AS (${sessionsInRange(args)})
    SELECT s.kind,
           count(*)::int AS sessions,
           sum(s.n)::int AS checkins,
           avg(s.n)::float8 AS avg,
           (percentile_cont(0.5) WITHIN GROUP (ORDER BY s.n))::float8 AS median,
           max(s.n)::int AS max
      FROM s
     GROUP BY s.kind
     ORDER BY avg DESC, s.kind`;

  return {
    rows: rows.map((r) => ({
      kind: r.kind,
      sessions: num(r.sessions),
      checkIns: num(r.checkins),
      average: round1(num(r.avg)),
      median: round1(num(r.median)),
      max: num(r.max),
    })),
  };
};
