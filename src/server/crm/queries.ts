import type { CrmRecordStatus, Prisma } from "@/generated/prisma/client";
import { COLD_AFTER_DAYS } from "@/lib/crm/strength";
import type { TxClient } from "@/server/db/context";

import type { RoleOwner } from "./owners";
import { rolesHeldBy } from "./owners";
import { taskSteps } from "./task-steps";

/**
 * The CRM's lists, filtered, sorted and searched on the server (docs/
 * features/crm.md: "Server-side filters, cursor pagination"), under the
 * viewer's RLS. The URL is the state: ?q, ?status, ?rel, ?owner, ?due,
 * ?sort, ?trash, ?page.
 */

export const PAGE = 100;

export interface ListQuery {
  q?: string;
  /** ACTIVE (default), INACTIVE, ALUMNI or all. */
  status?: CrmRecordStatus | "all";
  relationship?: string;
  /** "me" (theirs or their role's), "none", or a member id. */
  owner?: string;
  /** due: follow-up today or earlier; cold: going cold; new: added this week. */
  due?: "due" | "cold" | "new";
  companyId?: string;
  /** Only these records (a hand-picked list, the ones that look like duplicates). */
  ids?: readonly string[];
  /** Only those with a deal like this (People's Pipeline, Stage, Deal type and Open/Won/Lost filters). */
  deals?: Prisma.CrmDealWhereInput;
  trash?: boolean;
  sort?: string;
  dir?: "asc" | "desc";
  page?: number;
}

export function parseListQuery(sp: Record<string, string | string[] | undefined>): ListQuery {
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const status = one("status");
  const due = one("due");
  const page = Number(one("page") ?? "1");
  return {
    q: one("q")?.trim().slice(0, 100) || undefined,
    status:
      status === "all" || status === "INACTIVE" || status === "ALUMNI" || status === "ACTIVE"
        ? (status as ListQuery["status"])
        : undefined,
    relationship: one("rel") || undefined,
    owner: one("owner") || undefined,
    due: due === "due" || due === "cold" || due === "new" ? due : undefined,
    trash: one("trash") === "1",
    sort: one("sort") || undefined,
    dir: one("dir") === "asc" ? "asc" : one("dir") === "desc" ? "desc" : undefined,
    page: Number.isInteger(page) && page > 0 ? Math.min(page, 1000) : 1,
  };
}

/**
 * Owned by: "none", "me", a member's id, or several ids joined with commas
 * (My team: the viewer and the people under them), each with the roles
 * they hold.
 */
export function ownerWhere(owner: string | undefined, viewerId: string, roles: ReadonlyMap<string, RoleOwner>) {
  if (!owner) return {};
  if (owner === "none") return { ownerId: null, ownerRoleKey: null };
  const ids = [...new Set(owner.split(",").map((x) => (x === "me" ? viewerId : x.trim())).filter(Boolean))];
  const held = ids.flatMap((id) => rolesHeldBy(id, roles));
  const ownerId = ids.length === 1 ? ids[0]! : { in: ids };
  return { OR: [{ ownerId }, ...(held.length ? [{ ownerRoleKey: { in: held } }] : [])] };
}

export interface PersonRow {
  id: string;
  name: string;
  title: string | null;
  primaryEmail: string | null;
  phone: string | null;
  companyId: string | null;
  companyName: string | null;
  relationship: string | null;
  status: CrmRecordStatus;
  ownerId: string | null;
  ownerRoleKey: string | null;
  lastContactedAt: Date | null;
  nextFollowUpAt: Date | null;
  keepInTouchDays: number | null;
  strength: number;
  createdAt: Date;
  deletedAt: Date | null;
  custom: Record<string, unknown>;
  userId: string | null;
}

const PERSON_SORTS: Record<string, (dir: "asc" | "desc") => Prisma.CrmPersonOrderByWithRelationInput[]> = {
  name: (dir) => [{ name: dir }],
  company: (dir) => [{ company: { name: dir } }],
  lastContacted: (dir) => [{ lastContactedAt: { sort: dir, nulls: "last" } }],
  followUp: (dir) => [{ nextFollowUpAt: { sort: dir, nulls: "last" } }],
  strength: (dir) => [{ strength: dir }],
  score: (dir) => [{ score: dir }],
  added: (dir) => [{ createdAt: dir }],
};

