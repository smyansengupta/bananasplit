import { Prisma } from "@/generated/prisma/client";
import type { DatabaseKind } from "@/generated/prisma/enums";
import type { TxClient } from "@/server/db/context";

/**
 * Databases home's numbers: rows added in each of the last eight weeks (the
 * cards' sparklines and "+N this week"), read in the viewer's transaction so
 * visibility decides, as it does for the counts beside them.
 */

export const HOME_WEEKS = 8;

export interface WeeklyRows {
  /** Oldest first, the last entry this week (the seven days to today). */
  weeks: number[];
  thisWeek: number;
}

async function weekly(db: TxClient, sql: Prisma.Sql): Promise<WeeklyRows> {
  const rows = await db.$queryRaw<{ w: number; n: bigint | number }[]>`
    SELECT floor(extract(epoch FROM (now() AT TIME ZONE 'UTC') - t) / 604800)::int AS w, count(*) AS n
      FROM (${sql}) x(t)
     WHERE t > (now() AT TIME ZONE 'UTC') - make_interval(days => ${HOME_WEEKS * 7})
     GROUP BY 1`;
  const weeks = Array.from({ length: HOME_WEEKS }, () => 0);
  for (const r of rows) {
    const i = HOME_WEEKS - 1 - Number(r.w);
    if (i >= 0 && i < HOME_WEEKS) weeks[i] = Number(r.n);
  }
  return { weeks, thisWeek: weeks[HOME_WEEKS - 1] };
}

/** One database's rows by week of when they were added (or happened, for check-ins and signups). */
export function weeklyRowsFor(
  db: TxClient,
  organizationId: string,
  database: { id: string; kind: DatabaseKind },
): Promise<WeeklyRows> {
  switch (database.kind) {
    case "CUSTOM":
      return weekly(
        db,
        Prisma.sql`SELECT "createdAt" FROM public."DatabaseRecord"
                    WHERE "organizationId" = ${organizationId} AND "databaseId" = ${database.id} AND "deletedAt" IS NULL`,
      );
    case "ATTENDANCE":
      return weekly(
        db,
        Prisma.sql`SELECT "checkedInAt" FROM public."Attendance"
                    WHERE "organizationId" = ${organizationId} AND "suppressedAt" IS NULL`,
      );
    case "SIGNUPS":
      return weekly(
        db,
        Prisma.sql`SELECT "signedUpAt" FROM public."Signup"
                    WHERE "organizationId" = ${organizationId} AND "suppressedAt" IS NULL`,
      );
    case "SESSIONS":
      return weekly(
        db,
        Prisma.sql`SELECT "createdAt" FROM public."Event"
                    WHERE "organizationId" = ${organizationId} AND "deletedAt" IS NULL AND "mergedIntoId" IS NULL`,
      );
    case "PEOPLE":
      return weekly(
        db,
        Prisma.sql`SELECT "firstCheckInAt" FROM public."Contact"
                    WHERE "organizationId" = ${organizationId} AND "firstCheckInAt" IS NOT NULL`,
      );
    // The CRM's databases: records added each week.
    case "CRM_PEOPLE":
      return weekly(
        db,
        Prisma.sql`SELECT "createdAt" FROM public."CrmPerson"
                    WHERE "organizationId" = ${organizationId} AND "deletedAt" IS NULL`,
      );
    case "CRM_COMPANIES":
      return weekly(
        db,
        Prisma.sql`SELECT "createdAt" FROM public."CrmCompany"
                    WHERE "organizationId" = ${organizationId} AND "deletedAt" IS NULL`,
      );
    case "CRM_PIPELINE":
      return weekly(
        db,
        Prisma.sql`SELECT d."createdAt" FROM public."CrmDeal" d
                    JOIN public."CrmPipeline" p ON p."id" = d."pipelineId" AND p."organizationId" = d."organizationId"
                    WHERE d."organizationId" = ${organizationId} AND d."deletedAt" IS NULL
                      AND p."databaseId" = ${database.id}`,
      );
    default:
      return Promise.resolve({ weeks: Array.from({ length: HOME_WEEKS }, () => 0), thisWeek: 0 });
  }
}

export function weeklyTasks(db: TxClient, organizationId: string): Promise<WeeklyRows> {
  return weekly(
    db,
    Prisma.sql`SELECT "createdAt" FROM public."Task"
                WHERE "organizationId" = ${organizationId} AND "deletedAt" IS NULL AND "type" <> 'EPIC'`,
  );
}

export function weeklyExpenses(db: TxClient, organizationId: string): Promise<WeeklyRows> {
  return weekly(
    db,
    Prisma.sql`SELECT "occurredAt" FROM public."Transaction"
                WHERE "organizationId" = ${organizationId} AND "direction" = 'OUT' AND "voidedAt" IS NULL`,
  );
}
