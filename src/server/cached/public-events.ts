import { unstable_cache } from "next/cache";

import type { Prisma } from "@/generated/prisma/client";
import { publicEvents } from "@/server/cache/tags";
import { withSystemOrgTx } from "@/server/db/context";
import { publicEventsWhere } from "@/server/events/service";
import type { PublicEventRow, PublicEventsFeed } from "@/server/public-events/shape";

/**
 * getPublicEvents(orgId): the public events feed's cached loader (Phase 7,
 * 'Caching model' contract).
 *
 * - unstable_cache tagged tags.publicEvents(orgId), the same tag the event
 *   service invalidates after every commit that touches a PUBLIC event
 *   (updateTag in Server Actions, revalidateTag(tag, { expire: 0 }) in jobs).
 *   A 5-minute revalidate keeps the "ended at most a day ago" window moving.
 * - It opens its own withSystemOrgTx(orgId) (the fail-closed service role
 *   with the org GUC) and takes orgId explicitly; it never reads the
 *   request's transaction context or cookies.
 * - The filter is publicEventsWhere() (PUBLIC, not deleted, not merged,
 *   ended at most a day ago, starting within 400 days): the ONE definition
 *   of "on the public feed". At most 200 events, ordered by (startsAt, id).
 *
 * AUTHORIZE FIRST: the caller checks OrgSettings.publicEventsEnabled; this
 * loader does not.
 */

export const PUBLIC_FEED_LIMIT = 200;

const PUBLIC_EVENT_SELECT = {
  id: true,
  title: true,
  description: true,
  location: true,
  startsAt: true,
  endsAt: true,
  allDay: true,
  kind: true,
  rsvpUrl: true,
  capacityFull: true,
  featured: true,
  publicNote: true,
  syncVersion: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.EventSelect;

/** The uncached read. Exported for tests and scripts. */
export async function loadPublicEvents(
  orgId: string,
  now: Date = new Date(),
): Promise<PublicEventsFeed | null> {
  return withSystemOrgTx(orgId, async ({ db }) => {
    const org = await db.organization.findUnique({
      where: { id: orgId },
      select: { name: true, timezone: true, deletedAt: true },
    });
    if (!org || org.deletedAt) return null;
    const rows = await db.event.findMany({
      where: publicEventsWhere(orgId, now),
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      take: PUBLIC_FEED_LIMIT,
      select: PUBLIC_EVENT_SELECT,
    });
    const events: PublicEventRow[] = rows.map((r) => ({
      ...r,
      startsAt: r.startsAt.toISOString(),
      endsAt: r.endsAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
    return { orgName: org.name, timeZone: org.timezone, events };
  });
}

function isNoCacheContext(error: unknown): boolean {
  return (
    error instanceof Error &&
    /incrementalCache missing|static generation store missing/i.test(error.message)
  );
}

/** The org's public events (cached; see the module comment). */
export async function getPublicEvents(orgId: string): Promise<PublicEventsFeed | null> {
  const cached = unstable_cache(() => loadPublicEvents(orgId), ["public-events", orgId], {
    tags: [publicEvents(orgId)],
    revalidate: 300,
  });
  try {
    return await cached();
  } catch (error) {
    // Outside a Next.js request (scripts, tests) there is no incremental cache.
    if (isNoCacheContext(error)) return loadPublicEvents(orgId);
    throw error;
  }
}
