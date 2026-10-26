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
 * Three kinds of meeting are waiting:
 *   - one saved before the provider was connected. The save path skips it
 *     (needsConferenceSync wants a connected provider), so with nothing else
 *     to wake it, it would stay without a link forever;
 *   - one left FAILED, typically by an expired grant. The sync job gave up on
 *     it with "reconnecting queues the work again", and this is that;
 *   - a meeting we made at THIS provider whose cancellation FAILED: the event
 *     was deleted or merged, became in person, or moved to another provider
 *     while this one was disconnected. Disconnect promises that changes reach
 *     the provider once it is connected again, and for these the change is
 *     calling our meeting off, so they are picked up whatever the event wants
 *     now. The sync job reads `conferenceManagedAt` to know where to cancel.
 *
 * Only what the sync job could act on is queued, and only what is still
 * ahead of `now`. For the first two: live (not deleted, not merged), online,
 * wanting THIS provider, and either FAILED or with no link of any kind. A
 * pasted link (`conferenceManaged` false with a URL) is never ours to
 * replace, so it is left alone, the same rule the job itself applies.
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
        endsAt: { gt: now },
        OR: [
          // Waiting for a link at this provider.
          {
            deletedAt: null,
            mergedIntoId: null,
            conferenceProvider: def.conference,
            format: { not: MeetingFormat.IN_PERSON },
            OR: [
              { conferenceSyncState: CalendarSyncState.FAILED },
              { conferenceManaged: false, conferenceUrl: null },
            ],
          },
          // A meeting we made here that a failed change never reached.
          {
            conferenceManaged: true,
            conferenceManagedAt: def.conference,
            conferenceSyncState: CalendarSyncState.FAILED,
          },
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
