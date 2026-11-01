import type { TxClient } from "@/server/db/context";
import { userPublicSelect } from "@/server/members";

/**
 * Who's online (MemberPresence): the open app marks its member here about
 * once a minute (src/components/shell/presence-beat.tsx), and anyone seen
 * within ONLINE_WINDOW_MS counts as here now. Reads and writes go through
 * RLS: members read their organization's rows and write only their own.
 * People reads the same rows (lastSeenByUser) for its dots, the Online
 * filter and the Recently active sort, and each beat's answer keeps them
 * live there (src/components/shell/presence-store.ts).
 */

/** How often the open app says you're here. */
export const HEARTBEAT_MS = 60_000;

/** Seen this recently counts as online: two missed beats and you're gone. */
export const ONLINE_WINDOW_MS = 150_000;

/** How many faces Overview's members online shows. */
const FACES = 3;

/** The most online members one beat names (People's live dots). */
const ONLINE_IDS = 500;

/** Whether a last beat at `lastSeenAt` still counts as online at `now`. */
export function isOnline(lastSeenAt: Date | null | undefined, now: Date): boolean {
  return Boolean(lastSeenAt && now.getTime() - lastSeenAt.getTime() <= ONLINE_WINDOW_MS);
}

export interface OnlineNow {
  /** Everyone here now, you included. */
  count: number;
  /** A few of the others here now, most recently seen first. */
  faces: { id: string; name: string | null; image: string | null; avatar: unknown }[];
  /** Every other member here now (People's live dots). */
  ids: string[];
}

/** Marks `userId` as here in this organization, now. */
export async function markHere(db: TxClient, organizationId: string, userId: string) {
  const now = new Date();
  await db.memberPresence.upsert({
    where: { organizationId_userId: { organizationId, userId } },
    create: { organizationId, userId, lastSeenAt: now },
    update: { lastSeenAt: now },
  });
}

/**
 * Who's here now. You always count (you're looking at it), even before your
 * first beat lands. Only current members: someone who left drops out at
 * once, not when their last beat ages.
 */
export async function onlineNow(
  db: TxClient,
  organizationId: string,
  viewerId: string,
  now = new Date(),
): Promise<OnlineNow> {
  const since = new Date(now.getTime() - ONLINE_WINDOW_MS);
  const where = {
    organizationId,
    lastSeenAt: { gte: since },
    userId: { not: viewerId },
    user: { memberships: { some: { organizationId } } },
  };
  const [others, recent, ids] = await Promise.all([
    db.memberPresence.count({ where }),
    db.memberPresence.findMany({
      where,
      orderBy: { lastSeenAt: "desc" },
      take: FACES,
      select: { user: { select: userPublicSelect } },
    }),
    db.memberPresence.findMany({
      where,
      orderBy: { lastSeenAt: "desc" },
      take: ONLINE_IDS,
      select: { userId: true },
    }),
  ]);
  return {
    count: others + 1,
    faces: recent.map(({ user }) => ({
      id: user.id,
      name: user.name,
      image: user.image,
      avatar: user.avatar,
    })),
    ids: ids.map((r) => r.userId),
  };
}

/** When each member of the organization was last here (members only, RLS). */
export async function lastSeenByUser(
  db: TxClient,
  organizationId: string,
): Promise<Map<string, Date>> {
  const rows = await db.memberPresence.findMany({
    where: { organizationId },
    select: { userId: true, lastSeenAt: true },
  });
  return new Map(rows.map((r) => [r.userId, r.lastSeenAt]));
}
