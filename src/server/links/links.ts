import {
  isLinkKind,
  KIND_WORD,
  type LinkedItem,
  type LinkKind,
  type LinkRef,
  type ResolvedRef,
} from "@/lib/links";
import type { TxClient } from "@/server/db/context";

export { isLinkKind, type LinkedItem, type LinkKind, type LinkRef, type ResolvedRef };

/**
 * Links between things in a space (ItemLink), read as the viewer.
 *
 * A link row holds two references and nothing else. What each end is called
 * and where it opens are looked up here, through the viewer's own
 * row-level security, every time: a thing the viewer can't see simply
 * doesn't resolve, so its link stays out of their panel, and a renamed task
 * shows its new name.
 */

const key = (r: LinkRef) => `${r.kind}:${r.id}`;

/**
 * Looks each reference up as the viewer; the ones they can't see (or that
 * are gone) are left out of the map.
 */
export async function resolveRefs(
  db: TxClient,
  orgId: string,
  orgSlug: string,
  refs: readonly LinkRef[],
): Promise<Map<string, ResolvedRef>> {
  const base = `/app/${orgSlug}`;
  const ids = (kind: LinkKind) => [
    ...new Set(refs.filter((r) => r.kind === kind).map((r) => r.id)),
  ];
  const out = new Map<string, ResolvedRef>();
  const put = (kind: LinkKind, id: string, title: string, href: string, fact?: string | null) =>
    out.set(key({ kind, id }), {
      kind,
      id,
      title,
      href,
      detail: fact ? `${KIND_WORD[kind]}, ${fact}` : KIND_WORD[kind],
    });

  const taskIds = ids("task");
  if (taskIds.length) {
    const rows = await db.task.findMany({
      where: { organizationId: orgId, id: { in: taskIds }, deletedAt: null },
      select: { id: true, title: true, type: true, status: true },
    });
    for (const t of rows) {
      put(
        "task",
        t.id,
        t.title,
        `${base}/tasks/${t.id}`,
        t.type === "EPIC" ? "epic" : t.status === "COMPLETED" ? "done" : null,
      );
    }
  }
  const eventIds = ids("event");
  if (eventIds.length) {
    const rows = await db.event.findMany({
      where: { organizationId: orgId, id: { in: eventIds }, deletedAt: null },
      select: { id: true, title: true, startsAt: true },
    });
    for (const e of rows) {
      put("event", e.id, e.title, `${base}/meetings/${e.id}`, DAY.format(e.startsAt));
    }
  }
  const noteIds = ids("note");
  if (noteIds.length) {
    const rows = await db.note.findMany({
      where: { organizationId: orgId, id: { in: noteIds }, deletedAt: null },
      select: { id: true, title: true },
    });
    for (const n of rows) put("note", n.id, n.title || "Untitled", `${base}/notes/${n.id}`);
  }
  const fileIds = ids("file");
  if (fileIds.length) {
    const rows = await db.orgFile.findMany({
      where: { organizationId: orgId, id: { in: fileIds }, deletedAt: null },
      select: { id: true, name: true },
    });
    for (const f of rows) put("file", f.id, f.name, `${base}/notes/files/${f.id}`);
  }
  const personIds = ids("person");
  if (personIds.length) {
    const rows = await db.membership.findMany({
      where: { organizationId: orgId, userId: { in: personIds } },
      select: { userId: true, title: true, user: { select: { name: true } } },
    });
    for (const m of rows) {
      put("person", m.userId, m.user.name ?? "Member", `${base}/people/${m.userId}`, m.title);
    }
  }
  const dbKeys = ids("database");
  if (dbKeys.length) {
    const rows = await db.databaseDefinition.findMany({
      where: { organizationId: orgId, key: { in: dbKeys }, archivedAt: null },
      select: { key: true, name: true },
    });
    for (const d of rows) put("database", d.key, d.name, `${base}/databases/${d.key}`);
  }
  const txIds = ids("transaction");
  if (txIds.length) {
    const rows = await db.transaction.findMany({
      where: { organizationId: orgId, id: { in: txIds }, voidedAt: null },
      select: { id: true, description: true },
    });
    for (const t of rows) {
      put("transaction", t.id, t.description, `${base}/finance/transactions?open=${t.id}`);
    }
  }
  // Forms resolve once Forms lands (src/server/forms); until then a form
  // link stays out of the panel rather than pointing somewhere wrong.
  return out;
}

const DAY = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/**
 * What `ref` is linked to, both ways, as the viewer can see it: newest
 * link first, and only the ends that resolve for them.
 */
export async function listLinked(
  db: TxClient,
  orgId: string,
  orgSlug: string,
  ref: LinkRef,
): Promise<LinkedItem[]> {
  const rows = await db.itemLink.findMany({
    where: {
      organizationId: orgId,
      OR: [
        { fromKind: ref.kind, fromId: ref.id },
        { toKind: ref.kind, toId: ref.id },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const others: (LinkRef & { linkId: string })[] = rows.flatMap((r) => {
    const fromHere = r.fromKind === ref.kind && r.fromId === ref.id;
    const kind = fromHere ? r.toKind : r.fromKind;
    const id = fromHere ? r.toId : r.fromId;
    return isLinkKind(kind) ? [{ kind, id, linkId: r.id }] : [];
  });
  const resolved = await resolveRefs(db, orgId, orgSlug, others);
  return others.flatMap((o) => {
    const hit = resolved.get(key(o));
    return hit ? [{ ...hit, linkId: o.linkId }] : [];
  });
}
