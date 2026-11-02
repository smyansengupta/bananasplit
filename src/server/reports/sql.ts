import { Prisma } from "@/generated/prisma/client";

/**
 * SQL building blocks shared by the report queries.
 *
 * Suite DateTime columns are TIMESTAMP(3) WITHOUT TIME ZONE holding UTC.
 * The only correct org-local reading is
 *
 *   ((col AT TIME ZONE 'UTC') AT TIME ZONE tz)
 *
 * (col AT TIME ZONE 'UTC' turns the stored UTC wall time into an instant;
 * AT TIME ZONE tz turns that instant into the org's wall time). Neither step
 * reads the session TimeZone, so results are the same on a UTC CI box and
 * on this machine's America/New_York Postgres. Buckets are returned as
 * ::date / ::text so the driver never re-interprets them.
 *
 * Range bounds go the other way: an org-local date becomes a UTC wall time
 * once, so the predicate stays sargable on the (organizationId, col)
 * indexes:
 *
 *   col >= ((from::timestamp AT TIME ZONE tz) AT TIME ZONE 'UTC')
 *   col <  (((to + 1)::timestamp AT TIME ZONE tz) AT TIME ZONE 'UTC')
 *
 * Every value is a bound parameter; column references are fixed fragments.
 */

/** The org-local wall time of a UTC timestamp column or expression. */
export function localTime(col: Prisma.Sql, tz: string): Prisma.Sql {
  return Prisma.sql`((${col} AT TIME ZONE 'UTC') AT TIME ZONE ${tz})`;
}

/** The org-local calendar date of a UTC timestamp column, as yyyy-mm-dd text. */
export function localDateText(col: Prisma.Sql, tz: string): Prisma.Sql {
  return Prisma.sql`(${localTime(col, tz)})::date::text`;
}

/** The Monday of the org-local week of a UTC timestamp column, as a date. */
export function localWeek(col: Prisma.Sql, tz: string): Prisma.Sql {
  return Prisma.sql`date_trunc('week', ${localTime(col, tz)})::date`;
}

/** An ISO-8601 UTC string for a UTC timestamp column (no driver parsing). */
export function isoText(col: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`to_char(${col}, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
}

/** UTC wall time of the start of org-local day `from` (inclusive), or -infinity. */
export function lowerBound(from: string | null, tz: string): Prisma.Sql {
  if (from === null) return Prisma.sql`'-infinity'::timestamp`;
  return Prisma.sql`(((${from}::date)::timestamp AT TIME ZONE ${tz}) AT TIME ZONE 'UTC')`;
}

/** UTC wall time of the start of the day after org-local day `to` (exclusive), or infinity. */
export function upperBound(to: string | null, tz: string): Prisma.Sql {
  if (to === null) return Prisma.sql`'infinity'::timestamp`;
  return Prisma.sql`((((${to}::date) + 1)::timestamp AT TIME ZONE ${tz}) AT TIME ZONE 'UTC')`;
}

/** `col` within the org-local range [from, to] (both inclusive days). */
export function inRange(
  col: Prisma.Sql,
  from: string | null,
  to: string | null,
  tz: string,
): Prisma.Sql {
  return Prisma.sql`${col} >= ${lowerBound(from, tz)} AND ${col} < ${upperBound(to, tz)}`;
}

/** "Now" as a UTC wall time: the pinned clock (tests) or the database clock. */
export function nowUtc(asOf: string | null | undefined): Prisma.Sql {
  if (asOf) return Prisma.sql`(${asOf}::timestamptz AT TIME ZONE 'UTC')`;
  return Prisma.sql`(now() AT TIME ZONE 'UTC')`;
}

/** Numbers from SQL: int4/float8 arrive as numbers, bigint/numeric are coerced. */
export function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  return Number(String(value));
}

export function numOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : num(value);
}

/** One decimal place. */
export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** part / whole * 100 with one decimal, or null when whole is 0. */
export function pct(part: number, whole: number): number | null {
  return whole > 0 ? round1((part / whole) * 100) : null;
}
