import { Prisma } from "@/generated/prisma/client";

import { inRange, localDateText, num } from "../sql";
import type { RetentionReport } from "../types";
import { sessionsInRange, type ReportQuery } from "./common";
import { MAX_SESSION_POINTS } from "./attendance";

/**
 * 4. Retention.
 * - Per session: check-ins that were the person's first-ever visit
 *   (Attendance.isFirstVisit, a 4b rollup) vs returning check-ins.
 * - Over the range: distinct attendees; new = people whose first-ever
 *   check-in falls in the range; returning = the rest; regulars = people at
 *   3+ sessions of the range.
 * - Stopped showing up: Contact.lapsedSince (maintained by app.refresh_lapsed
 *   from OrgSettings.lapsedAfterSessions): everyone currently lapsed, and
 *   those whose lapse began in the range.
 * Suppressed check-ins never count.
 */
export const queryRetention: ReportQuery<RetentionReport> = async (db, args) => {
  const perSession = await db.$queryRaw<
    { id: string; title: string; local_date: string; new_attendees: number; returning: number }[]
  >`
    WITH s AS (${sessionsInRange(args)})
    SELECT s."id" AS id,
           s."title" AS title,
           ${localDateText(Prisma.sql`s.starts_at`, args.tz)} AS local_date,
           (count(a."id") FILTER (WHERE a."isFirstVisit"))::int AS new_attendees,
           (count(a."id") FILTER (WHERE NOT a."isFirstVisit"))::int AS returning
      FROM s
      JOIN public."Attendance" a
        ON a."organizationId" = ${args.orgId} AND a."eventId" = s."id" AND a."suppressedAt" IS NULL
     GROUP BY s."id", s."title", s.starts_at
     ORDER BY s.starts_at DESC, s."id" DESC
     LIMIT ${MAX_SESSION_POINTS}`;

  const totals = await db.$queryRaw<
    {
      attendees: number;
      new_attendees: number;
      regulars: number;
      lapsed_total: number;
      lapsed_in_range: number;
      lapsed_after: number | null;
    }[]
  >`
    WITH s AS (${sessionsInRange(args)}),
    per AS (
      SELECT a."contactId",
             count(DISTINCT a."eventId") AS sessions,
             bool_or(a."isFirstVisit") AS is_new
        FROM public."Attendance" a
        JOIN s ON s."id" = a."eventId"
       WHERE a."organizationId" = ${args.orgId} AND a."suppressedAt" IS NULL
       GROUP BY a."contactId"
    )
    SELECT count(*)::int AS attendees,
           (count(*) FILTER (WHERE per.is_new))::int AS new_attendees,
           (count(*) FILTER (WHERE per.sessions >= 3))::int AS regulars,
           (SELECT count(*)::int FROM public."Contact" c
             WHERE c."organizationId" = ${args.orgId} AND c."lapsedSince" IS NOT NULL) AS lapsed_total,
           (SELECT count(*)::int FROM public."Contact" c
             WHERE c."organizationId" = ${args.orgId} AND c."lapsedSince" IS NOT NULL
               AND ${inRange(Prisma.sql`c."lapsedSince"`, args.from, args.to, args.tz)}) AS lapsed_in_range,
           (SELECT st."lapsedAfterSessions" FROM public."OrgSettings" st
             WHERE st."organizationId" = ${args.orgId}) AS lapsed_after
      FROM per`;

  const t = totals[0];
  const attendees = num(t?.attendees);
  const newAttendees = num(t?.new_attendees);
  return {
    perSession: perSession
      .map((r) => ({
        id: r.id,
        title: r.title,
        localDate: r.local_date,
        newAttendees: num(r.new_attendees),
        returning: num(r.returning),
      }))
      .reverse(),
    attendees,
    newAttendees,
    returning: attendees - newAttendees,
    regulars: num(t?.regulars),
    lapsedTotal: num(t?.lapsed_total),
    lapsedInRange: num(t?.lapsed_in_range),
    lapsedAfterSessions: t?.lapsed_after === null || t?.lapsed_after === undefined ? 3 : num(t.lapsed_after),
  };
};
