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
  timeZone = "UTC",
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

  const day = (d: Date) =>
    new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone }).format(d);
  const money = (cents: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
    }).format(cents / 100);
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

  const taskIds = ids("task");
  if (taskIds.length) {
    const rows = await db.task.findMany({
      where: { organizationId: orgId, id: { in: taskIds }, deletedAt: null },
      select: { id: true, title: true, type: true, status: true, dueDate: true },
    });
    // An epic says how far along it is: "6 of 11 done".
    const epics = rows.filter((t) => t.type === "EPIC").map((t) => t.id);
    const kids = epics.length
      ? await db.task.groupBy({
          by: ["parentTaskId", "status"],
          where: { organizationId: orgId, parentTaskId: { in: epics }, deletedAt: null },
          _count: { _all: true },
        })
      : [];
    for (const t of rows) {
      const word = t.type === "EPIC" ? "Epic" : "Task";
      let fact: string | null = null;
      if (t.type === "EPIC") {
        const mine = kids.filter((k) => k.parentTaskId === t.id);
        const total = mine.reduce((n, k) => n + k._count._all, 0);
        const done = mine
          .filter((k) => k.status === "COMPLETED")
          .reduce((n, k) => n + k._count._all, 0);
        fact = total > 0 ? `${done} of ${total} done` : "nothing in it yet";
      } else if (t.status === "COMPLETED") fact = "done";
      else if (t.dueDate) fact = `due ${day(t.dueDate)}`;
      out.set(key({ kind: "task", id: t.id }), {
        kind: "task",
        id: t.id,
        title: t.title,
        href: `${base}/tasks/${t.id}`,
        detail: fact ? `${word}, ${fact}` : word,
      });
    }
  }
  const eventIds = ids("event");
  if (eventIds.length) {
    const rows = await db.event.findMany({
      where: { organizationId: orgId, id: { in: eventIds }, deletedAt: null },
      select: { id: true, title: true, startsAt: true },
    });
    const going = rows.length
      ? await db.eventAttendee.groupBy({
          by: ["eventId"],
          where: { organizationId: orgId, eventId: { in: rows.map((e) => e.id) }, rsvp: "YES" },
          _count: { _all: true },
        })
      : [];
    for (const e of rows) {
      const n = going.find((g) => g.eventId === e.id)?._count._all ?? 0;
      put(
        "event",
        e.id,
        e.title,
        `${base}/meetings/${e.id}`,
        n > 0 ? `${day(e.startsAt)}, ${n} going` : day(e.startsAt),
      );
    }
  }
  const noteIds = ids("note");
  if (noteIds.length) {
    const rows = await db.note.findMany({
      where: { organizationId: orgId, id: { in: noteIds }, deletedAt: null },
      select: { id: true, title: true, updatedAt: true },
    });
    for (const n of rows) {
      put(
        "note",
        n.id,
        n.title || "Untitled",
        `${base}/notes/${n.id}`,
        `edited ${day(n.updatedAt)}`,
      );
    }
  }
  const fileIds = ids("file");
  if (fileIds.length) {
    const rows = await db.orgFile.findMany({
      where: { organizationId: orgId, id: { in: fileIds }, deletedAt: null },
      select: { id: true, name: true, sizeBytes: true },
    });
    for (const f of rows) {
      const kb = f.sizeBytes / 1024;
      const size =
        kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(kb))} KB`;
      put("file", f.id, f.name, `${base}/notes/files/${f.id}`, size);
    }
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
      select: { id: true, key: true, name: true },
    });
    const counts = rows.length
      ? await db.databaseRecord.groupBy({
          by: ["databaseId"],
          where: {
            organizationId: orgId,
            databaseId: { in: rows.map((d) => d.id) },
            deletedAt: null,
          },
          _count: { _all: true },
        })
      : [];
    for (const d of rows) {
      const n = counts.find((c) => c.databaseId === d.id)?._count._all;
      put("database", d.key, d.name, `${base}/databases/${d.key}`, n ? plural(n, "row") : null);
    }
  }
  const txIds = ids("transaction");
  if (txIds.length) {
    const rows = await db.transaction.findMany({
      where: { organizationId: orgId, id: { in: txIds }, voidedAt: null },
      select: { id: true, description: true, amountCents: true, status: true, direction: true },
    });
    for (const t of rows) {
      const state =
        t.status === "SUBMITTED"
          ? "waiting on review"
          : t.status === "APPROVED"
            ? "to pay"
            : t.status === "REIMBURSED"
              ? "paid back"
              : t.status === "REJECTED"
                ? "declined"
                : null;
      const amount = `${t.direction === "IN" ? "+" : ""}${money(t.amountCents)}`;
      put(
        "transaction",
        t.id,
        t.description,
        `${base}/finance/transactions?open=${t.id}`,
        state ? `${amount}, ${state}` : amount,
      );
    }
  }
  const budgetIds = ids("budget");
  if (budgetIds.length) {
    const rows = await db.budgetCategory.findMany({
      where: { organizationId: orgId, id: { in: budgetIds } },
      select: { id: true, name: true, allocatedCents: true, budgetPeriodId: true },
    });
    // Spent as Finance counts it (src/lib/finance/stats.ts): money out that
    // isn't a draft or declined.
    const spent = rows.length
      ? await db.transaction.groupBy({
          by: ["categoryId"],
          where: {
            organizationId: orgId,
            categoryId: { in: rows.map((c) => c.id) },
            direction: "OUT",
            voidedAt: null,
            status: { notIn: ["DRAFT", "REJECTED"] },
          },
          _sum: { amountCents: true },
        })
      : [];
    for (const c of rows) {
      const used = spent.find((x) => x.categoryId === c.id)?._sum.amountCents ?? 0;
      put(
        "budget",
        c.id,
        c.name,
        `${base}/finance/budget?period=${c.budgetPeriodId}`,
        `${money(c.allocatedCents - used)} left`,
      );
    }
  }
  const recordIds = ids("record");
  if (recordIds.length) {
    // A database row: its first field's value names it, in its database.
    const rows = await db.databaseRecord.findMany({
      where: { organizationId: orgId, id: { in: recordIds }, deletedAt: null },
      select: {
        id: true,
        values: true,
        database: {
          select: {
            key: true,
            name: true,
            fields: { select: { id: true }, orderBy: { sortOrder: "asc" }, take: 3 },
          },
        },
      },
    });
    for (const r of rows) {
      const values = (r.values ?? {}) as Record<string, unknown>;
      const named = r.database.fields
        .map((f) => values[f.id])
        .find((v) => typeof v === "string" && v.trim()) as string | undefined;
      put(
        "record",
        r.id,
        named?.trim() || "Untitled row",
        `${base}/databases/${r.database.key}?row=${r.id}`,
        `in ${r.database.name}`,
      );
    }
  }
  const formIds = ids("form");
  if (formIds.length) {
    const rows = await db.form.findMany({
      where: { organizationId: orgId, id: { in: formIds }, deletedAt: null },
      select: { id: true, title: true, kind: true },
    });
    const answers = rows.length
      ? await db.formResponse.groupBy({
          by: ["formId"],
          where: { organizationId: orgId, formId: { in: rows.map((f) => f.id) } },
          _count: { _all: true },
        })
      : [];
    for (const f of rows) {
      const n = answers.find((x) => x.formId === f.id)?._count._all ?? 0;
      const poll = f.kind === "QUICK_POLL";
      out.set(key({ kind: "form", id: f.id }), {
        kind: "form",
        id: f.id,
        title: f.title,
        href: `${base}/forms/${f.id}`,
        detail: `${poll ? "Quick poll" : "Form"}, ${plural(n, poll ? "vote" : "response")}`,
      });
    }
  }
  return out;
}

/**
 * What `ref` is linked to, both ways, as the viewer can see it: newest
 * link first, and only the ends that resolve for them.
 */
export async function listLinked(
  db: TxClient,
  orgId: string,
  orgSlug: string,
  ref: LinkRef,
  timeZone = "UTC",
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
  const resolved = await resolveRefs(db, orgId, orgSlug, others, timeZone);
  return others.flatMap((o) => {
    const hit = resolved.get(key(o));
    return hit ? [{ ...hit, linkId: o.linkId }] : [];
  });
}
