import { SECTIONS, sectionLabel } from "@/lib/nav/sidebar";
import type { TxClient } from "@/server/db/context";
import { userPublicSelect } from "@/server/members";

/**
 * Who's online (MemberPresence): the open app marks its member here about
 * once a minute (src/components/shell/presence-beat.tsx), and anyone seen
 * within ONLINE_WINDOW_MS counts as here now. Reads and writes go through
 * RLS: members read their organization's rows and write only their own.
 * People reads the same rows (lastSeenByUser) for its dots, the Online
 * filter and the Recently active sort, and each beat's answer keeps them
 * live there (src/components/shell/presence-store.ts). Each beat also says
 * which page is open, as its sidebar section ("Tasks" at /app/{slug}/tasks),
 * never the page itself: a private note's name or id must not reach Home's
 * "Here now".
 */

/** How often the open app says you're here. */
export const HEARTBEAT_MS = 60_000;

/** Seen this recently counts as online: two missed beats and you're gone. */
export const ONLINE_WINDOW_MS = 150_000;

/** A beat on the same page this soon after the last one isn't written. */
export const RESTAMP_MS = 30_000;

/** How long a beat trusts the organization's slug and sidebar names it read. */
const ORG_TTL_MS = 60_000;

/** How many faces Overview's members online shows. */
const FACES = 3;

/** The most online members one beat names (People's live dots). */
const ONLINE_IDS = 500;

/** Whether a last beat at `lastSeenAt` still counts as online at `now`. */
export function isOnline(lastSeenAt: Date | null | undefined, now: Date): boolean {
  return Boolean(lastSeenAt && now.getTime() - lastSeenAt.getTime() <= ONLINE_WINDOW_MS);
}

/** The page someone has open: where it is, and its sidebar section's name. */
export interface PresencePage {
  href: string;
  label: string;
}

export interface OnlineNow {
  /** Everyone here now, you included. */
  count: number;
  /** A few of the others here now, most recently seen first, with the page each has open. */
  faces: {
    id: string;
    name: string | null;
    image: string | null;
    avatar: unknown;
    where: PresencePage | null;
  }[];
  /** Every other member here now (People's live dots). */
  ids: string[];
}

const PATH_MAX = 300;
/** Pages outside the sidebar that still have a plain name. */
const OTHER_PAGES: { path: string; label: string }[] = [
  { path: "/settings", label: "Settings" },
  { path: "/profile", label: "Profile" },
];

/**
 * The page at `pathname` as "Here now" names it: the sidebar section it
 * belongs to, under the organization's own name for it ("Docs" for Files),
 * and that section's own page (/app/{orgSlug}/notes, never the note: ids
 * of private notes, transactions or people stay with whoever has them
 * open). Null for anything outside `/app/{orgSlug}`, a page with no
 * section, or a path with empty, "." or ".." segments.
 */
export function pageOf(pathname: unknown, orgSlug: string, sidebar: unknown): PresencePage | null {
  if (typeof pathname !== "string" || pathname.length > PATH_MAX) return null;
  const base = `/app/${orgSlug}`;
  const path = pathname.split(/[?#]/)[0]!.replace(/\/+$/, "");
  if (path !== base && !path.startsWith(`${base}/`)) return null;
  if (!/^[A-Za-z0-9/_.~-]*$/.test(path)) return null;
  if (
    path
      .split("/")
      .slice(1)
      .some((seg) => seg === "" || seg === "." || seg === "..")
  ) {
    return null;
  }
  const rest = path.slice(base.length);
  const under = (p: string) => rest === p || rest.startsWith(`${p}/`);
  // Longest match first: /calendar/rsvp is Meetings, /calendar is Calendar.
  const candidates = SECTIONS.flatMap((s) =>
    s.exact
      ? [{ id: s.id, p: s.path, home: s.path, exact: true }]
      : [s.path, ...(s.also ?? [])].map((p) => ({ id: s.id, p, home: s.path, exact: false })),
  ).sort((a, b) => b.p.length - a.p.length);
  for (const c of candidates) {
    if (c.exact ? rest === c.p : under(c.p))
      return { href: `${base}${c.home}`, label: sectionLabel(sidebar, c.id) };
  }
  const other = OTHER_PAGES.find((o) => under(o.path));
  return other ? { href: `${base}${other.path}`, label: other.label } : null;
}

const orgCache = new Map<string, { at: number; slug: string; sidebar: unknown }>();

/**
 * The organization's slug and sidebar names, as pageOf needs them. The
 * beat comes every minute from every open tab, so the read is kept for a
 * minute per organization (a renamed section shows its new name within
 * it). Only a member's beat gets here, inside its own transaction.
 */
export async function presenceOrg(
  db: TxClient,
  organizationId: string,
  now = Date.now(),
): Promise<{ slug: string; sidebar: unknown } | null> {
  const hit = orgCache.get(organizationId);
  if (hit && now - hit.at < ORG_TTL_MS) return hit;
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { slug: true, settings: { select: { sidebar: true } } },
  });
  if (!org) return null;
  const entry = { at: now, slug: org.slug, sidebar: org.settings?.sidebar ?? null };
  orgCache.set(organizationId, entry);
  return entry;
}

/**
 * Marks `userId` as here in this organization, now, on `page` (null:
 * unknown). A beat on the same page within RESTAMP_MS of the last one
 * writes nothing: they still count as here, and the row stays as it was.
 */
export async function markHere(
  db: TxClient,
  organizationId: string,
  userId: string,
  page: PresencePage | null = null,
) {
  const now = new Date();
  const where = { pageHref: page?.href ?? null, pageLabel: page?.label ?? null };
  const key = { organizationId_userId: { organizationId, userId } };
  const last = await db.memberPresence.findUnique({
    where: key,
    select: { lastSeenAt: true, pageHref: true, pageLabel: true },
  });
  if (
    last &&
    last.pageHref === where.pageHref &&
    last.pageLabel === where.pageLabel &&
    now.getTime() - last.lastSeenAt.getTime() < RESTAMP_MS
  ) {
    return;
  }
  await db.memberPresence.upsert({
    where: key,
    create: { organizationId, userId, lastSeenAt: now, ...where },
    update: { lastSeenAt: now, ...where },
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
      select: { pageHref: true, pageLabel: true, user: { select: userPublicSelect } },
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
    faces: recent.map(({ user, pageHref, pageLabel }) => ({
      id: user.id,
      name: user.name,
      image: user.image,
      avatar: user.avatar,
      where: pageHref && pageLabel ? { href: pageHref, label: pageLabel } : null,
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
