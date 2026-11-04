import type { CrmForecastCategory, CrmRecordStatus } from "@/generated/prisma/client";
import { readRelation, type FieldDef } from "@/lib/databases/fields";
import { resolveRelationLabels } from "@/server/databases/relations";
import { FORECAST_LABELS, STATUS_LABELS } from "@/lib/crm/fields";
import { dayValue, decodeOwner, encodeOwner, type EditField, type EditOption } from "@/lib/crm/record-form";
import type { TxClient } from "@/server/db/context";

import { CrmError, type CrmActor } from "./access";
import { updateCompany, type CompanyInput } from "./companies";
import { requiredKeys } from "./databases";
import { moveDeal, updateDeal, type DealInput } from "./deals";
import type { RoleOwner } from "./owners";
import { updatePerson, type PersonInput } from "./people";

/**
 * The record form: which fields a person, company or item shows, with their
 * values and choices, and the one save that takes the form's changes back
 * into updatePerson / updateCompany / updateDeal (or a stage move).
 */

export interface FormContext {
  members: EditOption[];
  roles: ReadonlyMap<string, RoleOwner>;
  relationshipTypes: EditOption[];
}

export async function formContext(
  db: TxClient,
  organizationId: string,
  roles: ReadonlyMap<string, RoleOwner>,
): Promise<FormContext> {
  const members = await db.membership.findMany({
    where: { organizationId },
    select: { userId: true, user: { select: { name: true } } },
    orderBy: { joinedAt: "asc" },
    take: 2000,
  });
  const settings = await db.crmSettings.findUnique({ where: { organizationId }, select: { relationshipTypes: true } });
  const types = (Array.isArray(settings?.relationshipTypes) ? settings.relationshipTypes : []) as {
    id: string;
    label: string;
  }[];
  return {
    members: members
      .map((m) => ({ value: m.userId, label: m.user.name ?? "Member" }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    roles,
    relationshipTypes: types.map((t) => ({ value: t.id, label: t.label })),
  };
}

function ownerOptions(ctx: FormContext): EditOption[] {
  return [
    ...ctx.members.map((m) => ({ value: `u:${m.value}`, label: m.label })),
    ...[...ctx.roles.values()].map((r) => ({
      value: `r:${r.key}`,
      label: `${r.title} (${r.holderName?.split(" ")[0] ?? "open"})`,
    })),
  ];
}

const STATUS_OPTIONS = Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }));

function customFields(
  fields: readonly FieldDef[],
  custom: unknown,
  required: readonly string[],
  ctx: FormContext,
): EditField[] {
  const values = (custom ?? {}) as Record<string, unknown>;
  return fields.map((f) => ({
    key: `custom.${f.id}`,
    label: f.name,
    kind: "CUSTOM" as const,
    value: values[f.id] ?? null,
    field: f,
    required: required.includes(f.id),
    ...(f.type === "MEMBER" ? { options: ctx.members } : {}),
  }));
}

/** Names for the links in Relation fields (carried as JSON in display). */
export async function withRelationLabels(
  db: TxClient,
  organizationId: string,
  fields: EditField[],
): Promise<EditField[]> {
  const rel = fields.filter((f) => f.kind === "CUSTOM" && f.field?.type === "RELATION");
  if (rel.length === 0) return fields;
  const refs = rel.flatMap((f) => readRelation(f.value));
  const labels = await resolveRelationLabels(db, organizationId, refs);
  const map = Object.fromEntries([...labels.entries()].map(([k, v]) => [k, v.label]));
  return fields.map((f) => (rel.includes(f) ? { ...f, display: JSON.stringify(map) } : f));
}

