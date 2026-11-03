import type { DatabaseKind } from "@/generated/prisma/client";
import { CHOICE_COLORS, type Choice } from "@/lib/databases/fields";
import { crmRecordHref } from "@/lib/crm/href";
import { STATUS_LABELS } from "@/lib/crm/fields";
import type { ReportField } from "@/lib/reports/catalog";
import type { ReportRow } from "@/lib/reports/compute";
import { loadFields } from "@/server/databases/custom";
import type { TxClient } from "@/server/db/context";

/**
 * The CRM's databases in Reports (docs/features/crm.md: "Reports work on
 * day one"): People, Companies and each pipeline are offered like any
 * database, their built-in columns written as fields (Status, Owner,
 * Stage, Amount...) beside their custom ones, so every Reports widget
 * (Number, Over time, Breakdown, Pipeline, Top values, Goal...) reads them.
 * A pipeline's Stage is a choice field in stage order, its won and lost
 * stages counted as done.
 */

const STATUS_CHOICES: Choice[] = [
  { id: "ACTIVE", label: STATUS_LABELS.ACTIVE, color: "green" },
  { id: "INACTIVE", label: STATUS_LABELS.INACTIVE, color: "gray" },
  { id: "ALUMNI", label: STATUS_LABELS.ALUMNI, color: "brown" },
];

function day(d: Date | null | undefined): string | undefined {
  return d ? d.toISOString().slice(0, 10) : undefined;
}

export function isCrmDatabaseKind(kind: DatabaseKind): boolean {
  return kind === "CRM_PEOPLE" || kind === "CRM_COMPANIES" || kind === "CRM_PIPELINE";
}

export async function crmReportFields(
  db: TxClient,
  organizationId: string,
  def: { id: string; kind: DatabaseKind },
): Promise<ReportField[]> {
  const custom = (await loadFields(db, organizationId, def.id)).map((f) => ({
    id: f.id,
    name: f.name,
    type: f.type,
    ...(f.options.choices ? { choices: f.options.choices } : {}),
  }));
  if (def.kind === "CRM_PEOPLE") {
    const settings = await db.crmSettings.findUnique({ where: { organizationId }, select: { relationshipTypes: true } });
    const types = (Array.isArray(settings?.relationshipTypes) ? settings.relationshipTypes : []) as { id: string; label: string }[];
    return [
      { id: "status", name: "Status", type: "SELECT", choices: STATUS_CHOICES },
      {
        id: "relationship",
        name: "Relationship",
        type: "SELECT",
        choices: types.map((t, i) => ({ id: t.id, label: t.label, color: CHOICE_COLORS[(i + 1) % CHOICE_COLORS.length]! })),
      },
      { id: "owner", name: "Owner", type: "MEMBER" },
      { id: "company", name: "Company", type: "TEXT" },
      { id: "source", name: "Source", type: "TEXT" },
      { id: "lastContacted", name: "Last contacted", type: "DATE" },
      { id: "followUp", name: "Next follow-up", type: "DATE" },
      { id: "strength", name: "Relationship strength", type: "NUMBER" },
      ...custom,
    ];
  }
  if (def.kind === "CRM_COMPANIES") {
    return [
      { id: "status", name: "Status", type: "SELECT", choices: STATUS_CHOICES },
      { id: "owner", name: "Owner", type: "MEMBER" },
      { id: "industry", name: "Industry", type: "TEXT" },
      { id: "lastContacted", name: "Last contacted", type: "DATE" },
      { id: "strength", name: "Relationship strength", type: "NUMBER" },
      ...custom,
    ];
  }
  const pipeline = await db.crmPipeline.findFirst({
    where: { organizationId, databaseId: def.id },
    select: { hasAmount: true, stages: { orderBy: { sortOrder: "asc" }, select: { id: true, name: true, kind: true } } },
  });
  const stages = pipeline?.stages ?? [];
  return [
    {
      id: "stage",
      name: "Stage",
      type: "SELECT",
      choices: stages.map((s, i) => ({
        id: s.id,
        label: s.name,
        color: s.kind === "WON" ? "green" : s.kind === "LOST" ? "red" : CHOICE_COLORS[(i + 1) % CHOICE_COLORS.length]!,
      })),
      done: stages.filter((s) => s.kind !== "OPEN").map((s) => s.id),
      stages: stages.filter((s) => s.kind !== "LOST").map((s) => s.id),
    },
    ...(pipeline?.hasAmount ? [{ id: "amount", name: "Amount", type: "CURRENCY" as const }] : []),
    { id: "owner", name: "Owner", type: "MEMBER" },
    { id: "company", name: "Company", type: "TEXT" },
    { id: "expected", name: "Expected", type: "DATE" },
    { id: "closed", name: "Closed on", type: "DATE" },
    ...custom,
  ];
}

export async function crmReportRows(
  db: TxClient,
  organizationId: string,
  orgSlug: string,
  def: { id: string; kind: DatabaseKind },
  take: number,
): Promise<ReportRow[]> {
  const merge = (custom: unknown) => ((custom ?? {}) as Record<string, unknown>);
  if (def.kind === "CRM_PEOPLE") {
    const rows = await db.crmPerson.findMany({
      where: { organizationId, deletedAt: null },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take,
      include: { company: { select: { name: true } } },
    });
    return rows.map((p) => ({
      id: p.id,
      title: p.name,
      values: {
        ...merge(p.custom),
        status: p.status,
        ...(p.relationship ? { relationship: p.relationship } : {}),
        ...(p.ownerId ? { owner: p.ownerId } : {}),
        ...(p.company ? { company: p.company.name } : {}),
        ...(p.source ? { source: p.source } : {}),
        ...(p.lastContactedAt ? { lastContacted: day(p.lastContactedAt) } : {}),
        ...(p.nextFollowUpAt ? { followUp: day(p.nextFollowUpAt) } : {}),
        strength: p.strength,
      },
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      href: crmRecordHref(orgSlug, "person", p.id),
    }));
  }
  if (def.kind === "CRM_COMPANIES") {
    const rows = await db.crmCompany.findMany({
      where: { organizationId, deletedAt: null },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take,
    });
    return rows.map((c) => ({
      id: c.id,
      title: c.name,
      values: {
        ...merge(c.custom),
        status: c.status,
        ...(c.ownerId ? { owner: c.ownerId } : {}),
        ...(c.industry ? { industry: c.industry } : {}),
        ...(c.lastContactedAt ? { lastContacted: day(c.lastContactedAt) } : {}),
        strength: c.strength,
      },
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      href: crmRecordHref(orgSlug, "company", c.id),
    }));
  }
  const pipeline = await db.crmPipeline.findFirst({
    where: { organizationId, databaseId: def.id },
    select: { id: true },
  });
  if (!pipeline) return [];
  const rows = await db.crmDeal.findMany({
    where: { organizationId, pipelineId: pipeline.id, deletedAt: null },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take,
    include: { company: { select: { name: true } } },
  });
  return rows.map((d) => ({
    id: d.id,
    title: d.title,
    values: {
      ...merge(d.custom),
      stage: d.stageId,
      ...(d.amountCents !== null ? { amount: d.amountCents / 100 } : {}),
      ...(d.ownerId ? { owner: d.ownerId } : {}),
      ...(d.company ? { company: d.company.name } : {}),
      ...(d.expectedOn ? { expected: day(d.expectedOn) } : {}),
      ...(d.closedAt ? { closed: day(d.closedAt) } : {}),
    },
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
    href: crmRecordHref(orgSlug, "deal", d.id),
  }));
}
