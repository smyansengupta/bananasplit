import { Prisma } from "@/generated/prisma/client";
import { normalizeEmail } from "@/lib/crm/dedupe";
import { applyMap, readDestination, type CrmDestination } from "@/lib/crm/outreach/form-map";
import { readRouting, routeOwner, type Routing } from "@/lib/crm/outreach/assign";
import { readQuestions } from "@/lib/forms/questions";
import { withSystemOrgTx, type TxClient } from "@/server/db/context";
import { notifyUser } from "@/server/notifications";

import { CrmError, requireManager, type CrmAccess, type CrmActor } from "../access";
import { logActivity } from "../activity";
import { companyByDomain } from "../companies";
import { createDeal } from "../deals";
import { emitCrmEvent } from "../events";
import { queueCrmRefreshFor } from "../refresh-queue";
import { createPerson, updatePerson } from "../people";

/**
 * Forms to the CRM and owner routing (docs/features/crm.md, module 4).
 * The mapping lives on Form.crmDestination (src/lib/crm/outreach/form-map.ts;
 * the record form in ../forms.ts is a different thing). After a public
 * response is saved, formToCrm finds the person by email (dedupe) or adds
 * them, fills only what was empty, puts the answers on their timeline,
 * optionally opens an item in a pipeline, and gives a new person an owner
 * by the organization's routing (round-robin or rules) with a notification
 * and a row in the new owner's queue and Inbox. It never fails the answer:
 * the caller catches.
 *
 * Routing is kept as a CrmView row (objectKind "routing"), like Phase 1's
 * import mappings, so it needed no table.
 */

export async function readOrgRouting(db: TxClient, organizationId: string): Promise<Routing> {
  const row = await db.crmView.findFirst({
    where: { organizationId, objectKind: "routing" },
    orderBy: { createdAt: "asc" },
    select: { filters: true },
  });
  return readRouting(row?.filters);
}

export async function saveOrgRouting(actor: CrmActor, access: CrmAccess, routing: Routing): Promise<void> {
  requireManager(access);
  const { db, organizationId, userId } = actor;
  const clean = readRouting(routing);
  const members = new Set(
    (await db.membership.findMany({ where: { organizationId }, select: { userId: true } })).map((m) => m.userId),
  );
  clean.pool = clean.pool.filter((id) => members.has(id));
  clean.rules = clean.rules.filter((r) => members.has(r.ownerId));
  if (clean.mode !== "off" && clean.pool.length === 0 && clean.rules.length === 0) {
    throw new CrmError("Pick who new people can go to.");
  }
  const existing = await db.crmView.findFirst({ where: { organizationId, objectKind: "routing" }, select: { id: true } });
  if (existing) {
    await db.crmView.update({ where: { id: existing.id }, data: { filters: clean as unknown as Prisma.InputJsonObject } });
  } else {
    await db.crmView.create({
      data: { organizationId, objectKind: "routing", name: "Routing", filters: clean as unknown as Prisma.InputJsonObject, shared: true, createdById: userId },
    });
  }
}

/** How many new people each member got lately (for round-robin). */
async function recentAssignments(db: TxClient, organizationId: string): Promise<Map<string, number>> {
  const rows = await db.crmPerson.groupBy({
    by: ["ownerId"],
    where: { organizationId, createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) }, ownerId: { not: null }, source: { in: ["form", "booking"] } },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.ownerId!, r._count._all]));
}

export interface IntakeResult {
  personId: string;
  created: boolean;
  dealId: string | null;
  ownerId: string | null;
}

