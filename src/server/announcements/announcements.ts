import type { ItemRef } from "@/lib/overview/types";
import type { TxClient } from "@/server/db/context";
import { userPublicSelect } from "@/server/members";
import { linksOf, refKey, resolveHomeRefs, type HomeLinkRef } from "@/server/decisions/linked-refs";

import { signupInsight, type SignupInsight } from "./rules";

/**
 * Announcements, read and written as the member (RLS): posts to the whole
 * organization, at the top of the Inbox and on Home. "Seen by N of M"
 * counts AnnouncementSeen rows of current members against the members.
 */

/** Whoever posted it, as other members may see them. */
export interface AnnouncementFace {
  id: string;
  name: string | null;
  image: string | null;
  avatar: unknown;
}

export interface AnnouncementItem {
  id: string;
  title: string;
  body: string;
  /** Null when the author's account is gone. */
  author: AnnouncementFace | null;
  createdAt: Date;
  /** Current members who have seen it, you included once you have. */
  seenCount: number;
  /** Members of the organization now. */
  memberCount: number;
  seenByMe: boolean;
  /** The event it's about (and anything else linked), as chips. */
  links: ItemRef[];
}

export interface ListAnnouncementsOptions {
  /** At most this many, newest first (default 3). */
  limit?: number;
  /** Only posts from after this (the Inbox: the last 14 days). */
  since?: Date;
  /** For the chips' links; read from the organization when left out. */
  orgSlug?: string;
}

/**
 * The newest announcements in the organization, with who posted each, how
 * many members have seen it, whether `userId` has, and what it links to.
 */
export async function listAnnouncements(
  db: TxClient,
  orgId: string,
  userId: string,
  { limit = 3, since, orgSlug }: ListAnnouncementsOptions = {},
): Promise<AnnouncementItem[]> {
  const posts = await db.announcement.findMany({
    where: {
      organizationId: orgId,
      deletedAt: null,
      ...(since ? { createdAt: { gte: since } } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: Math.max(1, Math.min(limit, 100)),
    select: {
      id: true,
      title: true,
      body: true,
      createdAt: true,
      author: { select: userPublicSelect },
    },
  });
  if (posts.length === 0) return [];
  const ids = posts.map((p) => p.id);
  const member = { memberships: { some: { organizationId: orgId } } };

  // One query at a time: a transaction has one connection.
  const memberCount = await db.membership.count({ where: { organizationId: orgId } });
  const seen = await db.announcementSeen.groupBy({
    by: ["announcementId"],
    where: { organizationId: orgId, announcementId: { in: ids }, user: member },
    _count: { _all: true },
  });
  const mine = await db.announcementSeen.findMany({
    where: { organizationId: orgId, announcementId: { in: ids }, userId },
    select: { announcementId: true },
  });
  const linked = await linksOf(db, orgId, "announcement", ids);
  const slug = orgSlug ?? (await slugOf(db, orgId));
  const resolved = await resolveHomeRefs(db, orgId, slug, [...linked.values()].flat());

  const seenBy = new Map(seen.map((s) => [s.announcementId, s._count._all]));
  const seenByMe = new Set(mine.map((m) => m.announcementId));
  return posts.map((p) => ({
    id: p.id,
    title: p.title,
    body: p.body,
    author: p.author,
    createdAt: p.createdAt,
    seenCount: Math.min(seenBy.get(p.id) ?? 0, memberCount),
    memberCount,
    seenByMe: seenByMe.has(p.id),
    links: (linked.get(p.id) ?? []).flatMap((r) => {
      const hit = resolved.get(refKey(r));
      if (!hit) return [];
      // An event's chip says how many are going: "Fall Social, 58 going".
      const label = hit.going ? `${hit.title}, ${hit.going} going` : hit.title;
      return [{ ...hit.ref, label }];
    }),
  }));
}

/** How many announcements there are in all (for "See all"). */
export function countAnnouncements(db: TxClient, orgId: string): Promise<number> {
  return db.announcement.count({ where: { organizationId: orgId, deletedAt: null } });
}

/**
 * The event each announcement links to, as the viewer sees it (the first
 * one, when there are several): the id and title, for its sign-up count.
 */
async function linkedEvents(
  db: TxClient,
  orgId: string,
  ids: readonly string[],
): Promise<Map<string, { id: string; title: string }>> {
  const linked = await linksOf(db, orgId, "announcement", ids);
  const refs: HomeLinkRef[] = [...linked.values()].flat().filter((r) => r.kind === "event");
  const events = refs.length
    ? await db.event.findMany({
        where: { organizationId: orgId, id: { in: refs.map((r) => r.id) }, deletedAt: null },
        select: { id: true, title: true },
      })
    : [];
  const out = new Map<string, { id: string; title: string }>();
  for (const [postId, list] of linked) {
    const event = list
      .filter((r) => r.kind === "event")
      .map((r) => events.find((e) => e.id === r.id))
      .find(Boolean);
    if (event) out.set(postId, event);
  }
  return out;
}

/**
 * For owners and admins (the only ones who can read an event's sign-ups):
 * how many people signed up for each post's event in the day after it went
 * out. Posts with no event, or no sign-ups in that day, are left out.
 */
export async function signupInsights(
  db: TxClient,
  orgId: string,
  posts: readonly Pick<AnnouncementItem, "id" | "createdAt">[],
  now = new Date(),
): Promise<Map<string, SignupInsight>> {
  const out = new Map<string, SignupInsight>();
  if (posts.length === 0) return out;
  const events = await linkedEvents(
    db,
    orgId,
    posts.map((p) => p.id),
  );
  for (const post of posts) {
    const event = events.get(post.id);
    if (!event) continue;
    const dayAfter = new Date(post.createdAt.getTime() + 24 * 60 * 60 * 1000);
    const signups = await db.eventRegistration.count({
      where: {
        organizationId: orgId,
        eventId: event.id,
        createdAt: { gte: post.createdAt, lt: dayAfter },
        status: { not: "CANCELLED" },
      },
    });
    const insight = signupInsight(signups, event.title, post.createdAt, now);
    if (insight) out.set(post.id, insight);
  }
  return out;
}

/**
 * Marks these announcements seen by `userId`. Ids that aren't live posts in
 * the organization are skipped; seeing one twice changes nothing.
 */
export async function markSeen(
  db: TxClient,
  orgId: string,
  userId: string,
  ids: readonly string[],
): Promise<number> {
  if (ids.length === 0) return 0;
  const live = await db.announcement.findMany({
    where: { organizationId: orgId, id: { in: [...ids] }, deletedAt: null },
    select: { id: true },
  });
  if (live.length === 0) return 0;
  const made = await db.announcementSeen.createMany({
    data: live.map((p) => ({ organizationId: orgId, announcementId: p.id, userId })),
    skipDuplicates: true,
  });
  return made.count;
}

async function slugOf(db: TxClient, orgId: string): Promise<string> {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { slug: true } });
  return org?.slug ?? "";
}
