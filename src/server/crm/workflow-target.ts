import { formatMoney } from "@/lib/crm/fields";
import { crmRecordHref } from "@/lib/crm/href";
import type { MatchRecord, RecordValues, WorkflowObject } from "@/lib/crm/workflows";
import type { Prisma } from "@/generated/prisma/client";
import type { TxClient } from "@/server/db/context";

/**
 * The record a workflow runs on, read once per run: its values as
 * conditions see them (built-in keys and custom.<fieldId>), what trigger
 * matching needs (pipeline, stage, form), and the bits the steps use (its
 * name, owner, company and people, for tasks, messages and links).
 */

export interface WorkflowTarget {
  kind: WorkflowObject;
  id: string;
  name: string;
  values: RecordValues;
  match: MatchRecord;
  ownerId: string | null;
  ownerRoleKey: string | null;
  companyId: string | null;
  /** People on it: the person itself, or an item's people (primary first). */
  personIds: string[];
  pipelineId: string | null;
  stageName: string | null;
  amountCents: number | null;
  /** For workflow text's merge fields: {{name}}, {{stage}}, {{company}}, {{amount}}, {{pipeline}} (WORKFLOW_MERGE_FIELDS). */
  merge: Record<string, string | number | null>;
}

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

function customValues(custom: unknown): RecordValues {
  const out: RecordValues = {};
  if (custom && typeof custom === "object" && !Array.isArray(custom)) {
    for (const [k, v] of Object.entries(custom as Record<string, unknown>)) out[`custom.${k}`] = v;
  }
  return out;
}

type PersonRow = Prisma.CrmPersonGetPayload<{ include: { company: { select: { name: true } } } }>;
type CompanyRow = Prisma.CrmCompanyGetPayload<object>;
type DealRow = Prisma.CrmDealGetPayload<{ include: { company: { select: { name: true } }; stage: { select: { name: true; kind: true } } } }>;

/** A person as conditions and score rules read it. */
export function personValues(p: PersonRow): RecordValues {
  return {
    ...customValues(p.custom),
    name: p.name,
    firstName: p.firstName,
    lastName: p.lastName,
    primaryEmail: p.primaryEmail,
    phone: p.phone,
    title: p.title,
    company: p.company?.name ?? null,
    companyId: p.companyId,
    relationship: p.relationship,
    status: p.status,
    owner: p.ownerId,
    source: p.source,
    location: p.location,
    nextFollowUpAt: day(p.nextFollowUpAt),
    lastContactedAt: day(p.lastContactedAt),
    keepInTouchDays: p.keepInTouchDays,
    doNotContact: p.doNotContact,
    unsubscribed: p.unsubscribedAt !== null,
    strength: p.strength,
    score: p.score,
    createdAt: day(p.createdAt),
  };
}

export function companyValues(c: CompanyRow): RecordValues {
  return {
    ...customValues(c.custom),
    name: c.name,
    domain: c.domain,
    website: c.website,
    industry: c.industry,
    size: c.size,
    status: c.status,
    owner: c.ownerId,
    nextFollowUpAt: day(c.nextFollowUpAt),
    lastContactedAt: day(c.lastContactedAt),
    strength: c.strength,
    score: c.score,
    createdAt: day(c.createdAt),
  };
}

/** An item as conditions read it (its person by name is added by loadTarget). */
export function dealValues(d: DealRow): RecordValues {
  return {
    ...customValues(d.custom),
    title: d.title,
    name: d.title,
    stage: d.stageId,
    stageKind: d.stage.kind,
    pipeline: d.pipelineId,
    amount: d.amountCents === null ? null : d.amountCents / 100,
    expectedOn: day(d.expectedOn),
    owner: d.ownerId,
    company: d.company?.name ?? null,
    companyId: d.companyId,
    nextStep: d.nextStep,
    nextStepAt: day(d.nextStepAt),
    forecastCategory: d.forecastCategory,
    closeReason: d.closeReason,
    source: d.source,
    score: d.score,
    closedAt: day(d.closedAt),
    createdAt: day(d.createdAt),
  };
}

export async function loadTarget(
  db: TxClient,
  organizationId: string,
  kind: WorkflowObject,
  id: string,
): Promise<WorkflowTarget | null> {
  if (kind === "person") {
    const p = await db.crmPerson.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: { company: { select: { name: true } } },
    });
    if (!p) return null;
    return {
      kind,
      id: p.id,
      name: p.name,
      values: personValues(p),
      match: {},
      ownerId: p.ownerId,
      ownerRoleKey: p.ownerRoleKey,
      companyId: p.companyId,
      personIds: [p.id],
      pipelineId: null,
      stageName: null,
      amountCents: null,
      merge: { name: p.name, title: p.title, company: p.company?.name ?? null },
    };
  }
  if (kind === "company") {
    const c = await db.crmCompany.findFirst({ where: { id, organizationId, deletedAt: null } });
    if (!c) return null;
    const people = await db.crmPerson.findMany({
      where: { organizationId, companyId: c.id, deletedAt: null },
      select: { id: true },
      orderBy: { strength: "desc" },
      take: 20,
    });
    return {
      kind,
      id: c.id,
      name: c.name,
      values: companyValues(c),
      match: {},
      ownerId: c.ownerId,
      ownerRoleKey: c.ownerRoleKey,
      companyId: c.id,
      personIds: people.map((x) => x.id),
      pipelineId: null,
      stageName: null,
      amountCents: null,
      merge: { name: c.name, company: c.name },
    };
  }
  const d = await db.crmDeal.findFirst({
    where: { id, organizationId, deletedAt: null },
    include: {
      company: { select: { name: true } },
      stage: { select: { name: true, kind: true } },
      pipeline: { select: { name: true } },
      people: { select: { personId: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!d) return null;
  const primary = d.primaryPersonId
    ? await db.crmPerson.findFirst({ where: { id: d.primaryPersonId, organizationId }, select: { name: true } })
    : null;
  const personIds = [
    ...(d.primaryPersonId ? [d.primaryPersonId] : []),
    ...d.people.map((p) => p.personId).filter((pid) => pid !== d.primaryPersonId),
  ];
  return {
    kind,
    id: d.id,
    name: d.title,
    values: { ...dealValues(d), person: primary?.name ?? null },
    match: { pipelineId: d.pipelineId, stageId: d.stageId, stageKind: d.stage.kind },
    ownerId: d.ownerId,
    ownerRoleKey: d.ownerRoleKey,
    companyId: d.companyId,
    personIds,
    pipelineId: d.pipelineId,
    stageName: d.stage.name,
    amountCents: d.amountCents,
    merge: {
      name: primary?.name ?? d.title,
      title: d.title,
      stage: d.stage.name,
      company: d.company?.name ?? null,
      amount: d.amountCents === null ? null : formatMoney(d.amountCents, d.currency),
      pipeline: d.pipeline.name,
    },
  };
}

/** The record's page, as a relative app path. */
export function targetPath(orgSlug: string, kind: WorkflowObject, id: string): string {
  return crmRecordHref(orgSlug, kind, id);
}
