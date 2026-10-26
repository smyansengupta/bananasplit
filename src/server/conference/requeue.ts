import {
  CalendarSyncState,
  type IntegrationProvider,
  MeetingFormat,
} from "@/generated/prisma/client";
import { withSystemOrgTx } from "@/server/db/context";
import { enqueueJob } from "@/server/jobs/enqueue";

import { providerOf } from "./providers";

/**
 * The most meetings one connect queues. A club has a few dozen upcoming
 * online meetings at most; this is a bound on a runaway, not a working limit,
 * and the soonest ones go first so a cut-off drops the furthest away.
 */
export const REQUEUE_LIMIT = 500;

/**
 * Queues the meetings that were waiting for a provider, once it is connected
 * (docs/features/meetings.md).
 *
 * Two kinds of meeting are waiting:
 *   - one saved before the provider was connected. The save path skips it
 *     (needsConferenceSync wants a connected provider), so with nothing else
 *     to wake it, it would stay without a link forever;
 *   - one left FAILED, typically by an expired grant. The sync job gave up on
 *     it with "reconnecting queues the work again", and this is that.
 *
 * Only what the sync job could act on is queued: live (not deleted, not
 * merged), still ahead of `now`, online, at THIS provider, and either FAILED
 * or with no link of any kind. A pasted link (`conferenceManaged` false with a
 * URL) is never ours to replace, so it is left alone, the same rule the job
 * itself applies.
 *
 * Marking a row PENDING is raw SQL, as afterSave does (src/server/events/
 * service.ts): it is not an edit, so `updatedAt` stays where it was and the
 * row does not jump in "recently changed" lists. The jobs are enqueued in the
 * same transaction, so a row is never PENDING without a job to resolve it.
 *
 * Returns how many meetings were queued.
 */
export async function requeueWaitingMeetings(
  orgId: string,
  integration: IntegrationProvider,
  now: Date = new Date(),
): Promise<number> {
  const def = providerOf(integration);
  if (!def) return 0;

  return withSystemOrgTx(orgId, async ({ db }) => {
    const waiting = await db.event.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        mergedIntoId: null,
        endsAt: { gt: now },
        conferenceProvider: def.conference,
        format: { not: MeetingFormat.IN_PERSON },
        OR: [
          { conferenceSyncState: CalendarSyncState.FAILED },
          { conferenceManaged: false, conferenceUrl: null },
        ],
      },
      orderBy: { startsAt: "asc" },
      take: REQUEUE_LIMIT,
      select: { id: true },
    });
    if (waiting.length === 0) return 0;

    const ids = waiting.map((event) => event.id);
    await db.$executeRaw`
      UPDATE "Event" SET "conferenceSyncState" = 'PENDING'::"CalendarSyncState"
       WHERE "organizationId" = ${orgId} AND "id" = ANY(${ids}::text[])`;
    for (const id of ids) {
      await enqueueJob(db, {
        orgId,
        kind: "conference-sync",
        key: id,
        payload: { eventId: id },
      });
    }
    return ids.length;
  });
}
