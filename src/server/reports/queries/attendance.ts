import { Prisma } from "@/generated/prisma/client";

import { num, round1 } from "../sql";
import type { AttendanceReport } from "../types";
import {
  sessionColumns,
  sessionsInRange,
  toSessionPoint,
  type ReportQuery,
  type SessionRow,
} from "./common";

/** The chart shows at most this many sessions (the most recent). */
export const MAX_SESSION_POINTS = 400;

/**
 * 2. Attendance over time: one point per session (Event.attendanceCount),
 * oldest first. The totals are window aggregates over the whole range,
 * computed before the LIMIT, so they stay exact past 400 sessions.
 */
export const queryAttendance: ReportQuery<AttendanceReport> = async (db, args) => {
  const rows = await db.$queryRaw<
    (SessionRow & { total_sessions: number; total_checkins: number })[]
  >`
    WITH s AS (${sessionsInRange(args)})
    SELECT ${sessionColumns(Prisma.sql`s`, args.tz)},
           (count(*) OVER ())::int AS total_sessions,
           (sum(s.n) OVER ())::int AS total_checkins
      FROM s
     ORDER BY s.starts_at DESC, s."id" DESC
     LIMIT ${MAX_SESSION_POINTS}`;

  const sessions = rows.map(toSessionPoint).reverse();
  const totalSessions = rows[0] ? num(rows[0].total_sessions) : 0;
  const totalCheckIns = rows[0] ? num(rows[0].total_checkins) : 0;
  let peak = null as AttendanceReport["peak"];
  for (const point of sessions) if (!peak || point.checkIns > peak.checkIns) peak = point;
  return {
    sessions,
    totalSessions,
    totalCheckIns,
    average: totalSessions > 0 ? round1(totalCheckIns / totalSessions) : null,
    peak,
  };
};
