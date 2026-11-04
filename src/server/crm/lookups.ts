import type { Prisma } from "@/generated/prisma/client";
import { formatMoney } from "@/lib/crm/fields";
import type { TargetKind, TargetRef } from "@/lib/crm/suggestions";
import type { TxClient } from "@/server/db/context";

import { timeline, type TimelineEntry } from "./activity";
import { historyOf, type HistoryEntry } from "./history";

/**
 * The CRM's questions, answered under the reader's RLS: search, who hasn't
 * been contacted in N days, what changed since a date, items in a pipeline,
 * a pipeline's totals. One set of queries behind the Ask box and the MCP
 * CRM tools, so both see exactly what the member sees in the app.
 */

export interface Hit {
  kind: TargetKind;
  id: string;
  name: string;
  /** A second line: their title and company, an item's pipeline and stage. */
  sub: string | null;
  lastContactedAt: Date | null;
}

const MAX = 50;

/** People, companies and items whose names (and titles, companies) match the words. */
export async function searchCrm(
  db: TxClient,
  organizationId: string,
  q: string,
  kinds: readonly TargetKind[] = ["person", "company", "deal"],
  take = 20,
): Promise<Hit[]> {
  const words = q.trim().slice(0, 100);
  const n = Math.min(take, MAX);
  const out: Hit[] = [];
  if (kinds.includes("person")) {
    const where: Prisma.CrmPersonWhereInput = {
      organizationId,
      deletedAt: null,
      ...(words
        ? {
            OR: [
              { name: { contains: words, mode: "insensitive" } },
              { title: { contains: words, mode: "insensitive" } },
              { company: { name: { contains: words, mode: "insensitive" } } },
              { emails: { some: { email: { contains: words.toLowerCase() } } } },
            ],
          }
        : {}),
    };
    const rows = await db.crmPerson.findMany({
      where,
      orderBy: [{ lastContactedAt: { sort: "desc", nulls: "last" } }, { name: "asc" }],
      take: n,
      select: { id: true, name: true, title: true, lastContactedAt: true, company: { select: { name: true } } },
    });
    out.push(
      ...rows.map((p) => ({
        kind: "person" as const,
        id: p.id,
        name: p.name,
        sub: [p.title, p.company?.name].filter(Boolean).join(" at ") || null,
        lastContactedAt: p.lastContactedAt,
      })),
    );
  }
  if (kinds.includes("company")) {
    const rows = await db.crmCompany.findMany({
      where: {
        organizationId,
        deletedAt: null,
        ...(words
          ? {
              OR: [
                { name: { contains: words, mode: "insensitive" } },
                { domain: { contains: words.toLowerCase() } },
                { industry: { contains: words, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: [{ lastContactedAt: { sort: "desc", nulls: "last" } }, { name: "asc" }],
      take: n,
      select: { id: true, name: true, industry: true, domain: true, lastContactedAt: true },
    });
    out.push(
      ...rows.map((c) => ({
        kind: "company" as const,
        id: c.id,
        name: c.name,
        sub: [c.industry, c.domain].filter(Boolean).join(", ") || null,
        lastContactedAt: c.lastContactedAt,
      })),
    );
  }
  if (kinds.includes("deal")) {
    const rows = await db.crmDeal.findMany({
      where: {
        organizationId,
        deletedAt: null,
        ...(words
          ? {
              OR: [
                { title: { contains: words, mode: "insensitive" } },
                { company: { name: { contains: words, mode: "insensitive" } } },
              ],
            }
          : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: n,
      select: { id: true, title: true, pipeline: { select: { name: true } }, stage: { select: { name: true } } },
    });
    out.push(
      ...rows.map((d) => ({
        kind: "deal" as const,
        id: d.id,
        name: d.title,
        sub: `${d.pipeline.name}, ${d.stage.name}`,
        lastContactedAt: null,
      })),
    );
  }
  return out.slice(0, n * kinds.length);
}

/** The one record a name points at (exact first, then contains); null when none or unsure. */
export async function recordByName(
  db: TxClient,
  organizationId: string,
  name: string,
  kind?: TargetKind | null,
): Promise<{ target: TargetRef; name: string } | null> {
  const words = name.trim().slice(0, 200);
  if (!words) return null;
  const kinds: TargetKind[] = kind ? [kind] : ["person", "company", "deal"];
  for (const mode of ["exact", "contains"] as const) {
    const found: { target: TargetRef; name: string }[] = [];
    for (const k of kinds) {
      const match = mode === "exact" ? { equals: words, mode: "insensitive" as const } : { contains: words, mode: "insensitive" as const };
      if (k === "person") {
        const rows = await db.crmPerson.findMany({ where: { organizationId, deletedAt: null, name: match }, select: { id: true, name: true }, take: 2 });
        found.push(...rows.map((r) => ({ target: { kind: "person" as const, id: r.id }, name: r.name })));
      } else if (k === "company") {
        const rows = await db.crmCompany.findMany({ where: { organizationId, deletedAt: null, name: match }, select: { id: true, name: true }, take: 2 });
        found.push(...rows.map((r) => ({ target: { kind: "company" as const, id: r.id }, name: r.name })));
      } else {
        const rows = await db.crmDeal.findMany({ where: { organizationId, deletedAt: null, title: match }, select: { id: true, title: true }, take: 2 });
        found.push(...rows.map((r) => ({ target: { kind: "deal" as const, id: r.id }, name: r.title })));
      }
    }
    if (found.length === 1) return found[0]!;
    if (found.length > 1 && mode === "exact") return found[0]!;
  }
  return null;
}

/** People (or companies) nobody has been in touch with for `days` days, longest first. */
export async function notContacted(
  db: TxClient,
  organizationId: string,
  input: { days: number; kind?: "person" | "company"; ownerId?: string | null; take?: number; includeNever?: boolean },
): Promise<Hit[]> {
  const days = Math.max(1, Math.min(Math.round(input.days), 3650));
  const before = new Date(Date.now() - days * 86_400_000);
  const take = Math.min(input.take ?? 20, MAX);
  const contacted = input.includeNever
    ? { OR: [{ lastContactedAt: { lt: before } }, { lastContactedAt: null, createdAt: { lt: before } }] }
    : { lastContactedAt: { lt: before } };
  if (input.kind === "company") {
    const rows = await db.crmCompany.findMany({
      where: { organizationId, deletedAt: null, status: "ACTIVE", ...contacted, ...(input.ownerId ? { ownerId: input.ownerId } : {}) },
      orderBy: { lastContactedAt: { sort: "asc", nulls: "first" } },
      take,
      select: { id: true, name: true, industry: true, lastContactedAt: true },
    });
    return rows.map((c) => ({ kind: "company", id: c.id, name: c.name, sub: c.industry, lastContactedAt: c.lastContactedAt }));
  }
  const rows = await db.crmPerson.findMany({
    where: {
      organizationId,
      deletedAt: null,
      status: "ACTIVE",
      doNotContact: false,
      ...contacted,
      ...(input.ownerId ? { ownerId: input.ownerId } : {}),
    },
    orderBy: { lastContactedAt: { sort: "asc", nulls: "first" } },
    take,
    select: { id: true, name: true, title: true, lastContactedAt: true, company: { select: { name: true } } },
  });
  return rows.map((p) => ({
    kind: "person",
    id: p.id,
    name: p.name,
    sub: [p.title, p.company?.name].filter(Boolean).join(" at ") || null,
    lastContactedAt: p.lastContactedAt,
  }));
}

export interface Changes {
  history: HistoryEntry[];
  timeline: TimelineEntry[];
}

/** What changed with a record since `since`: its field history and its timeline. */
export async function changesSince(db: TxClient, organizationId: string, target: TargetRef, since: Date): Promise<Changes> {
  const history = (await historyOf(db, organizationId, target.kind, target.id, 300)).filter((h) => h.changedAt >= since);
  const entries = (await timeline(db, organizationId, target, { take: 100 })).filter((e) => e.occurredAt >= since);
  return { history: history.slice(0, 100), timeline: entries.slice(0, 50) };
}

export interface ItemRow {
  id: string;
  title: string;
  pipeline: string;
  stage: string;
  stageKind: string;
  amount: string | null;
  amountCents: number | null;
  expectedOn: Date | null;
  nextStep: string | null;
  company: string | null;
}

/** Items in a pipeline (by name), optionally one stage, open only. */
export async function findItems(
  db: TxClient,
  organizationId: string,
  input: { pipeline?: string | null; stage?: string | null; openOnly?: boolean; ownerId?: string | null; search?: string | null; take?: number },
): Promise<ItemRow[]> {
  const rows = await db.crmDeal.findMany({
    where: {
      organizationId,
      deletedAt: null,
      ...(input.pipeline ? { pipeline: { name: { contains: input.pipeline, mode: "insensitive" } } } : {}),
      ...(input.stage ? { stage: { name: { contains: input.stage, mode: "insensitive" } } } : {}),
      ...(input.openOnly ? { closedAt: null } : {}),
      ...(input.ownerId ? { ownerId: input.ownerId } : {}),
      ...(input.search ? { title: { contains: input.search, mode: "insensitive" } } : {}),
    },
    orderBy: [{ updatedAt: "desc" }],
    take: Math.min(input.take ?? 20, MAX),
    select: {
      id: true,
      title: true,
      amountCents: true,
      currency: true,
      expectedOn: true,
      nextStep: true,
      pipeline: { select: { name: true } },
      stage: { select: { name: true, kind: true } },
      company: { select: { name: true } },
    },
  });
  return rows.map((d) => ({
    id: d.id,
    title: d.title,
    pipeline: d.pipeline.name,
    stage: d.stage.name,
    stageKind: d.stage.kind,
    amount: d.amountCents !== null ? formatMoney(d.amountCents, d.currency) : null,
    amountCents: d.amountCents,
    expectedOn: d.expectedOn,
    nextStep: d.nextStep,
    company: d.company?.name ?? null,
  }));
}

export interface StageTotal {
  pipeline: string;
  stage: string;
  kind: string;
  count: number;
  amount: string | null;
}

/** Each pipeline's stages with their counts and amounts (open and closed). */
export async function pipelineTotals(db: TxClient, organizationId: string, pipeline?: string | null): Promise<StageTotal[]> {
  const pipelines = await db.crmPipeline.findMany({
    where: { organizationId, archivedAt: null, ...(pipeline ? { name: { contains: pipeline, mode: "insensitive" } } : {}) },
    orderBy: { sortOrder: "asc" },
    take: 10,
    select: { id: true, name: true, currency: true, hasAmount: true, stages: { orderBy: { sortOrder: "asc" }, select: { id: true, name: true, kind: true } } },
  });
  const out: StageTotal[] = [];
  for (const p of pipelines) {
    const groups = await db.crmDeal.groupBy({
      by: ["stageId"],
      where: { organizationId, pipelineId: p.id, deletedAt: null },
      _count: { _all: true },
      _sum: { amountCents: true },
    });
    for (const s of p.stages) {
      const g = groups.find((x) => x.stageId === s.id);
      out.push({
        pipeline: p.name,
        stage: s.name,
        kind: s.kind,
        count: g?._count._all ?? 0,
        amount: p.hasAmount ? formatMoney(g?._sum.amountCents ?? 0, p.currency) : null,
      });
    }
  }
  return out;
}

/** Counts across the CRM (as the reader sees it). */
export async function crmCounts(db: TxClient, organizationId: string) {
  const people = await db.crmPerson.count({ where: { organizationId, deletedAt: null } });
  const companies = await db.crmCompany.count({ where: { organizationId, deletedAt: null } });
  const open = await db.crmDeal.count({ where: { organizationId, deletedAt: null, closedAt: null } });
  const dueToday = await db.crmPerson.count({
    where: { organizationId, deletedAt: null, nextFollowUpAt: { lte: new Date() } },
  });
  return { people, companies, openItems: open, followUpsDue: dueToday };
}
