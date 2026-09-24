import { Prisma } from "@/generated/prisma/client";
import type { TxClient } from "@/server/db/context";

import { inRange, isoText, localDateText, num } from "../sql";
import type { ReportTier, SessionPoint } from "../types";

/**
 * Explicit inputs of every report query. The query functions take the
 * transaction client as an argument (never from AsyncLocalStorage) and run
 * one or two aggregate statements; every predicate names organizationId.
 */
export interface ReportQueryArgs {
  orgId: string;
  tier: ReportTier;
  /** Org-local inclusive dates, or null for no bound. */
  from: string | null;
  to: string | null;
  /** IANA timezone of the org. */
  tz: string;
  /** Pinned "now" (ISO) for tests; the loaders leave it unset (database clock). */
  asOf?: string | null;
}

export type ReportQuery<T> = (db: TxClient, args: ReportQueryArgs) => Promise<T>;

/**
 * The sessions of the range. A session is a non-deleted, non-merged Event
 * with at least one non-suppressed check-in (Event.attendanceCount > 0, the
 * same definition as app.refresh_lapsed), placed in the range by the
 * org-local date of its start. Board meetings and future events have no
 * check-ins, so they drop out on their own.
 *
 * Columns: id, title, kind, starts_at (timestamp), n (check-ins).
 */
export function sessionsInRange(args: ReportQueryArgs): Prisma.Sql {
  return Prisma.sql`
    SELECT e."id", e."title", e."kind"::text AS kind, e."startsAt" AS starts_at, e."attendanceCount" AS n
      FROM public."Event" e
     WHERE e."organizationId" = ${args.orgId}
       AND e."deletedAt" IS NULL
       AND e."mergedIntoId" IS NULL
       AND e."attendanceCount" > 0
       AND ${inRange(Prisma.sql`e."startsAt"`, args.from, args.to, args.tz)}`;
}

/** The select list that turns a sessions row (alias `s`) into a SessionPoint row. */
export function sessionColumns(alias: Prisma.Sql, tz: string): Prisma.Sql {
  return Prisma.sql`
    ${alias}."id" AS id,
    ${alias}."title" AS title,
    ${alias}.kind AS kind,
    ${isoText(Prisma.sql`${alias}.starts_at`)} AS starts_at,
    ${localDateText(Prisma.sql`${alias}.starts_at`, tz)} AS local_date,
    ${alias}.n::int AS n`;
}

export interface SessionRow {
  id: string;
  title: string;
  kind: string;
  starts_at: string;
  local_date: string;
  n: number | bigint;
}

export function toSessionPoint(row: SessionRow): SessionPoint {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    startsAt: row.starts_at,
    localDate: row.local_date,
    checkIns: num(row.n),
  };
}