export const PERSON_SORT_LABELS: Record<string, string> = {
  name: "Name",
  company: "Company",
  lastContacted: "Last contacted",
  followUp: "Next follow-up",
  strength: "Relationship strength",
  score: "Score",
  added: "Date added",
};

export function peopleWhere(
  organizationId: string,
  query: ListQuery,
  viewerId: string,
  roles: ReadonlyMap<string, RoleOwner>,
  now: Date = new Date(),
): Prisma.CrmPersonWhereInput {
  const and: Prisma.CrmPersonWhereInput[] = [{ organizationId }];
  and.push(query.trash ? { deletedAt: { not: null } } : { deletedAt: null });
  if (!query.trash && query.status !== "all") and.push({ status: query.status ?? "ACTIVE" });
  if (query.relationship) and.push({ relationship: query.relationship });
  if (query.companyId) and.push({ companyId: query.companyId });
  if (query.ids) and.push({ id: { in: [...query.ids] } });
  if (query.owner) and.push(ownerWhere(query.owner, viewerId, roles));
  if (query.due === "due") and.push({ nextFollowUpAt: { lte: endOfToday(now) } });
  if (query.due === "cold") {
    and.push({
      lastContactedAt: { lt: new Date(now.getTime() - COLD_AFTER_DAYS * 86_400_000), not: null },
      doNotContact: false,
    });
  }
  if (query.due === "new") and.push({ createdAt: { gte: new Date(now.getTime() - 7 * 86_400_000) } });
  if (query.deals) and.push({ deals: { some: { deal: { AND: [{ deletedAt: null }, query.deals] } } } });
  if (query.q) {
    const q = query.q;
    and.push({
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { title: { contains: q, mode: "insensitive" } },
        { emails: { some: { email: { contains: q.toLowerCase() } } } },
        { phone: { contains: q } },
        { company: { name: { contains: q, mode: "insensitive" } } },
        { deals: { some: { deal: { deletedAt: null, title: { contains: q, mode: "insensitive" } } } } },
      ],
    });
  }
  return { AND: and };
}