export function personForm(
  p: {
    name: string;
    firstName: string | null;
    lastName: string | null;
    primaryEmail: string | null;
    phone: string | null;
    title: string | null;
    companyId: string | null;
    company?: { name: string } | null;
    linkedinUrl: string | null;
    website: string | null;
    location: string | null;
    relationship: string | null;
    status: CrmRecordStatus;
    ownerId: string | null;
    ownerRoleKey: string | null;
    source: string | null;
    nextFollowUpAt: Date | null;
    keepInTouchDays: number | null;
    doNotContact: boolean;
    custom: unknown;
  },
  fields: readonly FieldDef[],
  ctx: FormContext,
  columns: unknown,
): EditField[] {
  const required = requiredKeys(columns);
  const req = (k: string) => required.includes(k);
  return [
    { key: "name", label: "Name", kind: "TEXT", value: p.name, required: true },
    { key: "primaryEmail", label: "Email", kind: "EMAIL", value: p.primaryEmail, required: req("primaryEmail") },
    { key: "phone", label: "Phone", kind: "PHONE", value: p.phone, required: req("phone") },
    { key: "title", label: "Title", kind: "TEXT", value: p.title, required: req("title") },
    { key: "company", label: "Company", kind: "COMPANY", value: p.companyId, display: p.company?.name ?? null, required: req("company") },
    { key: "relationship", label: "Relationship", kind: "SELECT", value: p.relationship, options: ctx.relationshipTypes, required: req("relationship") },
    { key: "status", label: "Status", kind: "SELECT", value: p.status, options: STATUS_OPTIONS },
    { key: "owner", label: "Owner", kind: "OWNER", value: encodeOwner(p.ownerId, p.ownerRoleKey), options: ownerOptions(ctx), required: req("owner") },
    { key: "nextFollowUpAt", label: "Next follow-up", kind: "DATE", value: dayValue(p.nextFollowUpAt) },
    { key: "keepInTouchDays", label: "Keep in touch every (days)", kind: "NUMBER", value: p.keepInTouchDays },
    { key: "firstName", label: "First name", kind: "TEXT", value: p.firstName, more: true },
    { key: "lastName", label: "Last name", kind: "TEXT", value: p.lastName, more: true },
    { key: "linkedinUrl", label: "LinkedIn", kind: "URL", value: p.linkedinUrl, more: true },
    { key: "website", label: "Website", kind: "URL", value: p.website, more: true },
    { key: "location", label: "Location", kind: "TEXT", value: p.location, more: true, required: req("location") },
    { key: "source", label: "Source", kind: "TEXT", value: p.source, more: true },
    { key: "doNotContact", label: "Do not contact", kind: "CHECKBOX", value: p.doNotContact, more: true },
    ...customFields(fields, p.custom, required, ctx),
  ];
}

export function companyForm(
  c: {
    name: string;
    domain: string | null;
    website: string | null;
    industry: string | null;
    size: string | null;
    phone: string | null;
    address: string | null;
    description: string | null;
    status: CrmRecordStatus;
    ownerId: string | null;
    ownerRoleKey: string | null;
    nextFollowUpAt: Date | null;
    custom: unknown;
  },
  fields: readonly FieldDef[],
  ctx: FormContext,
  columns: unknown,
): EditField[] {
  const required = requiredKeys(columns);
  const req = (k: string) => required.includes(k);
  return [
    { key: "name", label: "Name", kind: "TEXT", value: c.name, required: true },
    { key: "domain", label: "Domain", kind: "TEXT", value: c.domain, required: req("domain") },
    { key: "website", label: "Website", kind: "URL", value: c.website, required: req("website") },
    { key: "industry", label: "Industry", kind: "TEXT", value: c.industry, required: req("industry") },
    { key: "status", label: "Status", kind: "SELECT", value: c.status, options: STATUS_OPTIONS },
    { key: "owner", label: "Owner", kind: "OWNER", value: encodeOwner(c.ownerId, c.ownerRoleKey), options: ownerOptions(ctx), required: req("owner") },
    { key: "nextFollowUpAt", label: "Next follow-up", kind: "DATE", value: dayValue(c.nextFollowUpAt) },
    { key: "size", label: "Size", kind: "TEXT", value: c.size, more: true },
    { key: "phone", label: "Phone", kind: "PHONE", value: c.phone, more: true },
    { key: "address", label: "Address", kind: "TEXT", value: c.address, more: true },
    { key: "description", label: "About", kind: "LONG_TEXT", value: c.description, more: true },
    ...customFields(fields, c.custom, required, ctx),
  ];
}

