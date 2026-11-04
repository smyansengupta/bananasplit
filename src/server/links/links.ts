import {
  isLinkKind,
  isMeeting,
  KIND_WORD,
  type LinkedItem,
  type LinkKind,
  type LinkRef,
  type ResolvedRef,
} from "@/lib/links";
import { pollHref } from "@/lib/polls/paths";
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

/** One link seen from the end that was asked about. */
export interface LinkEnd {
  /** The end asked about, as "kind:id". */
  at: string;
  /** The far end. */
  other: LinkRef;
  /** The ItemLink row, for Remove. */
  linkId: string;
}

/**
 * The one reader of ItemLink rows: every link touching `refs`, either way
 * round, as (asked-about end, far end) pairs. Only the rows: the far ends
 * are looked up by the caller as the viewer (resolveRefs), so a thing they
 * can't see never shows. A far end of a kind the app doesn't know is left
 * out. A link between two of `refs` comes back once from each end.
 *
 * `otherKinds` keeps only far ends of those kinds; `order` is by when the
 * link was made, newest first unless asked otherwise.
 */
export async function readLinks(
  db: TxClient,
  orgId: string,
  refs: readonly LinkRef[],
  {
    otherKinds,
    order = "desc",
    take = 500,
  }: { otherKinds?: readonly LinkKind[]; order?: "asc" | "desc"; take?: number } = {},
): Promise<LinkEnd[]> {
  const wanted = new Set(refs.map(key));
  if (wanted.size === 0) return [];
  const byKind = new Map<LinkKind, Set<string>>();
  for (const r of refs) byKind.set(r.kind, (byKind.get(r.kind) ?? new Set()).add(r.id));
  const far = otherKinds ? { in: [...otherKinds] } : undefined;
  const rows = await db.itemLink.findMany({
    where: {
      organizationId: orgId,
      OR: [...byKind].flatMap(([kind, ids]) => [
        { fromKind: kind, fromId: { in: [...ids] }, ...(far ? { toKind: far } : {}) },
        { toKind: kind, toId: { in: [...ids] }, ...(far ? { fromKind: far } : {}) },
      ]),
    },
    select: { id: true, fromKind: true, fromId: true, toKind: true, toId: true },
    orderBy: { createdAt: order },
    take,
  });
  const keep = (kind: string): kind is LinkKind =>
    isLinkKind(kind) && (!otherKinds || otherKinds.includes(kind));
  const out: LinkEnd[] = [];
  for (const r of rows) {
    const from = `${r.fromKind}:${r.fromId}`;
    const to = `${r.toKind}:${r.toId}`;
    if (from === to) continue;
    if (wanted.has(from) && keep(r.toKind))
      out.push({ at: from, other: { kind: r.toKind, id: r.toId }, linkId: r.id });
    if (wanted.has(to) && keep(r.fromKind))
      out.push({ at: to, other: { kind: r.fromKind, id: r.fromId }, linkId: r.id });
  }
  return out;
}

