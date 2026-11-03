import type { DuplicateEvent, DuplicatePair } from "@/lib/ambient/databases";
import type { TxClient } from "@/server/db/context";
import { findDuplicatePairs } from "@/server/events/match";

/**
 * The live sessions that look like the same meeting twice (same local day,
 * within 90 minutes, matching titles), as the Duplicates page and the
 * Sessions header's "Merge N" read them. As the caller, so RLS applies.
 */
export async function likelyDuplicates(
  db: TxClient,
  organizationId: string,
  timezone: string,
): Promise<{
  events: (DuplicateEvent & { title: string; startsAt: Date })[];
  pairs: DuplicatePair[];
}> {
  const events = await db.event.findMany({
    where: { organizationId, deletedAt: null, mergedIntoId: null },
    orderBy: { startsAt: "asc" },
    select: { id: true, title: true, startsAt: true, attendanceCount: true, sourceSessionId: true },
    take: 5000,
  });
  return { events, pairs: findDuplicatePairs(events, timezone) };
}
