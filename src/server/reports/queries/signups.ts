import { Prisma } from "@/generated/prisma/client";

import { inRange, localTime, localWeek, nowUtc, num, numOrNull, pct, round1 } from "../sql";
import type { SignupsReport } from "../types";
import type { ReportQuery } from "./common";

/** The weekly series covers at most this many weeks (the most recent). */
export const MAX_SIGNUP_WEEKS = 260;

/**
 * 5. Signups (non-suppressed Signup rows, every channel), placed by the
 * org-local date of signedUpAt.
 * - Per org-local week (Monday start): signups, and how many of them have
 *   attended since (Signup.firstAttendedAt, a 4b rollup: the first
 *   check-in from one day before the signup on). Weeks with no signups are
 *   zero-filled from the first signup of the range to the range end or the
 *   current week, whichever is earlier.
 * - Conversion: converted / signups; median Signup.daysToFirstAttendance.
 * - The same numbers per channel (web, Typeform, officer, CSV, manual).
 */
export const querySignups: ReportQuery<SignupsReport> = async (db, args) => {
  const signedUp = Prisma.sql`s."signedUpAt"`;
  const toWeek =
    args.to === null ? Prisma.sql`NULL::date` : Prisma.sql`date_trunc('week', (${args.to}::date)::timestamp)::date`;
  const thisWeek = Prisma.sql`date_trunc('week', ${localTime(nowUtc(args.asOf), args.tz)})::date`;

  const weeks = await db.$queryRaw<{ week: string; signups: number; converted: number }[]>`
    WITH su AS (
      SELECT ${localWeek(signedUp, args.tz)} AS wk, (s."firstAttendedAt" IS NOT NULL) AS converted
        FROM public."Signup" s
       WHERE s."organizationId" = ${args.orgId}
         AND s."suppressedAt" IS NULL
         AND ${inRange(signedUp, args.from, args.to, args.tz)}
    ),
    span AS (
      SELECT min(su.wk) AS first_wk,
             least(coalesce(${toWeek}, max(su.wk)), ${thisWeek}) AS last_wk
        FROM su
    ),
    weeks AS (
      SELECT g::date AS wk
        FROM span,
             generate_series(greatest(span.first_wk, span.last_wk - ${(MAX_SIGNUP_WEEKS - 1) * 7}::int)::timestamp,
                             span.last_wk::timestamp,
                             interval '1 week') AS g
       WHERE span.first_wk IS NOT NULL AND span.last_wk IS NOT NULL AND span.last_wk >= span.first_wk
    )
    SELECT w.wk::text AS week,
           count(su.wk)::int AS signups,
           (count(su.wk) FILTER (WHERE su.converted))::int AS converted
      FROM weeks w
      LEFT JOIN su ON su.wk = w.wk
     GROUP BY w.wk
     ORDER BY w.wk`;

  const channels = await db.$queryRaw<
    { channel: string | null; signups: number; converted: number; median_days: number | null }[]
  >`
    SELECT s."channel"::text AS channel,
           count(*)::int AS signups,
           count(s."firstAttendedAt")::int AS converted,
           (percentile_cont(0.5) WITHIN GROUP (ORDER BY s."daysToFirstAttendance"))::float8 AS median_days
      FROM public."Signup" s
     WHERE s."organizationId" = ${args.orgId}
       AND s."suppressedAt" IS NULL
       AND ${inRange(signedUp, args.from, args.to, args.tz)}
     GROUP BY ROLLUP (s."channel")
     ORDER BY (s."channel" IS NULL), count(*) DESC, s."channel"`;

  const totalRow = channels.find((r) => r.channel === null);
  const total = num(totalRow?.signups);
  const converted = num(totalRow?.converted);
  const median = numOrNull(totalRow?.median_days);
  return {
    weeks: weeks.map((w) => ({ week: w.week, signups: num(w.signups), converted: num(w.converted) })),
    total,
    converted,
    conversionPct: pct(converted, total),
    medianDaysToFirst: median === null ? null : round1(median),
    byChannel: channels
      .filter((r) => r.channel !== null)
      .map((r) => ({ channel: r.channel as string, signups: num(r.signups), converted: num(r.converted) })),
  };
};
