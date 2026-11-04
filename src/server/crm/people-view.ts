import {
  COMPANY_LISTS,
  lastTalked,
  PEOPLE_LISTS,
  readList,
  relationshipTone,
  rowNext,
  strengthBars,
  type RowNext,
} from "@/lib/crm/people-view";
import type { TagColor } from "@/lib/tag-colors";
import type { TxClient } from "@/server/db/context";

import { bringInCounts } from "./bring-in";
import { pendingDuplicates } from "./dedupe";
import { viewListQuery } from "./outreach/lists";
import { ownerLabel, type RoleOwner } from "./owners";
import {
  companiesWhere,
  listCompanies,
  listPeople,
  parseListQuery,
  peopleWhere,
  type ListQuery,
} from "./queries";
import { taskSteps } from "./task-steps";

/**
 * The People tab's data (docs/features/crm.md, "Redesign"): which list is
 * picked in Filters (`?list=`: a built-in one, one of the organization's
 * own, or everyone) on top of Owner and Relationship, the rows with the
 * one next step each shows, every list with its count, and what the
 * brand-new empty state offers. People and Companies (`?view=companies`)
 * share it. Read as the member (RLS decides what they see).
 */

type Search = Record<string, string | string[] | undefined>;

function one(sp: Search, k: string): string | undefined {
  const v = sp[k];
  return typeof v === "string" && v ? v : undefined;
}

export interface PeopleListEntry {
  /** The `?list=` value ("" for everyone). */
  id: string;
  label: string;
  count: number;
  /** One of the organization's own lists (its people can be added to by hand). */
  own: boolean;
  /** A hand-picked list (Add to list adds to these). */
  picked: boolean;
}

export interface PeopleTableRow {
  id: string;
  name: string;
  sub: string | null;
  rel: { label: string; tone: TagColor | null } | null;
  bars: number;
  strength: number;
  last: string;
  next: RowNext;
  /** The duplicate a Merge opens beside this one. */
  mergeWith: string | null;
  owner: string | null;
  deleted: boolean;
}

export interface PeoplePageData {
  companies: boolean;
  listId: string;
  listName: string;
  total: number;
  page: number;
  rows: PeopleTableRow[];
  lists: PeopleListEntry[];
  /** How many are in the trash (a quiet entry at the end of Lists). */
  trash: number;
  /** Nobody in the CRM at all yet: the "Nobody here yet" state, with what can come in. */
  empty: { members: number; contacts: number } | null;
}

const DAY = 86_400_000;

async function duplicatesOf(db: TxClient, organizationId: string) {
  const pairs = await pendingDuplicates(db, organizationId, 500);
  const byId = new Map<string, { otherId: string; name: string; reason: string | null }>();
  for (const d of pairs) {
    if (d.object !== "person") continue;
    const [a, b] = d.records as [(typeof d.records)[number], (typeof d.records)[number]];
    if (!byId.has(a.id)) byId.set(a.id, { otherId: b.id, name: b.name, reason: d.reasons[0] ?? null });
    if (!byId.has(b.id)) byId.set(b.id, { otherId: a.id, name: a.name, reason: d.reasons[0] ?? null });
  }
  return byId;
}

/** The people on this page who wrote in the last month and haven't had an answer: when they wrote. */
async function unanswered(db: TxClient, organizationId: string, ids: string[], now: Date) {
  const out = new Map<string, Date>();
  if (ids.length === 0) return out;
  const inbound = await db.crmEmailMessage.findMany({
    where: {
      organizationId,
      direction: "INBOUND",
      status: "RECEIVED",
      personId: { in: ids },
      createdAt: { gte: new Date(now.getTime() - 30 * DAY) },
    },
    orderBy: { createdAt: "desc" },
    take: 500,
    select: { personId: true, threadId: true, createdAt: true },
  });
  const latest = new Map<string, { threadId: string; at: Date }>();
  for (const m of inbound) if (m.personId && !latest.has(m.personId)) latest.set(m.personId, { threadId: m.threadId, at: m.createdAt });
  if (latest.size === 0) return out;
  const answers = await db.crmEmailMessage.findMany({
    where: {
      organizationId,
      direction: "OUTBOUND",
      threadId: { in: [...latest.values()].map((l) => l.threadId) },
      createdAt: { gte: new Date(now.getTime() - 30 * DAY) },
    },
    select: { threadId: true, createdAt: true },
  });
  for (const [personId, l] of latest) {
    if (!answers.some((a) => a.threadId === l.threadId && a.createdAt > l.at)) out.set(personId, l.at);
  }
  return out;
}

