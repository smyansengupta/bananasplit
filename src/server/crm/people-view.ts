import type { Prisma } from "@/generated/prisma/client";
import type { DealsFilters } from "@/lib/crm/deals-tab";
import { formatMoney } from "@/lib/crm/fields";
import {
  COMPANY_LISTS,
  dealsTotalLabel,
  lastTalked,
  PEOPLE_LISTS,
  peopleDealFilters,
  readList,
  readPeopleView,
  relationshipTone,
  rowDeal,
  rowNext,
  strengthBars,
  type PeopleView,
  type RowDealInput,
  type RowNext,
} from "@/lib/crm/people-view";
import { effectiveStatus } from "@/lib/crm/quotes";
import type { TagColor } from "@/lib/tag-colors";
import type { TxClient } from "@/server/db/context";

import { bringInCounts } from "./bring-in";
import { dealFilterWhere, dealTypeFields, defaultDealPipeline, loadDealsTab, typeLabelsOf, type DealRow } from "./deals-tab";
import { pendingDuplicates } from "./dedupe";
import { viewListQuery } from "./outreach/lists";
import { ownerLabel, type RoleOwner } from "./owners";
import type { PipelineView } from "./pipelines";
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
 * The People tab's data (docs/features/crm.md, "Redesign" and "One list"):
 * one list of everyone you deal with, as People, Companies or a Board of
 * their deals by stage (`?view=`). Filters picks a list (`?list=`: a
 * built-in one, one of the organization's own, or everyone), Owner and
 * Relationship, and the deal filters (Pipeline, Stage, Deal type,
 * Open/Won/Lost). The rows carry the one next step each shows and their
 * open deal (Stage and Deal value); every list comes with its count; the
 * board gets its pipeline's deals. Read as the member (RLS decides).
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

/** The deal a row shows: the most advanced of theirs that the filters allow (open by default). */
export interface PeopleRowDeal {
  id: string;
  title: string;
  stage: string;
  stageKind: "OPEN" | "WON" | "LOST";
  /** Where the stage sits among its pipeline's (for its dot's colour). */
  openIndex: number;
  amount: string | null;
  /** How many more deals they have besides this one. */
  more: number;
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
  deal: PeopleRowDeal | null;
}

export interface PeopleBoard {
  pipeline: PipelineView;
  rows: DealRow[];
}

export interface PeoplePageData {
  view: PeopleView;
  companies: boolean;
  listId: string;
  listName: string;
  /** Rows on the tables; deals on the board. */
  total: number;
  page: number;
  rows: PeopleTableRow[];
  lists: PeopleListEntry[];
  /** How many are in the trash (a quiet entry at the end of Lists). */
  trash: number;
  /** Nobody in the CRM at all yet: the "Nobody here yet" state, with what can come in. */
  empty: { members: number; contacts: number } | null;
  /** A deal filter is on (the tables narrow to those with a matching deal). */
  dealsOn: boolean;
  /** "$X in open deals" beside the heading, when a deal filter or the board is on. */
  money: { text: string; label: string } | null;
  /** What the deal filters offer. */
  dealOptions: {
    pipelines: { id: string; name: string }[];
    stages: { id: string; label: string }[];
    types: string[];
  };
  board: PeopleBoard | null;
  /** Follow-up series that are on (Add to a follow-up series). */
  series: { id: string; name: string }[];
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

/** The pipelines a deal filter covers: the one picked, the picked stage's, or all. */
function pipelinesFor(pipelines: readonly PipelineView[], f: DealsFilters): PipelineView[] {
  if (f.pipeline) return pipelines.filter((p) => p.id === f.pipeline);
  if (f.stage) return pipelines.filter((p) => p.stages.some((s) => s.id === f.stage));
  return [...pipelines];
}

interface RowDealFull extends RowDealInput {
  stage: string;
  stageKind: "OPEN" | "WON" | "LOST";
  stageOrder: number;
  openIndex: number;
  amountCents: number | null;
  amount: string | null;
}

/** Each row's deals that the filters allow, by person (or company). */
async function dealsByRow(
  db: TxClient,
  where: Prisma.CrmDealWhereInput,
  companies: boolean,
  ids: string[],
  pipelines: readonly PipelineView[],
  now: Date,
): Promise<Map<string, RowDealFull[]>> {
  const out = new Map<string, RowDealFull[]>();
  if (ids.length === 0) return out;
  const order = new Map<string, { at: number; open: number }>();
  for (const p of pipelines) {
    let open = 0;
    p.stages.forEach((s, i) => order.set(s.id, { at: i, open: s.kind === "OPEN" ? open++ : 0 }));
  }
  const found = await db.crmDeal.findMany({
    where: {
      AND: [where, companies ? { companyId: { in: ids } } : { people: { some: { personId: { in: ids } } } }],
    },
    take: 1000,
    select: {
      id: true,
      title: true,
      stageId: true,
      amountCents: true,
      currency: true,
      companyId: true,
      nextStep: true,
      nextStepAt: true,
      stage: { select: { name: true, kind: true } },
      people: { where: { personId: { in: ids } }, select: { personId: true } },
      quotes: {
        where: { kind: { not: "invoice" } },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { status: true, validUntil: true },
      },
    },
  });
  for (const d of found) {
    const q = d.quotes[0];
    const status = q ? effectiveStatus(q, now) : null;
    const at = order.get(d.stageId);
    const full: RowDealFull = {
      id: d.id,
      title: d.title,
      quote:
        d.stage.kind === "OPEN" && (status === "DRAFT" || status === "DECLINED" || status === "EXPIRED")
          ? status
          : null,
      nextStep: d.nextStep,
      nextStepAt: d.nextStepAt,
      stage: d.stage.name,
      stageKind: d.stage.kind,
      stageOrder: at?.at ?? 0,
      openIndex: at?.open ?? 0,
      amountCents: d.amountCents,
      amount: d.amountCents !== null ? formatMoney(d.amountCents, d.currency) : null,
    };
    const keys = companies ? (d.companyId ? [d.companyId] : []) : d.people.map((p) => p.personId);
    for (const k of keys) {
      const list = out.get(k);
      if (list) list.push(full);
      else out.set(k, [full]);
    }
  }
  return out;
}

function rowDealView(deals: RowDealFull[] | undefined): { view: PeopleRowDeal | null; next: RowDealInput | null } {
  const picked = rowDeal(deals ?? []);
  if (!picked) return { view: null, next: null };
  const d = picked.deal;
  return {
    view: {
      id: d.id,
      title: d.title,
      stage: d.stage,
      stageKind: d.stageKind,
      openIndex: d.openIndex,
      amount: d.amount,
      more: picked.more,
    },
    next: d.stageKind === "OPEN" ? d : null,
  };
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
    pipelines: readonly PipelineView[];
    now?: Date;
  },
): Promise<PeoplePageData> {
  const now = options.now ?? new Date();
  const view = readPeopleView(sp.view);
  const companies = view === "companies";
  const onBoard = view === "board";
  const objectKind = companies ? "companies" : "people";
  const builtIns = companies ? COMPANY_LISTS : PEOPLE_LISTS;
  const viewer = { id: viewerId, roles };

  // The deal filters: as a where for the tables (the person's owner and
  // search are the table's own), and the pipelines they cover.
  const { filters: dealF, on: dealsOn } = peopleDealFilters(sp);
  const pipelines = options.pipelines;
  const covered = pipelinesFor(pipelines, dealF);
  const typeFields = await dealTypeFields(db, organizationId, pipelines);
  const rowDealWhere = dealFilterWhere(
    organizationId,
    covered.map((p) => p.id),
    { ...dealF, owner: null, q: null },
    typeFields,
    viewer,
  );

  // The base query: Owner, Relationship, search and page from the URL;
  // never a status or "due" of its own (lists hold those).
  const url = parseListQuery(sp);
  const base: ListQuery = {
    q: url.q,
    owner: url.owner,
    relationship: companies ? undefined : url.relationship,
    trash: onBoard ? false : url.trash,
    page: url.page,
    sort: url.sort,
    dir: url.dir,
    deals: dealsOn && !onBoard ? rowDealWhere : undefined,
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
        deals: base.deals,
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

  const stageOptions = covered.length === 1 || pipelines.length === 1
    ? (covered[0] ?? pipelines[0])!.stages.map((s) => ({ id: s.id, label: s.name }))
    : covered.flatMap((p) => p.stages.map((s) => ({ id: s.id, label: `${p.name}: ${s.name}` })));
  const dealOptions = {
    pipelines: pipelines.map((p) => ({ id: p.id, name: p.name })),
    stages: pipelines.length === 0 ? [] : stageOptions,
    types: typeLabelsOf(new Map([...typeFields].filter(([id]) => covered.some((p) => p.id === id)))),
  };
  const series = (
    await db.crmSequence.findMany({
      where: { organizationId, archivedAt: null, status: "ON" },
      orderBy: { name: "asc" },
      take: 50,
      select: { id: true, name: true },
    })
  ).map((s) => ({ id: s.id, name: s.name }));

  const trash = onBoard
    ? 0
    : companies
      ? await db.crmCompany.count({ where: { organizationId, deletedAt: { not: null } } })
      : await db.crmPerson.count({ where: { organizationId, deletedAt: { not: null } } });

  // ---- The board: one pipeline's deals, narrowed through their people by
  // the list and relationship picked; Owner is the deal's owner.
  if (onBoard) {
    const pipeline =
      covered.length === 1 ? covered[0]! : (defaultDealPipeline(dealF.stage ? covered : pipelines) ?? null);
    let board: PeopleBoard | null = null;
    let money: PeoplePageData["money"] = null;
    if (pipeline) {
      const narrowed = Boolean(listId || query.relationship);
      const extra: Prisma.CrmDealWhereInput | undefined = narrowed
        ? {
            people: {
              some: {
                person: peopleWhere(organizationId, { ...query, q: undefined, owner: undefined, page: undefined, deals: undefined }, viewerId, roles, now),
              },
            },
          }
        : undefined;
      const tab = await loadDealsTab(
        db,
        organizationId,
        pipelines,
        { ...dealF, pipeline: pipeline.id },
        { id: viewerId, roles, names: options.names },
        now,
        extra,
      );
      board = { pipeline, rows: tab.rows };
      const sum = tab.rows.reduce((n, r) => n + (r.amountCents ?? 0), 0);
      if (sum > 0) money = { text: formatMoney(sum, pipeline.currency), label: dealsTotalLabel(dealF.show) };
    }
    return {
      view,
      companies: false,
      listId,
      listName: listId ? listName : (pipeline?.name ?? "Deals"),
      total: board?.rows.length ?? 0,
      page: 1,
      rows: [],
      lists,
      trash,
      empty: null,
      dealsOn,
      money,
      dealOptions,
      board,
      series,
    };
  }

  // ---- The tables.
  let rows: PeopleTableRow[];
  let total: number;
  if (companies) {
    const data = await listCompanies(db, organizationId, query, viewerId, roles);
    total = data.total;
    const deals = await dealsByRow(db, rowDealWhere, true, data.rows.map((c) => c.id), pipelines, now);
    const tasks = await taskSteps(db, organizationId, "company", data.rows.map((c) => c.id));
    rows = data.rows.map((c) => {
      const deal = rowDealView(deals.get(c.id));
      return {
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
            deal: deal.next,
            task: tasks.get(c.id) ?? null,
          },
          now,
        ),
        mergeWith: null,
        owner: ownerLabel(c, roles, options.names),
        deleted: Boolean(c.deletedAt),
        deal: deal.view,
      };
    });
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
    const deals = await dealsByRow(db, rowDealWhere, false, ids, pipelines, now);
    const tasks = await taskSteps(db, organizationId, "person", ids);
    rows = data.rows.map((p) => {
      const dup = dupes.get(p.id) ?? null;
      const type = p.relationship ? tones.get(p.relationship) : null;
      const deal = rowDealView(deals.get(p.id));
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
            deal: deal.next,
            task: tasks.get(p.id) ?? null,
          },
          now,
        ),
        mergeWith: dup?.otherId ?? null,
        owner: ownerLabel(p, roles, options.names),
        deleted: Boolean(p.deletedAt),
        deal: deal.view,
      };
    });
  }

  // "$X in open deals": the deals the filters allow, among everyone listed.
  let money: PeoplePageData["money"] = null;
  if (dealsOn && !query.trash) {
    const who: Prisma.CrmDealWhereInput = companies
      ? { company: companiesWhere(organizationId, { ...query, page: undefined }, viewerId, roles, now) }
      : { people: { some: { person: peopleWhere(organizationId, { ...query, page: undefined }, viewerId, roles, now) } } };
    const sum = await db.crmDeal.aggregate({ _sum: { amountCents: true }, where: { AND: [rowDealWhere, who] } });
    const cents = sum._sum.amountCents ?? 0;
    if (cents > 0) {
      money = {
        text: formatMoney(cents, (covered[0] ?? pipelines[0])?.currency ?? "USD"),
        label: dealsTotalLabel(dealF.show),
      };
    }
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

  return {
    view,
    companies,
    listId,
    listName: query.trash ? "In the trash" : listName,
    total,
    page: query.page ?? 1,
    rows,
    lists,
    trash,
    empty,
    dealsOn,
    money,
    dealOptions,
    board: null,
    series,
  };
}
