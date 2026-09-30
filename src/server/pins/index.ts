import type { TxClient } from "@/server/db/context";
import { describePath, type PageInfo, type PinKind } from "@/lib/pins/pages";

/**
 * Pins and recently visited pages (Overview, the sidebar's Pinned list).
 * Both are the member's own rows in one org (RLS: userId and org). Labels
 * of notes, tasks, events, databases and people are looked up here as the
 * member, so a pin to something they can no longer open drops out of the
 * list instead of showing a stale title.
 */

export const MAX_PINS = 24;
export const RECENT_KEEP = 30;

export interface PinnedItem {
  id: string;
  href: string;
  label: string;
  kind: PinKind;
}

export interface RecentItem {
  href: string;
  label: string;
  kind: PinKind;
  visitedAt: Date;
}

type Db = TxClient;

/** Live labels for the lookups in `infos`; null for anything not visible. */
async function resolveLabels(
  db: Db,
  orgId: string,
  infos: PageInfo[],
): Promise<Map<string, string | null>> {
  const ids = (type: string) =>
    infos.flatMap((i) => (i.lookup?.type === type && "id" in i.lookup ? [i.lookup.id] : []));
  const keys = infos.flatMap((i) => (i.lookup?.type === "database" ? [i.lookup.key] : []));
  const [notes, tasks, events, polls, databases, people, files] = await Promise.all([
    ids("note").length
      ? db.note.findMany({
          where: { organizationId: orgId, id: { in: ids("note") }, deletedAt: null },
          select: { id: true, title: true },
        })
      : [],
    ids("task").length
      ? db.task.findMany({
          where: { organizationId: orgId, id: { in: ids("task") }, deletedAt: null },
          select: { id: true, title: true },
        })
      : [],
    ids("event").length
      ? db.event.findMany({
          where: { organizationId: orgId, id: { in: ids("event") }, deletedAt: null },
          select: { id: true, title: true },
        })
      : [],
    ids("poll").length
      ? db.availabilityPoll.findMany({
          where: { organizationId: orgId, id: { in: ids("poll") } },
          select: { id: true, title: true },
        })
      : [],
    keys.length
      ? db.databaseDefinition.findMany({
          where: { organizationId: orgId, key: { in: keys } },
          select: { key: true, name: true },
        })
      : [],
    ids("person").length
      ? db.membership.findMany({
          where: { organizationId: orgId, userId: { in: ids("person") } },
          select: { userId: true, user: { select: { name: true } } },
        })
      : [],
    ids("file").length
      ? db.orgFile.findMany({
          where: { organizationId: orgId, id: { in: ids("file") }, deletedAt: null },
          select: { id: true, name: true },
        })
      : [],
  ]);
  const byType = {
    note: new Map(notes.map((n) => [n.id, n.title || "Untitled note"])),
    task: new Map(tasks.map((t) => [t.id, t.title])),
    event: new Map(events.map((e) => [e.id, e.title])),
    poll: new Map(polls.map((p) => [p.id, p.title])),
    database: new Map(databases.map((d) => [d.key, d.name])),
    person: new Map(people.map((m) => [m.userId, m.user.name ?? "Member"])),
    file: new Map(files.map((f) => [f.id, f.name])),
  };
  const out = new Map<string, string | null>();
  for (const info of infos) {
    if (!info.lookup) continue;
    const l = info.lookup;
    const map: Map<string, string> = byType[l.type];
    const found = map.get(l.type === "database" ? l.key : l.id);
    out.set(info.href, found ?? null);
  }
  return out;
}

function clip(label: string): string {
  const one = label.replace(/\s+/g, " ").trim();
  return (one.length > 120 ? `${one.slice(0, 117)}…` : one) || "Untitled";
}

/** The page at `pathname` with its live label, or null when it is not visible. */
export async function describePage(
  db: Db,
  orgId: string,
  orgSlug: string,
  pathname: string,
): Promise<(PageInfo & { targetId: string | null }) | null> {
  const info = describePath(orgSlug, pathname);
  if (!info) return null;
  const targetId = info.lookup ? ("id" in info.lookup ? info.lookup.id : info.lookup.key) : null;
  if (!info.lookup) return { ...info, targetId };
  const label = (await resolveLabels(db, orgId, [info])).get(info.href);
  return label ? { ...info, label: clip(label), targetId } : null;
}

async function withLiveLabels<T extends { href: string; label: string; kind: string }>(
  db: Db,
  orgId: string,
  orgSlug: string,
  rows: T[],
): Promise<(T & { kind: PinKind })[]> {
  const infos = rows.map((r) => describePath(orgSlug, r.href));
  const live = await resolveLabels(
    db,
    orgId,
    infos.filter((i): i is PageInfo => Boolean(i)),
  );
  const out: (T & { kind: PinKind })[] = [];
  rows.forEach((row, i) => {
    const info = infos[i];
    // A pin from before a slug rename: keep it, with its saved label.
    if (!info) {
      out.push({ ...row, kind: row.kind as PinKind });
      return;
    }
    if (info.lookup) {
      const label = live.get(info.href);
      if (!label) return;
      out.push({ ...row, label: clip(label), kind: info.kind });
    } else {
      out.push({ ...row, label: info.label, kind: info.kind });
    }
  });
  return out;
}