/** How Home chips a kind when nothing about the thing itself changes it. */
const CHIP: Record<LinkKind, ResolvedRef["chip"]> = {
  task: "task",
  event: "event",
  note: "note",
  file: "file",
  person: "person",
  database: "database",
  transaction: "money",
  form: "form",
  budget: "money",
  record: "database",
  poll: "poll",
  decision: "decision",
  announcement: "announcement",
  "crm-person": "person",
  "crm-company": "database",
  "crm-deal": "database",
};

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
      chip: CHIP[kind],
    });

  const day = (d: Date) =>
    new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone }).format(d);
  // A task's due date is a calendar day stored as midnight UTC: read it in
  // UTC, as Tasks does, or it lands a day early west of Greenwich.
  const dueDay = (d: Date) =>
    new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(d);
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
      else if (t.dueDate) fact = `due ${dueDay(t.dueDate)}`;
      out.set(key({ kind: "task", id: t.id }), {
        kind: "task",
        id: t.id,
        title: t.title,
        href: `${base}/tasks/${t.id}`,
        detail: fact ? `${word}, ${fact}` : word,
        chip: "task",
        done: t.status === "COMPLETED",
      });
    }
  }
  const eventIds = ids("event");
  if (eventIds.length) {
    const rows = await db.event.findMany({
      where: { organizationId: orgId, id: { in: eventIds }, deletedAt: null, mergedIntoId: null },
      select: { id: true, title: true, startsAt: true, kind: true, meetingType: true },
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
      const meeting = isMeeting(e);
      const when = n > 0 ? `${day(e.startsAt)}, ${n} going` : day(e.startsAt);
      // A meeting opens on its meeting page, anything else on the calendar.
      out.set(key({ kind: "event", id: e.id }), {
        kind: "event",
        id: e.id,
        title: e.title,
        href: meeting ? `${base}/meetings/${e.id}` : `${base}/calendar/${e.id}`,
        detail: `${meeting ? "Meeting" : "Event"}, ${when}`,
        chip: meeting ? "meeting" : "event",
        startsAt: e.startsAt,
        going: n,
      });
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
        chip: poll ? "poll" : "form",
      });
    }
  }
  const pollIds = ids("poll");
  if (pollIds.length) {
    const rows = await db.poll.findMany({
      where: { organizationId: orgId, id: { in: pollIds } },
      select: { id: true, question: true, closesAt: true, closedAt: true },
    });
    const now = new Date();
    for (const p of rows) {
      const open = !p.closedAt && (!p.closesAt || p.closesAt > now);
      put(
        "poll",
        p.id,
        p.question,
        pollHref(base, "question", p.id),
        !open ? "closed" : p.closesAt ? `closes ${day(p.closesAt)}` : "open",
      );
    }
  }
  // A decision has no page of its own: it lives in Home's Decisions.
  const decisionIds = ids("decision");
  if (decisionIds.length) {
    const rows = await db.decision.findMany({
      where: { organizationId: orgId, id: { in: decisionIds } },
      select: { id: true, question: true, status: true },
    });
    for (const d of rows) {
      const state = d.status === "OPEN" ? "open" : d.status === "DECIDED" ? "decided" : "dropped";
      put("decision", d.id, d.question, base, state);
    }
  }
  // Announcements are read in the Inbox.
  const announcementIds = ids("announcement");
  if (announcementIds.length) {
    const rows = await db.announcement.findMany({
      where: { organizationId: orgId, id: { in: announcementIds }, deletedAt: null },
      select: { id: true, title: true, createdAt: true },
    });
    for (const a of rows) {
      put("announcement", a.id, a.title, `${base}/inbox`, `posted ${day(a.createdAt)}`);
    }
  }
  // The CRM's records, as the viewer may see them (OWN access hides others').
  const crmPeople = ids("crm-person");
  if (crmPeople.length) {
    const rows = await db.crmPerson.findMany({
      where: { organizationId: orgId, id: { in: crmPeople }, deletedAt: null },
      select: { id: true, name: true, title: true },
    });
    for (const p of rows) put("crm-person", p.id, p.name, `${base}/crm/people/${p.id}`, p.title);
  }
  const crmCompanies = ids("crm-company");
  if (crmCompanies.length) {
    const rows = await db.crmCompany.findMany({
      where: { organizationId: orgId, id: { in: crmCompanies }, deletedAt: null },
      select: { id: true, name: true, domain: true },
    });
    for (const c of rows) put("crm-company", c.id, c.name, `${base}/crm/companies/${c.id}`, c.domain);
  }
  const crmDeals = ids("crm-deal");
  if (crmDeals.length) {
    const rows = await db.crmDeal.findMany({
      where: { organizationId: orgId, id: { in: crmDeals }, deletedAt: null },
      select: { id: true, title: true, stage: { select: { name: true } } },
    });
    for (const d of rows) put("crm-deal", d.id, d.title, `${base}/crm/items/${d.id}`, d.stage.name);
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
  const others = (await readLinks(db, orgId, [ref], { take: 100 })).map((l) => ({
    ...l.other,
    linkId: l.linkId,
  }));
  const resolved = await resolveRefs(db, orgId, orgSlug, others, timeZone);
  return others.flatMap((o) => {
    const hit = resolved.get(key(o));
    return hit ? [{ ...hit, linkId: o.linkId }] : [];
  });
}
