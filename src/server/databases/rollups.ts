import type { Prisma } from "@/generated/prisma/client";
import { reports } from "@/server/cache/tags";
import { markReportsDataChanged } from "@/server/reports/data-version";

/**
 * After any write to check-ins, signups, contacts or sessions, in the SAME
 * transaction as the write (Phase 4b):
 *
 *   app.refresh_contact_rollups(org, contacts)  stamp numbers, term totals,
 *        first visits, ContactTermStats, contact totals, signup status and
 *        conversion, Event.attendanceCount
 *   app.refresh_lapsed(org)                     Contact.lapsedSince
 *   OrgSettings.reportsDataVersion += 1         part of every report cache key
 *
 * then invalidate the org's reports after commit. Callers: OWNER/ADMIN in
 * their own app_user transaction (the functions check it), or the service
 * path with the org GUC (the sync, merges).
 *
 * refresh_lapsed runs inline rather than as a separate job: a contact's
 * lapsed state only changes when attendance changes (a session counts once
 * it has a check-in), and the function is one pass over the org's contacts.
 */

export type RollupDb = Prisma.TransactionClient;

export async function refreshRollups(
  db: RollupDb,
  organizationId: string,
  contactIds: readonly string[] | null,
): Promise<void> {
  if (contactIds !== null && contactIds.length === 0) return;
  const ids = contactIds === null ? null : [...new Set(contactIds)];
  await db.$queryRaw`SELECT app.refresh_contact_rollups(${organizationId}, ${ids}::text[])::text AS ok`;
  await db.$queryRaw`SELECT app.refresh_lapsed(${organizationId}) AS n`;
}

/**
 * Bumps the reports data version and queues the reports invalidation after
 * commit, through the Reports hook (markReportsDataChanged,
 * src/server/reports/data-version.ts), in the caller's transaction.
 */
export async function markDataChanged(db: RollupDb, organizationId: string): Promise<string[]> {
  await markReportsDataChanged({ db, organizationId });
  return [reports(organizationId)];
}

/** refreshRollups, then markDataChanged. */
export async function afterDataChange(
  db: RollupDb,
  organizationId: string,
  contactIds: readonly string[] | null,
): Promise<string[]> {
  await refreshRollups(db, organizationId, contactIds);
  return markDataChanged(db, organizationId);
}