export async function listPins(db: Db, orgId: string, orgSlug: string, userId: string): Promise<PinnedItem[]> {
  const rows = await db.pin.findMany({
    where: { organizationId: orgId, userId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, href: true, label: true, kind: true },
    take: MAX_PINS,
  });
  return withLiveLabels(db, orgId, orgSlug, rows);
}

export async function listRecent(
  db: Db,
  orgId: string,
  orgSlug: string,
  userId: string,
  limit = 8,
): Promise<RecentItem[]> {
  const rows = await db.recentVisit.findMany({
    where: { organizationId: orgId, userId },
    orderBy: { visitedAt: "desc" },
    select: { href: true, label: true, kind: true, visitedAt: true },
    take: limit + 4,
  });
  return (await withLiveLabels(db, orgId, orgSlug, rows)).slice(0, limit);
}

/** Records a visit: one row per page, the oldest past RECENT_KEEP removed. */
export async function recordVisit(
  db: Db,
  orgId: string,
  orgSlug: string,
  userId: string,
  pathname: string,
): Promise<void> {
  const page = await describePage(db, orgId, orgSlug, pathname);
  if (!page || page.skipRecent) return;
  const data = { label: page.label, kind: page.kind, targetId: page.targetId, visitedAt: new Date() };
  await db.recentVisit.upsert({
    where: { userId_organizationId_href: { userId, organizationId: orgId, href: page.href } },
    create: { organizationId: orgId, userId, href: page.href, ...data },
    update: data,
  });
  const stale = await db.recentVisit.findMany({
    where: { organizationId: orgId, userId },
    orderBy: { visitedAt: "desc" },
    skip: RECENT_KEEP,
    select: { href: true },
  });
  if (stale.length) {
    await db.recentVisit.deleteMany({
      where: { organizationId: orgId, userId, href: { in: stale.map((s) => s.href) } },
    });
  }
}

export type PinResult = { ok: true; pinned: boolean } | { ok: false; error: string };

/** Pins the page at `pathname`, or unpins it if it is pinned. */
export async function togglePin(
  db: Db,
  orgId: string,
  orgSlug: string,
  userId: string,
  pathname: string,
): Promise<PinResult> {
  const page = await describePage(db, orgId, orgSlug, pathname);
  if (!page) return { ok: false, error: "This page can't be pinned." };
  const existing = await db.pin.findUnique({
    where: { userId_organizationId_href: { userId, organizationId: orgId, href: page.href } },
    select: { id: true },
  });
  if (existing) {
    await db.pin.delete({ where: { id: existing.id } });
    return { ok: true, pinned: false };
  }
  const count = await db.pin.count({ where: { organizationId: orgId, userId } });
  if (count >= MAX_PINS) return { ok: false, error: `You can pin up to ${MAX_PINS} items. Unpin one first.` };
  await db.pin.create({
    data: {
      organizationId: orgId,
      userId,
      href: page.href,
      label: page.label,
      kind: page.kind,
      targetId: page.targetId,
      sortOrder: count,
    },
  });
  return { ok: true, pinned: true };
}

/** Pins the page at `pathname` (already pinned: nothing changes). */
export async function pinPage(
  db: Db,
  orgId: string,
  orgSlug: string,
  userId: string,
  pathname: string,
): Promise<PinResult> {
  const page = await describePage(db, orgId, orgSlug, pathname);
  if (!page) return { ok: false, error: "That can't be pinned." };
  const existing = await db.pin.findUnique({
    where: { userId_organizationId_href: { userId, organizationId: orgId, href: page.href } },
    select: { id: true },
  });
  if (existing) return { ok: true, pinned: true };
  const count = await db.pin.count({ where: { organizationId: orgId, userId } });
  if (count >= MAX_PINS) return { ok: false, error: `You can pin up to ${MAX_PINS} items. Unpin one first.` };
  await db.pin.create({
    data: {
      organizationId: orgId,
      userId,
      href: page.href,
      label: page.label,
      kind: page.kind,
      targetId: page.targetId,
      sortOrder: count,
    },
  });
  return { ok: true, pinned: true };
}

/** Puts the member's pins in this order (ids not theirs are ignored by RLS). */
export async function reorderPins(db: Db, orgId: string, userId: string, ids: readonly string[]): Promise<void> {
  for (const [i, id] of ids.entries()) {
    await db.pin.updateMany({ where: { id, organizationId: orgId, userId }, data: { sortOrder: i } });
  }
}

export async function unpin(db: Db, orgId: string, userId: string, pinId: string): Promise<void> {
  await db.pin.deleteMany({ where: { id: pinId, organizationId: orgId, userId } });
}