/** One form response into the CRM, in the form's organization. */
export async function formToCrm(target: { organizationId: string; formId: string }, responseId: string): Promise<IntakeResult | null> {
  const orgId = target.organizationId;
  return withSystemOrgTx(orgId, async ({ db }) => {
    const crm = await db.crmSettings.findUnique({ where: { organizationId: orgId }, select: { setupDoneAt: true } });
    const addOns = await db.orgSettings.findUnique({ where: { organizationId: orgId }, select: { addOns: true } });
    if (!crm?.setupDoneAt || !addOns?.addOns.includes("crm")) return null;
    // Whoever answered is on a timeline now, not at the nightly run (any form, a CRM destination or not).
    await queueCrmRefreshFor(db, orgId, { kind: "response", id: responseId });
    const form = await db.form.findFirst({
      where: { id: target.formId, organizationId: orgId },
      select: { id: true, title: true, questions: true, crmDestination: true, createdById: true, anonymous: true },
    });
    const dest = readDestination(form?.crmDestination);
    if (!form || !dest || form.anonymous) return null;
    const response = await db.formResponse.findFirst({
      where: { id: responseId, organizationId: orgId, formId: form.id },
      select: { id: true, email: true, userId: true, record: { select: { values: true } } },
    });
    if (!response) return null;
    const maker = await db.membership.findFirst({ where: { organizationId: orgId, userId: form.createdById }, select: { role: true } });
    if (!maker) return null;
    // Records are made as the form's maker, like its uploads.
    const actor: CrmActor = { db, organizationId: orgId, userId: form.createdById, role: maker.role };
    return intake(actor, dest, form, { ...response, name: null }, (response.record?.values ?? {}) as Record<string, unknown>);
  });
}

async function intake(
  actor: CrmActor,
  dest: CrmDestination,
  form: { id: string; title: string; questions: unknown },
  response: { id: string; email: string | null; name: string | null; userId: string | null },
  values: Record<string, unknown>,
): Promise<IntakeResult | null> {
  const { db, organizationId } = actor;
  const mapped = applyMap(dest, readQuestions(form.questions), values);
  const email = normalizeEmail(mapped.person.email ?? response.email);
  const name = mapped.person.name ?? ([mapped.person.firstName, mapped.person.lastName].filter(Boolean).join(" ") || response.name);
  if (!email && !name) return null;
  const found = email
    ? await db.crmPersonEmail.findFirst({ where: { organizationId, email, person: { deletedAt: null } }, select: { personId: true } })
    : null;
  let personId: string;
  let created = false;
  let ownerId: string | null = null;
  if (found) {
    personId = found.personId;
    // Fill only what's empty: a form never overwrites what members wrote.
    const p = await db.crmPerson.findFirst({
      where: { id: personId, organizationId },
      select: { phone: true, title: true, companyId: true, location: true, linkedinUrl: true, website: true },
    });
    const fill: Record<string, string> = {};
    if (!p?.phone && mapped.person.phone) fill.phone = mapped.person.phone;
    if (!p?.title && mapped.person.title) fill.title = mapped.person.title;
    if (!p?.location && mapped.person.location) fill.location = mapped.person.location;
    if (!p?.linkedinUrl && mapped.person.linkedinUrl) fill.linkedinUrl = mapped.person.linkedinUrl;
    if (!p?.website && mapped.person.website) fill.website = mapped.person.website;
    if (!p?.companyId && mapped.person.company) (fill as Record<string, string>).companyName = mapped.person.company;
    if (Object.keys(fill).length) await updatePerson(actor, personId, fill, { trusted: true, source: "system" }).catch(() => undefined);
  } else {
    let routed: { ownerId: string; why: string } | null = null;
    if (dest.route) {
      const routing = await readOrgRouting(db, organizationId);
      const members = new Set((await db.membership.findMany({ where: { organizationId }, select: { userId: true } })).map((m) => m.userId));
      routed = routeOwner(
        routing,
        { ...mapped.person, source: "form", relationship: dest.relationship ?? null },
        members,
        await recentAssignments(db, organizationId),
      );
    }
    ownerId = routed?.ownerId ?? null;
    personId = (
      await createPerson(
        actor,
        {
          name,
          firstName: mapped.person.firstName,
          lastName: mapped.person.lastName,
          primaryEmail: email,
          phone: mapped.person.phone,
          title: mapped.person.title,
          companyName: mapped.person.company,
          location: mapped.person.location,
          linkedinUrl: mapped.person.linkedinUrl,
          website: mapped.person.website,
          relationship: dest.relationship ?? null,
          source: "form",
          sourceDetail: form.title.slice(0, 200),
          // Routed, or nobody yet (the queue shows them as new for everyone).
          ownerId,
        },
        { trusted: true, source: "system" },
      )
    ).id;
    created = true;
    if (routed) {
      const org = await db.organization.findUnique({ where: { id: organizationId }, select: { slug: true } });
      await notifyUser(db, organizationId, routed.ownerId, {
        type: "CRM_ASSIGNED",
        title: `${name ?? email} is yours: new from ${form.title}`.slice(0, 300),
        body: routed.why === "round-robin" ? "Given to you in turn." : `The rule ${routed.why}.`,
        linkUrl: org ? `/app/${org.slug}/crm/people/${personId}` : null,
        dedupeKey: `crm-route:${personId}`,
      });
    }
  }
  // The answers on their timeline (the same row the workspace mirror makes).
  await logActivity(db, {
    organizationId,
    kind: "FORM_RESPONSE",
    subject: `Answered ${form.title}`,
    body: mapped.note,
    targets: [{ kind: "person", id: personId }],
    sourceKind: "form-response",
    sourceId: response.id,
    meta: { formId: form.id },
  });
  let dealId: string | null = null;
  if (dest.object === "deal" && dest.pipelineId) {
    const company = mapped.person.company
      ? await db.crmCompany.findFirst({
          where: { organizationId, deletedAt: null, name: { equals: mapped.person.company, mode: "insensitive" } },
          select: { id: true },
        })
      : email
        ? await companyByDomain(db, organizationId, email.split("@")[1] ?? "").catch(() => null)
        : null;
    try {
      dealId = (
        await createDeal(
          actor,
          {
            pipelineId: dest.pipelineId,
            stageId: dest.stageId ?? undefined,
            title: mapped.itemTitle ?? `${name ?? email}: ${form.title}`.slice(0, 200),
            amount: mapped.amountCents ? mapped.amountCents / 100 : null,
            primaryPersonId: personId,
            companyId: company?.id ?? null,
            ownerId: ownerId ?? undefined,
            source: "form",
            nextStep: "Reach out",
          },
          { trusted: true, source: "system" },
        )
      ).id;
    } catch (error) {
      if (!(error instanceof CrmError)) throw error;
    }
  }
  await emitCrmEvent(db, organizationId, { type: "form.submitted", targetKind: "person", targetId: personId, sourceId: response.id, source: "system" });
  return { personId, created, dealId, ownerId };
}

