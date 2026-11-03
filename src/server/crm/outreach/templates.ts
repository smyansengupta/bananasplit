import { renderMerge } from "@/lib/crm/outreach/merge";
import { EVERYDAY_STARTERS } from "@/lib/crm/outreach/starters";

import { CrmError, type CrmActor } from "../access";
import { contactable, mergeValuesFor } from "./send";

/**
 * Email templates with merge fields (docs/features/crm.md, module 5,
 * "Personal at scale"). Shared with the organization or kept to yourself;
 * anyone edits their own, owners and admins edit any (RLS). A preview
 * renders a template for real people before anything sends.
 */

export interface TemplateInput {
  name: string;
  subject: string;
  body: string;
  category?: string | null;
  shared?: boolean;
}

function check(input: TemplateInput) {
  const name = input.name.trim().slice(0, 120);
  if (!name) throw new CrmError("Give it a name.", ["name"]);
  const body = input.body.slice(0, 20_000);
  if (!body.trim()) throw new CrmError("Write the message.", ["body"]);
  const unknown = [...renderMerge(input.subject, {}).unknown, ...renderMerge(body, {}).unknown];
  if (unknown.length) throw new CrmError(`There's no field called {{${unknown[0]}}}.`, ["body"]);
  return {
    name,
    subject: input.subject.trim().slice(0, 300),
    body,
    category: input.category?.trim().slice(0, 40) || null,
    shared: input.shared !== false,
  };
}

export async function createTemplate(actor: CrmActor, input: TemplateInput): Promise<{ id: string }> {
  return actor.db.crmTemplate.create({
    data: { ...check(input), organizationId: actor.organizationId, createdById: actor.userId },
    select: { id: true },
  });
}

export async function updateTemplate(actor: CrmActor, id: string, input: TemplateInput): Promise<void> {
  const res = await actor.db.crmTemplate.updateMany({
    where: { id, organizationId: actor.organizationId },
    data: check(input),
  });
  if (res.count === 0) throw new CrmError("Only whoever made it, or an admin, can change it.");
}

export async function archiveTemplate(actor: CrmActor, id: string): Promise<void> {
  const res = await actor.db.crmTemplate.updateMany({
    where: { id, organizationId: actor.organizationId },
    data: { archivedAt: new Date() },
  });
  if (res.count === 0) throw new CrmError("Only whoever made it, or an admin, can archive it.");
}

export interface PreviewRow {
  personId: string;
  name: string;
  to: string | null;
  subject: string;
  body: string;
  missing: string[];
  blocked: string | null;
}

/** The message as each of these people would get it. */
export async function previewFor(
  actor: CrmActor,
  text: { subject: string; body: string },
  personIds: readonly string[],
): Promise<PreviewRow[]> {
  const { db, organizationId, userId } = actor;
  const ids = [...new Set(personIds)].slice(0, 50);
  const people = await db.crmPerson.findMany({
    where: { organizationId, id: { in: ids } },
    select: { id: true, name: true, primaryEmail: true, doNotContact: true, unsubscribedAt: true, consent: true, deletedAt: true },
  });
  const out: PreviewRow[] = [];
  for (const p of people) {
    const values = await mergeValuesFor(db, organizationId, p.id, userId);
    const s = renderMerge(text.subject, values);
    const b = renderMerge(text.body, values);
    const can = contactable(p);
    out.push({
      personId: p.id,
      name: p.name,
      to: p.primaryEmail,
      subject: s.text,
      body: b.text,
      missing: [...new Set([...s.missing, ...b.missing])],
      blocked: can.ok ? null : can.reason,
    });
  }
  return out.sort((a, b) => ids.indexOf(a.personId) - ids.indexOf(b.personId));
}

export async function ensureStarters(actor: CrmActor): Promise<void> {
  const any = await actor.db.crmTemplate.count({ where: { organizationId: actor.organizationId } });
  if (any > 0) return;
  for (const t of EVERYDAY_STARTERS) await createTemplate(actor, t);
}