function endOfToday(now: Date): Date {
  const d = new Date(now);
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

export async function listPeople(
  db: TxClient,
  organizationId: string,
  query: ListQuery,
  viewerId: string,
  roles: ReadonlyMap<string, RoleOwner>,
  take = PAGE,
): Promise<{ rows: PersonRow[]; total: number }> {
  const where = peopleWhere(organizationId, query, viewerId, roles);
  const dir = query.dir ?? (query.sort === "name" || !query.sort ? "asc" : "desc");
  const order = (PERSON_SORTS[query.sort ?? "name"] ?? PERSON_SORTS.name)(dir);
  const rows = await db.crmPerson.findMany({
    where,
    orderBy: [...order, { id: "asc" }],
    skip: ((query.page ?? 1) - 1) * take,
    take,
    select: {
      id: true,
      name: true,
      title: true,
      primaryEmail: true,
      phone: true,
      companyId: true,
      company: { select: { name: true } },
      relationship: true,
      status: true,
      ownerId: true,
      ownerRoleKey: true,
      lastContactedAt: true,
      nextFollowUpAt: true,
      keepInTouchDays: true,
      strength: true,
      createdAt: true,
      deletedAt: true,
      custom: true,
      userId: true,
    },
  });
  const total = await db.crmPerson.count({ where });
  return {
    rows: rows.map(({ company, custom, ...r }) => ({
      ...r,
      companyName: company?.name ?? null,
      custom: (custom ?? {}) as Record<string, unknown>,
    })),
    total,
  };
}

/** The status counts for the list's SegmentCount badges (everything else in the query applied). */
export async function peopleStatusCounts(
  db: TxClient,
  organizationId: string,
  query: ListQuery,
  viewerId: string,
  roles: ReadonlyMap<string, RoleOwner>,
): Promise<Record<CrmRecordStatus | "trash", number>> {
  const base = peopleWhere(organizationId, { ...query, status: "all", trash: false }, viewerId, roles);
  const grouped = await db.crmPerson.groupBy({ by: ["status"], where: base, _count: { _all: true } });
  const trash = await db.crmPerson.count({ where: { organizationId, deletedAt: { not: null } } });
  const out = { ACTIVE: 0, INACTIVE: 0, ALUMNI: 0, trash } as Record<CrmRecordStatus | "trash", number>;
  for (const g of grouped) out[g.status] = g._count._all;
  return out;
}

export interface CompanyRow {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  status: CrmRecordStatus;
  ownerId: string | null;
  ownerRoleKey: string | null;
  lastContactedAt: Date | null;
  nextFollowUpAt: Date | null;
  strength: number;
  people: number;
  openItems: number;
  createdAt: Date;
  deletedAt: Date | null;
  sponsorId: string | null;
  custom: Record<string, unknown>;
}

const COMPANY_SORTS: Record<string, (dir: "asc" | "desc") => Prisma.CrmCompanyOrderByWithRelationInput[]> = {
  name: (dir) => [{ name: dir }],
  lastContacted: (dir) => [{ lastContactedAt: { sort: dir, nulls: "last" } }],
  strength: (dir) => [{ strength: dir }],
  score: (dir) => [{ score: dir }],
  people: (dir) => [{ people: { _count: dir } }],
  added: (dir) => [{ createdAt: dir }],
};

export const COMPANY_SORT_LABELS: Record<string, string> = {
  name: "Name",
  lastContacted: "Last contacted",
  strength: "Relationship strength",
  score: "Score",
  people: "People",
  added: "Date added",
};

export function companiesWhere(
  organizationId: string,
  query: ListQuery,
  viewerId: string,
  roles: ReadonlyMap<string, RoleOwner>,
  now: Date = new Date(),
): Prisma.CrmCompanyWhereInput {
  const and: Prisma.CrmCompanyWhereInput[] = [{ organizationId }];
  and.push(query.trash ? { deletedAt: { not: null } } : { deletedAt: null });
  if (!query.trash && query.status !== "all") and.push({ status: query.status ?? "ACTIVE" });
  if (query.ids) and.push({ id: { in: [...query.ids] } });
  if (query.owner) and.push(ownerWhere(query.owner, viewerId, roles));
  if (query.due === "due") and.push({ nextFollowUpAt: { lte: endOfToday(now) } });
  if (query.due === "cold") {
    and.push({ lastContactedAt: { lt: new Date(now.getTime() - COLD_AFTER_DAYS * 86_400_000), not: null } });
  }
  if (query.due === "new") and.push({ createdAt: { gte: new Date(now.getTime() - 7 * 86_400_000) } });
  if (query.deals) and.push({ deals: { some: { AND: [{ deletedAt: null }, query.deals] } } });
  if (query.q) {
    and.push({
      OR: [
        { name: { contains: query.q, mode: "insensitive" } },
        { domain: { contains: query.q.toLowerCase() } },
        { industry: { contains: query.q, mode: "insensitive" } },
        { deals: { some: { deletedAt: null, title: { contains: query.q, mode: "insensitive" } } } },
      ],
    });
  }
  return { AND: and };
}

export async function listCompanies(
  db: TxClient,
  organizationId: string,
  query: ListQuery,
  viewerId: string,
  roles: ReadonlyMap<string, RoleOwner>,
  take = PAGE,
): Promise<{ rows: CompanyRow[]; total: number }> {
  const where = companiesWhere(organizationId, query, viewerId, roles);
  const dir = query.dir ?? (query.sort === "name" || !query.sort ? "asc" : "desc");
  const order = (COMPANY_SORTS[query.sort ?? "name"] ?? COMPANY_SORTS.name)(dir);
  const rows = await db.crmCompany.findMany({
    where,
    orderBy: [...order, { id: "asc" }],
    skip: ((query.page ?? 1) - 1) * take,
    take,
    select: {
      id: true,
      name: true,
      domain: true,
      industry: true,
      status: true,
      ownerId: true,
      ownerRoleKey: true,
      lastContactedAt: true,
      nextFollowUpAt: true,
      strength: true,
      createdAt: true,
      deletedAt: true,
      sponsorId: true,
      custom: true,
      _count: { select: { people: { where: { deletedAt: null } }, deals: { where: { deletedAt: null, closedAt: null } } } },
    },
  });
  const total = await db.crmCompany.count({ where });
  return {
    rows: rows.map(({ _count, custom, ...r }) => ({
      ...r,
      people: _count.people,
      openItems: _count.deals,
      custom: (custom ?? {}) as Record<string, unknown>,
    })),
    total,
  };
}

export async function companyStatusCounts(
  db: TxClient,
  organizationId: string,
  query: ListQuery,
  viewerId: string,
  roles: ReadonlyMap<string, RoleOwner>,
): Promise<Record<CrmRecordStatus | "trash", number>> {
  const base = companiesWhere(organizationId, { ...query, status: "all", trash: false }, viewerId, roles);
  const grouped = await db.crmCompany.groupBy({ by: ["status"], where: base, _count: { _all: true } });
  const trash = await db.crmCompany.count({ where: { organizationId, deletedAt: { not: null } } });
  const out = { ACTIVE: 0, INACTIVE: 0, ALUMNI: 0, trash } as Record<CrmRecordStatus | "trash", number>;
  for (const g of grouped) out[g.status] = g._count._all;
  return out;
}

export interface DealCard {
  id: string;
  title: string;
  stageId: string;
  amountCents: number | null;
  currency: string;
  expectedOn: Date | null;
  ownerId: string | null;
  ownerRoleKey: string | null;
  companyId: string | null;
  companyName: string | null;
  personName: string | null;
  nextStep: string | null;
  nextStepAt: Date | null;
  stageEnteredAt: Date;
  closedAt: Date | null;
  rank: number;
  sponsorshipId: string | null;
  createdAt: Date;
  custom: Record<string, unknown>;
}

export interface DealQuery {
  q?: string;
  owner?: string;
  /** stuck: past its stage's limit; nostep: open with no next step. */
  flag?: "stuck" | "nostep";
  /** Show closed items too (the board hides those closed over 30 days ago). */
  closed?: boolean;
  trash?: boolean;
  sort?: string;
  dir?: "asc" | "desc";
}

export function parseDealQuery(sp: Record<string, string | string[] | undefined>): DealQuery {
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const flag = one("flag");
  return {
    q: one("q")?.trim().slice(0, 100) || undefined,
    owner: one("owner") || undefined,
    flag: flag === "stuck" || flag === "nostep" ? flag : undefined,
    closed: one("closed") === "1",
    trash: one("trash") === "1",
    sort: one("sort") || undefined,
    dir: one("dir") === "asc" ? "asc" : one("dir") === "desc" ? "desc" : undefined,
  };
}

export const DEAL_SORT_LABELS: Record<string, string> = {
  board: "Board order",
  amount: "Amount",
  expected: "Expected",
  added: "Date added",
  title: "Title",
  score: "Score",
};

export async function listDeals(
  db: TxClient,
  organizationId: string,
  pipelineId: string,
  query: DealQuery,
  viewerId: string,
  roles: ReadonlyMap<string, RoleOwner>,
  stuckLimits: ReadonlyMap<string, number | null>,
  now: Date = new Date(),
): Promise<DealCard[]> {
  const and: Prisma.CrmDealWhereInput[] = [{ organizationId, pipelineId }];
  and.push(query.trash ? { deletedAt: { not: null } } : { deletedAt: null });
  if (!query.closed && !query.trash) {
    and.push({ OR: [{ closedAt: null }, { closedAt: { gte: new Date(now.getTime() - 30 * 86_400_000) } }] });
  }
  if (query.owner) and.push(ownerWhere(query.owner, viewerId, roles) as Prisma.CrmDealWhereInput);
  if (query.flag === "nostep") and.push({ closedAt: null, OR: [{ nextStep: null }, { nextStep: "" }] });
  if (query.q) {
    and.push({
      OR: [
        { title: { contains: query.q, mode: "insensitive" } },
        { company: { name: { contains: query.q, mode: "insensitive" } } },
        { nextStep: { contains: query.q, mode: "insensitive" } },
      ],
    });
  }
  const dir = query.dir ?? "desc";
  const orderBy: Prisma.CrmDealOrderByWithRelationInput[] =
    query.sort === "amount"
      ? [{ amountCents: { sort: dir, nulls: "last" } }]
      : query.sort === "expected"
        ? [{ expectedOn: { sort: query.dir ?? "asc", nulls: "last" } }]
        : query.sort === "added"
          ? [{ createdAt: dir }]
          : query.sort === "title"
            ? [{ title: query.dir ?? "asc" }]
            : query.sort === "score"
              ? [{ score: dir }]
              : [{ rank: "asc" }];
  const rows = await db.crmDeal.findMany({
    where: { AND: and },
    orderBy: [...orderBy, { id: "asc" }],
    take: 2000,
    select: {
      id: true,
      title: true,
      stageId: true,
      amountCents: true,
      currency: true,
      expectedOn: true,
      ownerId: true,
      ownerRoleKey: true,
      companyId: true,
      company: { select: { name: true } },
      nextStep: true,
      nextStepAt: true,
      stageEnteredAt: true,
      closedAt: true,
      rank: true,
      sponsorshipId: true,
      createdAt: true,
      custom: true,
      people: { take: 1, orderBy: { createdAt: "asc" }, select: { person: { select: { name: true } } } },
    },
  });
  const cards = rows.map(({ company, people, custom, ...r }) => ({
    ...r,
    companyName: company?.name ?? null,
    personName: people[0]?.person.name ?? null,
    custom: (custom ?? {}) as Record<string, unknown>,
  }));
  if (query.flag === "stuck") return cards.filter((c) => isStuck(c, stuckLimits.get(c.stageId) ?? null, now));
  return cards;
}

/** Past its stage's limit (open items only). */
export function isStuck(card: Pick<DealCard, "closedAt" | "stageEnteredAt">, limitDays: number | null, now: Date = new Date()): boolean {
  if (card.closedAt || !limitDays) return false;
  return now.getTime() - card.stageEnteredAt.getTime() > limitDays * 86_400_000;
}

/** Days in its current stage. */
export function daysInStage(card: Pick<DealCard, "stageEnteredAt">, now: Date = new Date()): number {
  return Math.floor((now.getTime() - card.stageEnteredAt.getTime()) / 86_400_000);
}

// ---- Today -----------------------------------------------------------------

export interface TodayItem {
  kind: "followup" | "cold" | "new" | "stuck" | "nostep";
  targetKind: "person" | "company" | "deal";
  id: string;
  title: string;
  sub: string | null;
  at: Date | null;
}

/**
 * The CRM's home (Phase 1's "Today"; Phase 2 deepens it into the full
 * follow-up queue): follow-ups due, people going cold, new people from
 * forms this week, and the viewer's items that are stuck or have no next
 * step. Mine first: owned by the viewer or their role; with nothing of
 * theirs, everyone's.
 */
export async function todayList(
  db: TxClient,
  organizationId: string,
  viewerId: string,
  roles: ReadonlyMap<string, RoleOwner>,
  options: { mine: boolean; team?: readonly string[] },
  now: Date = new Date(),
): Promise<Record<TodayItem["kind"], TodayItem[]>> {
  const mine = options.mine
    ? (ownerWhere(["me", ...(options.team ?? [])].join(","), viewerId, roles) as Prisma.CrmPersonWhereInput)
    : {};
  const followups = await db.crmPerson.findMany({
    where: { organizationId, deletedAt: null, status: "ACTIVE", nextFollowUpAt: { lte: endOfToday(now) }, ...mine },
    orderBy: { nextFollowUpAt: "asc" },
    take: 25,
    select: { id: true, name: true, title: true, nextFollowUpAt: true, company: { select: { name: true } } },
  });
  const companyFollowups = await db.crmCompany.findMany({
    where: {
      organizationId,
      deletedAt: null,
      status: "ACTIVE",
      nextFollowUpAt: { lte: endOfToday(now) },
      ...(mine as Prisma.CrmCompanyWhereInput),
    },
    orderBy: { nextFollowUpAt: "asc" },
    take: 10,
    select: { id: true, name: true, nextFollowUpAt: true, domain: true },
  });
  // Going cold: their cadence (or COLD_AFTER_DAYS) has lapsed since the last touch.
  const coldCandidates = await db.crmPerson.findMany({
    where: {
      organizationId,
      deletedAt: null,
      status: { in: ["ACTIVE", "ALUMNI"] },
      doNotContact: false,
      lastContactedAt: { not: null, lt: new Date(now.getTime() - 14 * 86_400_000) },
      ...mine,
    },
    orderBy: { strength: "desc" },
    take: 200,
    select: { id: true, name: true, title: true, lastContactedAt: true, keepInTouchDays: true, company: { select: { name: true } } },
  });
  const cold = coldCandidates
    .filter((p) => now.getTime() - p.lastContactedAt!.getTime() > (p.keepInTouchDays ?? COLD_AFTER_DAYS) * 86_400_000)
    .slice(0, 15);
  const fresh = await db.crmPerson.findMany({
    where: {
      organizationId,
      deletedAt: null,
      createdAt: { gte: new Date(now.getTime() - 7 * 86_400_000) },
      source: { in: ["form", "forms"] },
    },
    orderBy: { createdAt: "desc" },
    take: 15,
    select: { id: true, name: true, title: true, createdAt: true, sourceDetail: true },
  });
  const pipelines = await db.crmPipeline.findMany({
    where: { organizationId, archivedAt: null },
    select: { stages: { select: { id: true, stuckAfterDays: true } } },
  });
  const limits = new Map(pipelines.flatMap((p) => p.stages.map((s) => [s.id, s.stuckAfterDays] as const)));
  const open = await db.crmDeal.findMany({
    where: { organizationId, deletedAt: null, closedAt: null, ...(mine as Prisma.CrmDealWhereInput) },
    orderBy: { stageEnteredAt: "asc" },
    take: 300,
    select: {
      id: true,
      title: true,
      stageId: true,
      stageEnteredAt: true,
      closedAt: true,
      nextStep: true,
      stage: { select: { name: true } },
      pipeline: { select: { name: true } },
    },
  });
  const stuck = open.filter((d) => isStuck(d, limits.get(d.stageId) ?? null, now)).slice(0, 15);
  // An open task linked to a deal is its next step (src/lib/crm/task-steps.ts).
  const stepless = open.filter((d) => !d.nextStep?.trim());
  const tasked = await taskSteps(db, organizationId, "deal", stepless.map((d) => d.id));
  const nostep = stepless.filter((d) => !tasked.has(d.id)).slice(0, 15);
  return {
    followup: [
      ...followups.map((p) => ({
        kind: "followup" as const,
        targetKind: "person" as const,
        id: p.id,
        title: p.name,
        sub: [p.title, p.company?.name].filter(Boolean).join(", ") || null,
        at: p.nextFollowUpAt,
      })),
      ...companyFollowups.map((c) => ({
        kind: "followup" as const,
        targetKind: "company" as const,
        id: c.id,
        title: c.name,
        sub: c.domain,
        at: c.nextFollowUpAt,
      })),
    ],
    cold: cold.map((p) => ({
      kind: "cold" as const,
      targetKind: "person" as const,
      id: p.id,
      title: p.name,
      sub: [p.title, p.company?.name].filter(Boolean).join(", ") || null,
      at: p.lastContactedAt,
    })),
    new: fresh.map((p) => ({
      kind: "new" as const,
      targetKind: "person" as const,
      id: p.id,
      title: p.name,
      sub: p.sourceDetail ?? p.title,
      at: p.createdAt,
    })),
    stuck: stuck.map((d) => ({
      kind: "stuck" as const,
      targetKind: "deal" as const,
      id: d.id,
      title: d.title,
      sub: `${d.pipeline.name}, ${d.stage.name} for ${daysInStage(d, now)} days`,
      at: d.stageEnteredAt,
    })),
    nostep: nostep.map((d) => ({
      kind: "nostep" as const,
      targetKind: "deal" as const,
      id: d.id,
      title: d.title,
      sub: `${d.pipeline.name}, ${d.stage.name}`,
      at: null,
    })),
  };
}