export async function peoplePage(
  db: TxClient,
  organizationId: string,
  viewerId: string,
  roles: ReadonlyMap<string, RoleOwner>,
  sp: Search,
  options: {
    names: ReadonlyMap<string, string>;
    relationships: readonly { id: string; label: string; color: string }[];
    now?: Date;
  },
): Promise<PeoplePageData> {
  const now = options.now ?? new Date();
  const companies = one(sp, "view") === "companies";
  const objectKind = companies ? "companies" : "people";
  const builtIns = companies ? COMPANY_LISTS : PEOPLE_LISTS;

  // The base query: Owner, Relationship, search and page from the URL;
  // never a status or "due" of its own (lists hold those).
  const url = parseListQuery(sp);
  const base: ListQuery = {
    q: url.q,
    owner: url.owner,
    relationship: companies ? undefined : url.relationship,
    trash: url.trash,
    page: url.page,
    sort: url.sort,
    dir: url.dir,
  };

  const views = await db.crmView.findMany({
    where: { organizationId, objectKind },
    orderBy: { createdAt: "asc" },
    take: 30,
    select: { id: true, name: true, filters: true },
  });
  const dupes = companies ? new Map() : await duplicatesOf(db, organizationId);

  const queryFor = (listId: string): ListQuery => {
    const list = readList(listId, companies);
    if (list.kind === "builtin") {
      if (list.id === "dupes") return { ...base, ids: [...dupes.keys()] };
      return { ...base, due: list.id };
    }
    if (list.kind === "view") {
      const view = views.find((v) => v.id === list.id);
      if (!view) return base;
      const own = viewListQuery(view.filters);
      return {
        ...base,
        ...Object.fromEntries(Object.entries(own).filter(([, v]) => v !== undefined)),
        // What the bar picks wins over what the list was saved with.
        owner: base.owner ?? own.owner,
        relationship: base.relationship ?? own.relationship,
        q: base.q,
        page: base.page,
      };
    }
    return base;
  };
  const countOf = (q: ListQuery) =>
    companies
      ? db.crmCompany.count({ where: companiesWhere(organizationId, q, viewerId, roles, now) })
      : db.crmPerson.count({ where: peopleWhere(organizationId, q, viewerId, roles, now) });

  const lists: PeopleListEntry[] = [];
  for (const l of builtIns) {
    if (l.id === "dupes" && dupes.size === 0) continue;
    lists.push({ id: l.id, label: l.label, count: await countOf(queryFor(l.id)), own: false, picked: false });
  }
  for (const v of views) {
    lists.push({
      id: v.id,
      label: v.name,
      count: await countOf(queryFor(v.id)),
      own: true,
      picked: viewListQuery(v.filters).ids !== undefined,
    });
  }

  const requested = one(sp, "list") ?? "";
  const picked = readList(requested, companies);
  const listId =
    picked.kind === "all" ? "" : picked.kind === "view" && !views.some((v) => v.id === picked.id) ? "" : picked.id;
  const query = queryFor(listId);
  const listName = lists.find((l) => l.id === listId)?.label ?? builtIns[0]!.label;
  const tones = new Map(options.relationships.map((r) => [r.id, r]));

  let rows: PeopleTableRow[];
  let total: number;
  if (companies) {
    const data = await listCompanies(db, organizationId, query, viewerId, roles);
    total = data.total;
    const tasks = await taskSteps(db, organizationId, "company", data.rows.map((c) => c.id));
    rows = data.rows.map((c) => ({
      id: c.id,
      name: c.name,
      sub:
        [c.people === 1 ? "1 person" : c.people ? `${c.people} people` : null, c.industry ?? c.domain]
          .filter(Boolean)
          .join(", ") || null,
      rel: null,
      bars: strengthBars(c.strength),
      strength: c.strength,
      last: lastTalked(c.lastContactedAt, now),
      next: rowNext(
        {
          nextFollowUpAt: c.nextFollowUpAt,
          lastContactedAt: c.lastContactedAt,
          task: tasks.get(c.id) ?? null,
        },
        now,
      ),
      mergeWith: null,
      owner: ownerLabel(c, roles, options.names),
      deleted: Boolean(c.deletedAt),
    }));
  } else {
    const data = await listPeople(db, organizationId, query, viewerId, roles);
    total = data.total;
    const ids = data.rows.map((p) => p.id);
    const blocked = new Set(
      (
        await db.crmPerson.findMany({
          where: { organizationId, id: { in: ids }, doNotContact: true },
          select: { id: true },
        })
      ).map((p) => p.id),
    );
    const wrote = await unanswered(db, organizationId, ids, now);
    const tasks = await taskSteps(db, organizationId, "person", ids);
    rows = data.rows.map((p) => {
      const dup = dupes.get(p.id) ?? null;
      const type = p.relationship ? tones.get(p.relationship) : null;
      return {
        id: p.id,
        name: p.name,
        sub: [p.title, p.companyName].filter(Boolean).join(", ") || p.primaryEmail || null,
        rel: p.relationship
          ? { label: type?.label ?? p.relationship, tone: relationshipTone(type?.color) }
          : null,
        bars: strengthBars(p.strength),
        strength: p.strength,
        last: lastTalked(p.lastContactedAt, now),
        next: rowNext(
          {
            nextFollowUpAt: p.nextFollowUpAt,
            lastContactedAt: p.lastContactedAt,
            doNotContact: blocked.has(p.id),
            duplicate: dup ? { name: dup.name, reason: dup.reason } : null,
            wroteAt: wrote.get(p.id) ?? null,
            task: tasks.get(p.id) ?? null,
          },
          now,
        ),
        mergeWith: dup?.otherId ?? null,
        owner: ownerLabel(p, roles, options.names),
        deleted: Boolean(p.deletedAt),
      };
    });
  }

  // Nobody in the CRM yet (not just nobody matching): what can come in.
  let empty: PeoplePageData["empty"] = null;
  if (!companies && total === 0) {
    const anyone = await db.crmPerson.count({ where: { organizationId } });
    if (anyone === 0) {
      const counts = await bringInCounts(db, organizationId);
      empty = { members: counts.members, contacts: counts.contacts };
    }
  }

  const trash = companies
    ? await db.crmCompany.count({ where: { organizationId, deletedAt: { not: null } } })
    : await db.crmPerson.count({ where: { organizationId, deletedAt: { not: null } } });

  return {
    companies,
    listId,
    listName: query.trash ? "In the trash" : listName,
    total,
    page: query.page ?? 1,
    rows,
    lists,
    trash,
    empty,
  };
}
