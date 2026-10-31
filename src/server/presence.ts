import type { TxClient } from "@/server/db/context";
import { userPublicSelect } from "@/server/members";

/**
 * Who's online (MemberPresence): the open app marks its member here about
 * once a minute (src/components/shell/sidebar-people.tsx), and anyone seen
 * within ONLINE_WINDOW_MS counts as here now. Reads and writes go through
 * RLS: members read their organization's rows and write only their own.
 */

/** How often the open app says you're here. */
export const HEARTBEAT_MS = 60_000;

/** Seen this recently counts as online: two missed beats and you're gone. */
export const ONLINE_WINDOW_MS = 150_000;

/** How many faces the sidebar shows. */
const FACES = 3;

export interface OnlineNow {
  /** Everyone here now, you included. */
  count: number;
  /** A few of the others here now, most recently seen first. */
  faces: { id: string; name: string | null; image: string | null; avatar: unknown }[];
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
  const [others, recent] = await Promise.all([
    db.memberPresence.count({ where }),
    db.memberPresence.findMany({
      where,
      orderBy: { lastSeenAt: "desc" },
      take: FACES,
      select: { user: { select: userPublicSelect } },
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
  };
}
