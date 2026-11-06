import type { TxClient } from "@/server/db/context";
import type { SendJob } from "@/lib/ambient/reports";

/**
 * What a saved report's ambient buttons read (src/lib/ambient/reports.ts
 * decides): when its database last changed, and its scheduled sends. Both
 * run as the viewer, so RLS applies: the newest change they can see, and
 * jobs only for owners and admins (the Job policy).
 */

const latest = (...dates: (Date | null | undefined)[]): Date | null =>
  dates.reduce<Date | null>((a, d) => (d && (!a || d > a) ? d : a), null);

/** When the rows a report source reads last changed ("custom:<id>", "tasks", ...). */
async function changedAt(
  db: TxClient,
  organizationId: string,
  source: string,
): Promise<Date | null> {
  if (source.startsWith("custom:")) {
    const r = await db.databaseRecord.aggregate({
      where: { organizationId, databaseId: source.slice("custom:".length) },
      _max: { updatedAt: true },
    });
    return r._max.updatedAt;
  }
  switch (source) {
    case "tasks":
      return (await db.task.aggregate({ where: { organizationId }, _max: { updatedAt: true } }))
        ._max.updatedAt;
    case "expenses":
      return (
        await db.transaction.aggregate({
          where: { organizationId, direction: "OUT" },
          _max: { updatedAt: true },
        })
      )._max.updatedAt;
    case "events": {
      const events = await db.event.aggregate({
        where: { organizationId },
        _max: { updatedAt: true },
      });
      const checkIns = await db.attendance.aggregate({
        where: { organizationId },
        _max: { createdAt: true },
      });
      return latest(events._max.updatedAt, checkIns._max.createdAt);
    }
    case "people":
      return (await db.contact.aggregate({ where: { organizationId }, _max: { updatedAt: true } }))
        ._max.updatedAt;
    default:
      return null;
  }
}

/** When the report's database (and the one it joins, if any) last changed. */
export async function reportDataChangedAt(
  db: TxClient,
  organizationId: string,
  report: { source: string; joinWith: { source: string } | null },
): Promise<Date | null> {
  const mine = await changedAt(db, organizationId, report.source);
  const joined = report.joinWith
    ? await changedAt(db, organizationId, report.joinWith.source)
    : null;
  return latest(mine, joined);
}

/** The report's scheduled-send jobs still on file (newest first), for owners and admins. */
export async function reportSendJobs(
  db: TxClient,
  organizationId: string,
  reportId: string,
): Promise<SendJob[]> {
  return db.job.findMany({
    where: {
      organizationId,
      kind: { in: ["report-send", "report-email"] },
      OR: [
        { dedupeKey: { startsWith: `report-send:${reportId}:` } },
        { dedupeKey: { startsWith: `report-email:${reportId}:` } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { kind: true, dedupeKey: true, status: true, payload: true, createdAt: true },
  });
}
