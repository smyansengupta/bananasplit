import type { Prisma } from "@/generated/prisma/client";
import type { TxClient } from "@/server/db/context";

/**
 * The CRM's records as the public API and the outgoing webhooks show them
 * (docs/features/crm.md module 11): plain JSON with ISO dates, amounts in
 * integer cents, custom fields by field id, and `trashed` instead of a
 * deleted row. One shape for both, so a Zapier step that reads a webhook
 * can write the same object back through the API.
 */

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export const PERSON_API_SELECT = {
  id: true,
  name: true,
  firstName: true,
  lastName: true,
  primaryEmail: true,
  emails: { select: { email: true }, orderBy: { createdAt: "asc" } },
  phone: true,
  title: true,
  companyId: true,
  linkedinUrl: true,
  website: true,
  location: true,
  relationship: true,
  status: true,
  ownerId: true,
  source: true,
  lastContactedAt: true,
  nextFollowUpAt: true,
  keepInTouchDays: true,
  doNotContact: true,
  unsubscribedAt: true,
  custom: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CrmPersonSelect;

export type PersonApiRow = Prisma.CrmPersonGetPayload<{ select: typeof PERSON_API_SELECT }>;

export function personJson(p: PersonApiRow) {
  return {
    id: p.id,
    object: "person" as const,
    name: p.name,
    firstName: p.firstName,
    lastName: p.lastName,
    email: p.primaryEmail,
    emails: p.emails.map((e) => e.email),
    phone: p.phone,
    title: p.title,
    companyId: p.companyId,
    linkedinUrl: p.linkedinUrl,
    website: p.website,
    location: p.location,
    relationship: p.relationship,
    status: p.status,
    ownerId: p.ownerId,
    source: p.source,
    lastContactedAt: iso(p.lastContactedAt),
    nextFollowUpAt: iso(p.nextFollowUpAt),
    keepInTouchDays: p.keepInTouchDays,
    doNotContact: p.doNotContact,
    unsubscribed: Boolean(p.unsubscribedAt),
    custom: (p.custom ?? {}) as Record<string, unknown>,
    trashed: Boolean(p.deletedAt),
    createdAt: iso(p.createdAt),
    updatedAt: iso(p.updatedAt),
  };
}

export const COMPANY_API_SELECT = {
  id: true,
  name: true,
  domain: true,
  website: true,
  industry: true,
  size: true,
  phone: true,
  address: true,
  description: true,
  status: true,
  ownerId: true,
  lastContactedAt: true,
  nextFollowUpAt: true,
  custom: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CrmCompanySelect;

export type CompanyApiRow = Prisma.CrmCompanyGetPayload<{ select: typeof COMPANY_API_SELECT }>;

export function companyJson(c: CompanyApiRow) {
  return {
    id: c.id,
    object: "company" as const,
    name: c.name,
    domain: c.domain,
    website: c.website,
    industry: c.industry,
    size: c.size,
    phone: c.phone,
    address: c.address,
    description: c.description,
    status: c.status,
    ownerId: c.ownerId,
    lastContactedAt: iso(c.lastContactedAt),
    nextFollowUpAt: iso(c.nextFollowUpAt),
    custom: (c.custom ?? {}) as Record<string, unknown>,
    trashed: Boolean(c.deletedAt),
    createdAt: iso(c.createdAt),
    updatedAt: iso(c.updatedAt),
  };
}

export const ITEM_API_SELECT = {
  id: true,
  title: true,
  pipelineId: true,
  stageId: true,
  stage: { select: { id: true, name: true, kind: true } },
  amountCents: true,
  currency: true,
  expectedOn: true,
  closedAt: true,
  closeReason: true,
  forecastCategory: true,
  ownerId: true,
  companyId: true,
  primaryPersonId: true,
  people: { select: { personId: true, role: true } },
  nextStep: true,
  nextStepAt: true,
  source: true,
  custom: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CrmDealSelect;

export type ItemApiRow = Prisma.CrmDealGetPayload<{ select: typeof ITEM_API_SELECT }>;

export function itemJson(d: ItemApiRow) {
  return {
    id: d.id,
    object: "item" as const,
    title: d.title,
    pipelineId: d.pipelineId,
    stageId: d.stageId,
    stage: { id: d.stage.id, name: d.stage.name, kind: d.stage.kind },
    amountCents: d.amountCents,
    currency: d.currency,
    expectedOn: iso(d.expectedOn),
    closedAt: iso(d.closedAt),
    closeReason: d.closeReason,
    forecastCategory: d.forecastCategory,
    ownerId: d.ownerId,
    companyId: d.companyId,
    primaryPersonId: d.primaryPersonId,
    people: d.people.map((p) => ({ personId: p.personId, role: p.role })),
    nextStep: d.nextStep,
    nextStepAt: iso(d.nextStepAt),
    source: d.source,
    custom: (d.custom ?? {}) as Record<string, unknown>,
    trashed: Boolean(d.deletedAt),
    createdAt: iso(d.createdAt),
    updatedAt: iso(d.updatedAt),
  };
}

export const ACTIVITY_API_SELECT = {
  id: true,
  kind: true,
  direction: true,
  subject: true,
  body: true,
  occurredAt: true,
  actorId: true,
  sourceKind: true,
  meta: true,
  targets: { select: { targetKind: true, targetId: true } },
  createdAt: true,
} satisfies Prisma.CrmActivitySelect;

export type ActivityApiRow = Prisma.CrmActivityGetPayload<{ select: typeof ACTIVITY_API_SELECT }>;

/** Meta keys safe to show outside (never blob keys or provider ids). */
const META_KEYS = ["outcome", "durationSec", "callId", "textId", "quoteId", "from", "to", "kind", "amount", "keyword"];

export function activityJson(a: ActivityApiRow) {
  const meta = (a.meta ?? {}) as Record<string, unknown>;
  return {
    id: a.id,
    object: "activity" as const,
    kind: a.kind,
    direction: a.direction,
    subject: a.subject,
    body: a.body,
    occurredAt: iso(a.occurredAt),
    actorId: a.actorId,
    source: a.sourceKind,
    detail: Object.fromEntries(META_KEYS.filter((k) => k in meta).map((k) => [k, meta[k]])),
    targets: a.targets.map((t) => ({ kind: t.targetKind, id: t.targetId })),
    createdAt: iso(a.createdAt),
  };
}

export const PIPELINE_API_SELECT = {
  id: true,
  name: true,
  itemNoun: true,
  itemNounPlural: true,
  hasAmount: true,
  currency: true,
  wonLabel: true,
  lostLabel: true,
  archivedAt: true,
  sortOrder: true,
  createdAt: true,
  stages: {
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true, kind: true, sortOrder: true, probability: true, stuckAfterDays: true },
  },
} satisfies Prisma.CrmPipelineSelect;

export type PipelineApiRow = Prisma.CrmPipelineGetPayload<{ select: typeof PIPELINE_API_SELECT }>;

export function pipelineJson(p: PipelineApiRow) {
  return {
    id: p.id,
    object: "pipeline" as const,
    name: p.name,
    itemNoun: p.itemNoun,
    itemNounPlural: p.itemNounPlural,
    hasAmount: p.hasAmount,
    currency: p.currency,
    wonLabel: p.wonLabel,
    lostLabel: p.lostLabel,
    archived: Boolean(p.archivedAt),
    stages: p.stages.map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      order: s.sortOrder,
      probability: s.probability,
      stuckAfterDays: s.stuckAfterDays,
    })),
    createdAt: iso(p.createdAt),
  };
}

/** One record as the API shows it, read in the caller's transaction (null when it isn't there). */
export async function loadJson(
  db: TxClient,
  organizationId: string,
  kind: "person" | "company" | "deal" | "activity",
  id: string,
) {
  switch (kind) {
    case "person": {
      const p = await db.crmPerson.findFirst({ where: { id, organizationId }, select: PERSON_API_SELECT });
      return p ? personJson(p) : null;
    }
    case "company": {
      const c = await db.crmCompany.findFirst({ where: { id, organizationId }, select: COMPANY_API_SELECT });
      return c ? companyJson(c) : null;
    }
    case "deal": {
      const d = await db.crmDeal.findFirst({ where: { id, organizationId }, select: ITEM_API_SELECT });
      return d ? itemJson(d) : null;
    }
    case "activity": {
      const a = await db.crmActivity.findFirst({
        where: { id, organizationId, deletedAt: null, privateToId: null },
        select: ACTIVITY_API_SELECT,
      });
      return a ? activityJson(a) : null;
    }
  }
}