/** Saves a form's CRM destination (the form's Settings). Owners and admins manage forms. */
export async function saveFormDestination(actor: CrmActor, formId: string, dest: CrmDestination | null): Promise<void> {
  const { db, organizationId } = actor;
  const form = await db.form.findFirst({ where: { id: formId, organizationId, deletedAt: null }, select: { id: true } });
  if (!form) throw new CrmError("That form isn't here any more.");
  const clean = dest ? readDestination(dest) : null;
  if (dest && !clean) throw new CrmError("Pick where responses go.");
  if (clean?.object === "deal") {
    const p = await db.crmPipeline.findFirst({
      where: { id: clean.pipelineId ?? "", organizationId, archivedAt: null },
      select: { id: true, stages: { select: { id: true } } },
    });
    if (!p) throw new CrmError("Pick a pipeline.");
    if (clean.stageId && !p.stages.some((s) => s.id === clean.stageId)) clean.stageId = null;
  }
  if (clean && !Object.values(clean.map).includes("email") && !Object.values(clean.map).includes("name")) {
    throw new CrmError("Match at least the name or the email question.");
  }
  await db.form.update({
    where: { id: form.id },
    data: { crmDestination: clean ? (clean as unknown as Prisma.InputJsonObject) : Prisma.DbNull },
  });
}