export function dealForm(
  d: {
    title: string;
    stageId: string;
    amountCents: number | null;
    expectedOn: Date | null;
    companyId: string | null;
    company?: { name: string } | null;
    primaryPersonId: string | null;
    personName?: string | null;
    ownerId: string | null;
    ownerRoleKey: string | null;
    nextStep: string | null;
    nextStepAt: Date | null;
    forecastCategory: CrmForecastCategory;
    closeReason: string | null;
    source: string | null;
    custom: unknown;
  },
  pipeline: { hasAmount: boolean; stages: { id: string; name: string; requiredFields: string[] }[] },
  fields: readonly FieldDef[],
  ctx: FormContext,
): EditField[] {
  const stage = pipeline.stages.find((s) => s.id === d.stageId);
  const required = stage?.requiredFields ?? [];
  const req = (k: string) => required.includes(k);
  return [
    { key: "title", label: "Title", kind: "TEXT", value: d.title, required: true },
    {
      key: "stage",
      label: "Stage",
      kind: "STAGE",
      value: d.stageId,
      options: pipeline.stages.map((s) => ({ value: s.id, label: s.name })),
    },
    ...(pipeline.hasAmount
      ? [{ key: "amount", label: "Amount", kind: "CURRENCY" as const, value: d.amountCents === null ? null : d.amountCents / 100, required: req("amount") }]
      : []),
    { key: "nextStep", label: "Next step", kind: "TEXT", value: d.nextStep, required: req("nextStep") },
    { key: "nextStepAt", label: "Next step by", kind: "DATE", value: dayValue(d.nextStepAt), required: req("nextStepAt") },
    { key: "expectedOn", label: "Expected", kind: "DATE", value: dayValue(d.expectedOn), required: req("expectedOn") },
    { key: "company", label: "Company", kind: "COMPANY", value: d.companyId, display: d.company?.name ?? null, required: req("company") },
    { key: "person", label: "Person", kind: "PERSON", value: d.primaryPersonId, display: d.personName ?? null, required: req("person") },
    { key: "owner", label: "Owner", kind: "OWNER", value: encodeOwner(d.ownerId, d.ownerRoleKey), options: ownerOptions(ctx), required: req("owner") },
    {
      key: "forecastCategory",
      label: "Forecast",
      kind: "SELECT",
      value: d.forecastCategory,
      options: Object.entries(FORECAST_LABELS).map(([value, label]) => ({ value, label })),
      more: true,
    },
    { key: "closeReason", label: "Reason", kind: "LONG_TEXT", value: d.closeReason, more: true, required: req("closeReason") },
    { key: "source", label: "Source", kind: "TEXT", value: d.source, more: true },
    ...customFields(fields, d.custom, required, ctx),
  ];
}

const blank = (v: unknown) => (v === "" || v === undefined ? null : v);

/** The form's changes as updatePerson/updateCompany/updateDeal input. */
export function formPatchToInput(
  kind: "person" | "company" | "deal",
  patch: Record<string, unknown>,
): PersonInput | CompanyInput | DealInput {
  const out: Record<string, unknown> = {};
  const custom: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(patch)) {
    const value = blank(raw);
    if (key.startsWith("custom.")) {
      custom[key.slice(7)] = value;
      continue;
    }
    switch (key) {
      case "owner":
        Object.assign(out, decodeOwner(value));
        break;
      case "company":
        out.companyId = value;
        break;
      case "person":
        out.primaryPersonId = value;
        break;
      case "stage":
        out.stageId = value;
        break;
      case "keepInTouchDays":
        out.keepInTouchDays = value === null ? null : Number(value);
        break;
      case "doNotContact":
        out.doNotContact = value === true;
        break;
      default:
        out[key] = value;
    }
  }
  if (Object.keys(custom).length) out.custom = custom;
  if (kind === "deal" && "stageId" in out && !out.stageId) delete out.stageId;
  return out as PersonInput;
}

/** Saves a form's changes; a stage change is a move (with what the stage asks for). */
export async function saveForm(
  actor: CrmActor,
  kind: "person" | "company" | "deal",
  id: string,
  patch: Record<string, unknown>,
): Promise<{ changed: string[]; needs?: { keys: string[]; labels: string[] } }> {
  if (Object.keys(patch).length > 80) throw new CrmError("That's too many changes at once.");
  const input = formPatchToInput(kind, patch);
  if (kind === "person") return updatePerson(actor, id, input as PersonInput);
  if (kind === "company") return updateCompany(actor, id, input as CompanyInput);
  const { stageId, closeReason, ...rest } = input as DealInput;
  if (stageId) {
    const moved = await moveDeal(actor, id, { stageId, closeReason, fill: rest });
    if (moved.needs) return { changed: [], needs: moved.needs };
    return { changed: ["stageId"] };
  }
  return updateDeal(actor, id, { ...rest, ...(closeReason !== undefined ? { closeReason } : {}) });
}
