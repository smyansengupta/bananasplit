import type { Prisma } from "@/generated/prisma/client";
import { readRelation, type RelationKind } from "@/lib/databases/fields";
import { planMerge, type MergeConflict } from "@/lib/crm/merge";
import type { TxClient } from "@/server/db/context";

import { CrmError, requireCrm, type CrmActor } from "./access";
import { logActivity, moveActivityTargets } from "./activity";
import { writeHistory } from "./history";

/**
 * Merging two people or two companies (docs/features/crm.md, module 1:
 * "merges keep history, sequences and automations"). Everything that
 * pointed at the duplicate moves to the record you keep: addresses, items
 * and their roles, the timeline, sequence enrollments, campaign targets,
 * calls, texts, job history and Relation links in every database; its
 * field history stays its own and reads as part of the kept record's. Empty fields are filled from the duplicate; where both had a
 * value the kept one stays and the other is written to field history. The
 * duplicate goes to the trash, marked as merged, so it can be looked at.
 * Any member may merge two records they can both see (RLS finds nothing
 * else); undoMerge puts both back for MERGE_UNDO_DAYS. Enrollments in the
 * same plan twice keep the kept record's and stop the duplicate's.
 */

export interface MergeResult {
  keepId: string;
  dropId: string;
  conflicts: MergeConflict[];
  moved: Record<string, number>;
  /** The merge's timeline row: Undo (undoMerge) names it, for 7 days. */
  undoId: string;
}

/** How long a merge can be undone. */
export const MERGE_UNDO_DAYS = 7;
const UNDO_MS = MERGE_UNDO_DAYS * 86_400_000;

/**
 * What a merge changed, kept on its timeline row (meta.undo, ids and the
 * kept record's values before; never shown) so Undo puts both records back:
 * the duplicate out of the trash, its addresses, timeline, deals,
 * enrollments, campaign places, calls, texts and jobs back on it, and the
 * kept record's own values (and the fields picked on the Merge card) as they
 * were. Relation links in databases stay on the kept record.
 */
interface PersonUndo {
  kind: "person";
  keepBefore: Record<string, unknown>;
  dropBefore: { contactId: string | null; userId: string | null };
  emails: { id: string; isPrimary: boolean }[];
  keepEmails: { id: string; isPrimary: boolean }[];
  dealLinks: string[];
  dealLinksDropped: { dealId: string; role: string | null }[];
  primaryDeals: string[];
  targets: string[];
  targetsDropped: { activityId: string; occurredAt: string }[];
  enrollments: { id: string; status: string; stopReason: string | null; finishedAt: string | null }[];
  campaignTargets: string[];
  campaignTargetsDropped: { campaignId: string; assigneeId: string | null; status: string; contactedAt: string | null; repliedAt: string | null }[];
  calls: string[];
  texts: string[];
  jobs: { id: string; current: boolean }[];
}

interface CompanyUndo {
  kind: "company";
  keepBefore: Record<string, unknown>;
  dropBefore: { sponsorId: string | null; domain: string | null };
  people: string[];
  deals: string[];
  jobs: { id: string; companyName: string | null }[];
  quotes: string[];
  targets: string[];
  targetsDropped: { activityId: string; occurredAt: string }[];
}

/** JSON keeps dates as {"$date": iso}, so they come back as dates. */
function freeze(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).map(([k, v]) => [k, v instanceof Date ? { $date: v.toISOString() } : (v ?? null)]),
  );
}

function thaw(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).map(([k, v]) =>
      [k, v && typeof v === "object" && "$date" in (v as object) ? new Date(String((v as { $date: string }).$date)) : v],
    ),
  );
}

/** The timeline links on a record that a merge moves, and those it drops (already on the kept one). */
async function targetsOf(db: TxClient, organizationId: string, kind: "person" | "company", dropId: string, keepId: string) {
  const onDrop = await db.crmActivityTarget.findMany({
    where: { organizationId, targetKind: kind, targetId: dropId },
    select: { id: true, activityId: true, occurredAt: true },
  });
  const onKeep = new Set(
    (
      await db.crmActivityTarget.findMany({
        where: { organizationId, targetKind: kind, targetId: keepId, activityId: { in: onDrop.map((t) => t.activityId) } },
        select: { activityId: true },
      })
    ).map((t) => t.activityId),
  );
  return {
    targets: onDrop.filter((t) => !onKeep.has(t.activityId)).map((t) => t.id),
    targetsDropped: onDrop
      .filter((t) => onKeep.has(t.activityId))
      .map((t) => ({ activityId: t.activityId, occurredAt: t.occurredAt.toISOString() })),
  };
}

const PERSON_MERGE_FIELDS = [
  "firstName",
  "lastName",
  "primaryEmail",
  "phone",
  "title",
  "companyId",
  "linkedinUrl",
  "website",
  "location",
  "avatarUrl",
  "relationship",
  "ownerId",
  "ownerRoleKey",
  "source",
  "sourceDetail",
  "lastContactedAt",
  "nextFollowUpAt",
  "keepInTouchDays",
  "strength",
  "score",
  "unsubscribedAt",
  "doNotContact",
  "contactId",
  "userId",
] as const;

const COMPANY_MERGE_FIELDS = [
  "domain",
  "website",
  "industry",
  "size",
  "phone",
  "address",
  "description",
  "ownerId",
  "ownerRoleKey",
  "lastContactedAt",
  "nextFollowUpAt",
  "strength",
  "score",
  "sponsorId",
] as const;

function pick(row: Record<string, unknown>, keys: readonly string[]): Record<string, never> {
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = row[k];
  return out as Record<string, never>;
}

/** Rewrites Relation links to `fromId` so they point at `toId`, in every database and CRM record. */
export async function repointRelations(
  db: TxClient,
  organizationId: string,
  kind: RelationKind,
  fromId: string,
  toId: string,
): Promise<number> {
  const fields = await db.databaseField.findMany({
    where: { organizationId, type: "RELATION" },
    select: { id: true, databaseId: true, options: true, database: { select: { kind: true } } },
  });
  let count = 0;
  const swap = (value: unknown) => {
    const refs = readRelation(value);
    if (!refs.some((r) => r.kind === kind && r.id === fromId)) return null;
    const seen = new Set<string>();
    return refs
      .map((r) => (r.kind === kind && r.id === fromId ? { kind, id: toId } : r))
      .filter((r) => {
        const k = `${r.kind}:${r.id}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
  };
  for (const f of fields) {
    const target = (f.options as { target?: { kind?: string } } | null)?.target?.kind;
    if (target !== kind) continue;
    const needle = JSON.stringify({ [f.id]: [{ kind, id: fromId }] });
    if (f.database.kind === "CUSTOM") {
      const rows = await db.$queryRaw<{ id: string; values: Record<string, unknown> }[]>`
        SELECT "id", "values" FROM "DatabaseRecord"
         WHERE "organizationId" = ${organizationId} AND "databaseId" = ${f.databaseId}
           AND "values" @> ${needle}::jsonb`;
      for (const r of rows) {
        const next = swap(r.values[f.id]);
        if (!next) continue;
        await db.$executeRaw`
          UPDATE "DatabaseRecord" SET "values" = "values" || jsonb_build_object(${f.id}::text, ${JSON.stringify(next)}::jsonb)
           WHERE "id" = ${r.id} AND "organizationId" = ${organizationId}`;
        count++;
      }
      continue;
    }
    const table = f.database.kind;
    const rows =
      table === "CRM_PEOPLE"
        ? await db.$queryRaw<{ id: string; custom: Record<string, unknown> }[]>`
            SELECT "id", "custom" FROM "CrmPerson" WHERE "organizationId" = ${organizationId} AND "custom" @> ${needle}::jsonb`
        : table === "CRM_COMPANIES"
          ? await db.$queryRaw<{ id: string; custom: Record<string, unknown> }[]>`
              SELECT "id", "custom" FROM "CrmCompany" WHERE "organizationId" = ${organizationId} AND "custom" @> ${needle}::jsonb`
          : await db.$queryRaw<{ id: string; custom: Record<string, unknown> }[]>`
              SELECT "id", "custom" FROM "CrmDeal" WHERE "organizationId" = ${organizationId} AND "custom" @> ${needle}::jsonb`;
    for (const r of rows) {
      const next = swap(r.custom[f.id]);
      if (!next) continue;
      const custom = { ...r.custom, [f.id]: next } as Prisma.InputJsonObject;
      if (table === "CRM_PEOPLE") await db.crmPerson.update({ where: { id: r.id }, data: { custom } });
      else if (table === "CRM_COMPANIES") await db.crmCompany.update({ where: { id: r.id }, data: { custom } });
      else await db.crmDeal.update({ where: { id: r.id }, data: { custom } });
      count++;
    }
  }
  return count;
}

export async function mergePeople(
  actor: CrmActor,
  keepId: string,
  dropId: string,
  options: { trusted?: boolean } = {},
): Promise<MergeResult> {
  if (!options.trusted) await requireCrm(actor);
  if (keepId === dropId) throw new CrmError("Pick two different people.");
  const { db, organizationId, userId } = actor;
  const [keep, drop] = [
    await db.crmPerson.findFirst({ where: { id: keepId, organizationId, deletedAt: null } }),
    await db.crmPerson.findFirst({ where: { id: dropId, organizationId, deletedAt: null } }),
  ];
  if (!keep || !drop) throw new CrmError("One of them isn't in the CRM any more.");
  const plan = planMerge(
    { fields: pick(keep, PERSON_MERGE_FIELDS), custom: (keep.custom ?? {}) as Record<string, unknown> },
    { fields: pick(drop, PERSON_MERGE_FIELDS), custom: (drop.custom ?? {}) as Record<string, unknown> },
  );
  const moved: Record<string, number> = {};

  // What Undo needs, read before anything moves.
  const sharedDeals = await db.crmDealPerson.findMany({
    where: { organizationId, personId: dropId, deal: { people: { some: { personId: keepId } } } },
    select: { dealId: true, role: true },
  });
  const sharedCampaigns = await db.crmCampaignTarget.findMany({
    where: { organizationId, personId: dropId, campaign: { targets: { some: { personId: keepId } } } },
    select: { campaignId: true, assigneeId: true, status: true, contactedAt: true, repliedAt: true },
  });
  const dropEnrollments = await db.crmEnrollment.findMany({
    where: { organizationId, personId: dropId },
    select: { id: true, sequenceId: true, status: true, stopReason: true, finishedAt: true },
  });
  const undo: PersonUndo = {
    kind: "person",
    keepBefore: freeze({ ...pick(keep, PERSON_MERGE_FIELDS), custom: keep.custom ?? {} }),
    dropBefore: { contactId: drop.contactId, userId: drop.userId },
    emails: await db.crmPersonEmail.findMany({ where: { organizationId, personId: dropId }, select: { id: true, isPrimary: true } }),
    keepEmails: await db.crmPersonEmail.findMany({ where: { organizationId, personId: keepId }, select: { id: true, isPrimary: true } }),
    dealLinks: (
      await db.crmDealPerson.findMany({
        where: { organizationId, personId: dropId, dealId: { notIn: sharedDeals.map((d) => d.dealId) } },
        select: { id: true },
      })
    ).map((d) => d.id),
    dealLinksDropped: sharedDeals,
    primaryDeals: (await db.crmDeal.findMany({ where: { organizationId, primaryPersonId: dropId }, select: { id: true } })).map((d) => d.id),
    ...(await targetsOf(db, organizationId, "person", dropId, keepId)),
    enrollments: dropEnrollments.map((e) => ({
      id: e.id,
      status: e.status,
      stopReason: e.stopReason,
      finishedAt: e.finishedAt?.toISOString() ?? null,
    })),
    campaignTargets: (
      await db.crmCampaignTarget.findMany({
        where: { organizationId, personId: dropId, campaignId: { notIn: sharedCampaigns.map((c) => c.campaignId) } },
        select: { id: true },
      })
    ).map((t) => t.id),
    campaignTargetsDropped: sharedCampaigns.map((c) => ({
      ...c,
      contactedAt: c.contactedAt?.toISOString() ?? null,
      repliedAt: c.repliedAt?.toISOString() ?? null,
    })),
    calls: (await db.crmCall.findMany({ where: { organizationId, personId: dropId }, select: { id: true } })).map((c) => c.id),
    texts: (await db.crmTextMessage.findMany({ where: { organizationId, personId: dropId }, select: { id: true } })).map((t) => t.id),
    jobs: await db.crmJob.findMany({ where: { organizationId, personId: dropId }, select: { id: true, current: true } }),
  };

  // Their addresses first: the drop's become the keeper's other addresses.
  moved.emails = (
    await db.crmPersonEmail.updateMany({
      where: { organizationId, personId: dropId },
      data: { personId: keepId, isPrimary: false },
    })
  ).count;
  // Items: a deal both were on keeps one link.
  await db.crmDealPerson.deleteMany({
    where: {
      organizationId,
      personId: dropId,
      deal: { people: { some: { personId: keepId } } },
    },
  });
  moved.items = (
    await db.crmDealPerson.updateMany({ where: { organizationId, personId: dropId }, data: { personId: keepId } })
  ).count;
  await db.crmDeal.updateMany({
    where: { organizationId, primaryPersonId: dropId },
    data: { primaryPersonId: keepId },
  });
  moved.timeline = await moveActivityTargets(db, organizationId, "person", dropId, keepId);
  // In the same plan twice: the kept one's enrollment carries on, the
  // duplicate's stops (so nobody gets every step twice).
  const keepRunning = await db.crmEnrollment.findMany({
    where: { organizationId, personId: keepId, status: { in: ["ACTIVE", "PAUSED"] } },
    select: { sequenceId: true },
  });
  const twice = dropEnrollments
    .filter((e) => (e.status === "ACTIVE" || e.status === "PAUSED") && keepRunning.some((k) => k.sequenceId === e.sequenceId))
    .map((e) => e.id);
  if (twice.length) {
    await db.crmEnrollment.updateMany({
      where: { organizationId, id: { in: twice } },
      data: { status: "STOPPED", stopReason: "merged: already in this plan", finishedAt: new Date(), nextRunAt: null },
    });
    await db.crmEmailMessage.updateMany({
      where: { organizationId, enrollmentId: { in: twice }, status: { in: ["QUEUED", "SCHEDULED"] } },
      data: { status: "FAILED", error: "merged: already in this plan" },
    });
  }
  moved.enrollments = (
    await db.crmEnrollment.updateMany({ where: { organizationId, personId: dropId }, data: { personId: keepId } })
  ).count;
  await db.crmCampaignTarget.deleteMany({
    where: {
      organizationId,
      personId: dropId,
      campaign: { targets: { some: { personId: keepId } } },
    },
  });
  moved.campaigns = (
    await db.crmCampaignTarget.updateMany({ where: { organizationId, personId: dropId }, data: { personId: keepId } })
  ).count;
  await db.crmCall.updateMany({ where: { organizationId, personId: dropId }, data: { personId: keepId } });
  await db.crmTextMessage.updateMany({ where: { organizationId, personId: dropId }, data: { personId: keepId } });
  moved.jobs = (
    await db.crmJob.updateMany({
      where: { organizationId, personId: dropId },
      data: { personId: keepId, current: false },
    })
  ).count;
  // Field history is append-only: the duplicate keeps its own rows, and the
  // kept record's history reads them through its "mergedInto" row.
  moved.history = await db.crmFieldHistory.count({
    where: { organizationId, targetKind: "person", targetId: dropId },
  });
  moved.links = await repointRelations(db, organizationId, "person", dropId, keepId);

  // The keeper's own values, filled from the duplicate. Its primary
  // address stays; contact and member links come across when it had none.
  const set = { ...plan.set };
  delete set.primaryEmail;
  await db.crmPerson.update({
    where: { id: dropId },
    data: { deletedAt: new Date(), contactId: null, userId: null, updatedById: userId },
  });
  await db.crmPerson.update({
    where: { id: keepId },
    data: {
      ...(set as Prisma.CrmPersonUncheckedUpdateInput),
      custom: plan.custom as Prisma.InputJsonObject,
      updatedById: userId,
    },
  });
  if (!keep.primaryEmail && plan.set.primaryEmail) {
    await db.crmPerson.update({ where: { id: keepId }, data: { primaryEmail: String(plan.set.primaryEmail) } });
    await db.crmPersonEmail.updateMany({
      where: { organizationId, personId: keepId, email: String(plan.set.primaryEmail) },
      data: { isPrimary: true },
    });
  }
  await writeHistory(db, {
    organizationId,
    targetKind: "person",
    targetId: keepId,
    changes: [
      { field: "merged", oldValue: null, newValue: { id: dropId, name: drop.name } },
      ...Object.entries(set).map(([field, newValue]) => ({ field, oldValue: (keep as Record<string, unknown>)[field], newValue })),
      ...plan.conflicts.map((c) => ({ field: `kept.${c.key}`, oldValue: c.dropped, newValue: c.kept })),
    ],
    userId,
    source: "merge",
  });
  await writeHistory(db, {
    organizationId,
    targetKind: "person",
    targetId: dropId,
    changes: [{ field: "mergedInto", oldValue: null, newValue: keepId }],
    userId,
    source: "merge",
  });
  const undoId = await logActivity(db, {
    organizationId,
    kind: "SYSTEM",
    subject: `Merged ${drop.name} into ${keep.name}`,
    targets: [{ kind: "person", id: keepId }],
    actorId: userId,
    createdById: userId,
    meta: { merged: dropId, moved, undo } as unknown as Prisma.InputJsonObject,
  });
  await closeMergeSuggestions(db, organizationId, keepId, dropId, userId);
  return { keepId, dropId, conflicts: plan.conflicts, moved, undoId };
}

export async function mergeCompanies(
  actor: CrmActor,
  keepId: string,
  dropId: string,
  options: { trusted?: boolean } = {},
): Promise<MergeResult> {
  if (!options.trusted) await requireCrm(actor);
  if (keepId === dropId) throw new CrmError("Pick two different companies.");
  const { db, organizationId, userId } = actor;
  const keep = await db.crmCompany.findFirst({ where: { id: keepId, organizationId, deletedAt: null } });
  const drop = await db.crmCompany.findFirst({ where: { id: dropId, organizationId, deletedAt: null } });
  if (!keep || !drop) throw new CrmError("One of them isn't in the CRM any more.");
  if (keep.sponsorId && drop.sponsorId) {
    throw new CrmError("Both are Finance partners. Merge them under Finance's Deals first.");
  }
  const plan = planMerge(
    { fields: pick(keep, COMPANY_MERGE_FIELDS), custom: (keep.custom ?? {}) as Record<string, unknown> },
    { fields: pick(drop, COMPANY_MERGE_FIELDS), custom: (drop.custom ?? {}) as Record<string, unknown> },
  );
  const moved: Record<string, number> = {};
  const undo: CompanyUndo = {
    kind: "company",
    keepBefore: freeze({ ...pick(keep, COMPANY_MERGE_FIELDS), custom: keep.custom ?? {} }),
    dropBefore: { sponsorId: drop.sponsorId, domain: drop.domain },
    people: (await db.crmPerson.findMany({ where: { organizationId, companyId: dropId }, select: { id: true } })).map((p) => p.id),
    deals: (await db.crmDeal.findMany({ where: { organizationId, companyId: dropId }, select: { id: true } })).map((d) => d.id),
    jobs: await db.crmJob.findMany({ where: { organizationId, companyId: dropId }, select: { id: true, companyName: true } }),
    quotes: (await db.crmQuote.findMany({ where: { organizationId, companyId: dropId }, select: { id: true } })).map((q) => q.id),
    ...(await targetsOf(db, organizationId, "company", dropId, keepId)),
  };
  moved.people = (
    await db.crmPerson.updateMany({ where: { organizationId, companyId: dropId }, data: { companyId: keepId } })
  ).count;
  moved.items = (
    await db.crmDeal.updateMany({ where: { organizationId, companyId: dropId }, data: { companyId: keepId } })
  ).count;
  moved.jobs = (
    await db.crmJob.updateMany({
      where: { organizationId, companyId: dropId },
      data: { companyId: keepId, companyName: keep.name },
    })
  ).count;
  await db.crmQuote.updateMany({ where: { organizationId, companyId: dropId }, data: { companyId: keepId } });
  moved.timeline = await moveActivityTargets(db, organizationId, "company", dropId, keepId);
  moved.history = await db.crmFieldHistory.count({
    where: { organizationId, targetKind: "company", targetId: dropId },
  });
  moved.links = await repointRelations(db, organizationId, "company", dropId, keepId);
  // The Finance partner link is unique: free it on the duplicate before the keeper takes it.
  await db.crmCompany.update({
    where: { id: dropId },
    data: { deletedAt: new Date(), sponsorId: null, domain: null, updatedById: userId },
  });
  await db.crmCompany.update({
    where: { id: keepId },
    data: {
      ...(plan.set as Prisma.CrmCompanyUncheckedUpdateInput),
      custom: plan.custom as Prisma.InputJsonObject,
      updatedById: userId,
    },
  });
  await writeHistory(db, {
    organizationId,
    targetKind: "company",
    targetId: keepId,
    changes: [
      { field: "merged", oldValue: null, newValue: { id: dropId, name: drop.name } },
      ...plan.conflicts.map((c) => ({ field: `kept.${c.key}`, oldValue: c.dropped, newValue: c.kept })),
    ],
    userId,
    source: "merge",
  });
  await writeHistory(db, {
    organizationId,
    targetKind: "company",
    targetId: dropId,
    changes: [{ field: "mergedInto", oldValue: null, newValue: keepId }],
    userId,
    source: "merge",
  });
  const undoId = await logActivity(db, {
    organizationId,
    kind: "SYSTEM",
    subject: `Merged ${drop.name} into ${keep.name}`,
    targets: [{ kind: "company", id: keepId }],
    actorId: userId,
    createdById: userId,
    meta: { merged: dropId, moved, undo } as unknown as Prisma.InputJsonObject,
  });
  await closeMergeSuggestions(db, organizationId, keepId, dropId, userId);
  return { keepId, dropId, conflicts: plan.conflicts, moved, undoId };
}

/**
 * Undo for a merge (the toast's Undo, within MERGE_UNDO_DAYS): both records
 * as they were before it. Whoever merged them may, or an owner, admin or
 * CRM manager; both must still be records they can see.
 */
export async function undoMerge(actor: CrmActor, undoId: string): Promise<{ keepId: string; dropId: string }> {
  const access = await requireCrm(actor);
  const { db, organizationId, userId } = actor;
  const row = await db.crmActivity.findFirst({
    where: { id: undoId, organizationId, kind: "SYSTEM", deletedAt: null },
    select: { id: true, meta: true, createdById: true, createdAt: true, targets: { select: { targetKind: true, targetId: true } } },
  });
  const meta = (row?.meta ?? {}) as { merged?: string; undo?: PersonUndo | CompanyUndo; undoneAt?: string };
  if (!row || !meta.undo || !meta.merged || meta.undoneAt) throw new CrmError("That merge can't be undone any more.");
  if (row.createdAt.getTime() < Date.now() - UNDO_MS) {
    throw new CrmError(`A merge can be undone for ${MERGE_UNDO_DAYS} days. This one is older.`);
  }
  if (row.createdById !== userId && !access.admin) {
    throw new CrmError("Only whoever merged them, or an owner or admin, can undo it.");
  }
  const u = meta.undo;
  const dropId = meta.merged;
  const keepId = row.targets.find((t) => t.targetKind === u.kind)?.targetId;
  if (!keepId) throw new CrmError("That merge can't be undone any more.");
  const before = thaw(u.keepBefore);
  const custom = (before.custom ?? {}) as Prisma.InputJsonObject;
  delete before.custom;
  // Anyone who changed the kept record since the merge keeps their change:
  // its fields go back to before the merge only when nobody touched them.
  const touched =
    (await db.crmFieldHistory.count({
      where: {
        organizationId,
        targetKind: u.kind,
        targetId: keepId,
        changedAt: { gt: new Date(row.createdAt.getTime() + 5_000) },
        NOT: { source: "merge" },
      },
    })) > 0;

  if (u.kind === "person") {
    const [keep, drop] = [
      await db.crmPerson.findFirst({ where: { id: keepId, organizationId, deletedAt: null }, select: { id: true, name: true } }),
      await db.crmPerson.findFirst({ where: { id: dropId, organizationId }, select: { id: true, name: true } }),
    ];
    if (!keep || !drop) throw new CrmError("One of them isn't in the CRM any more.");
    await db.crmPerson.update({
      where: { id: dropId },
      data: { deletedAt: null, contactId: u.dropBefore.contactId, userId: u.dropBefore.userId, updatedById: userId },
    });
    // An address goes back only if it's still on the kept person (not moved or given to someone since).
    for (const e of u.emails) {
      await db.crmPersonEmail.updateMany({ where: { id: e.id, organizationId, personId: keepId }, data: { personId: dropId, isPrimary: e.isPrimary } });
    }
    for (const e of u.keepEmails) {
      await db.crmPersonEmail.updateMany({ where: { id: e.id, organizationId, personId: keepId }, data: { isPrimary: e.isPrimary } });
    }
    await db.crmDealPerson.updateMany({ where: { organizationId, id: { in: u.dealLinks } }, data: { personId: dropId } });
    if (u.dealLinksDropped.length) {
      await db.crmDealPerson.createMany({
        data: u.dealLinksDropped.map((d) => ({ organizationId, dealId: d.dealId, personId: dropId, role: d.role })),
        skipDuplicates: true,
      });
    }
    await db.crmDeal.updateMany({ where: { organizationId, id: { in: u.primaryDeals } }, data: { primaryPersonId: dropId } });
    await db.crmActivityTarget.updateMany({ where: { organizationId, id: { in: u.targets } }, data: { targetId: dropId } });
    if (u.targetsDropped.length) {
      await db.crmActivityTarget.createMany({
        data: u.targetsDropped.map((t) => ({
          organizationId,
          activityId: t.activityId,
          targetKind: "person",
          targetId: dropId,
          occurredAt: new Date(t.occurredAt),
        })),
        skipDuplicates: true,
      });
    }
    // Plans go back to the duplicate, but one that was running comes back
    // paused: whatever stopped it since (a reply, a booking) isn't undone by
    // Undo, and nothing sends again until someone resumes it.
    for (const e of u.enrollments) {
      await db.crmEnrollment.updateMany({
        where: { id: e.id, organizationId },
        data: {
          personId: dropId,
          ...(e.status === "ACTIVE"
            ? { status: "PAUSED" as const, stopReason: "paused when a merge was undone", nextRunAt: null, finishedAt: null }
            : { status: e.status as "STOPPED", stopReason: e.stopReason, finishedAt: e.finishedAt ? new Date(e.finishedAt) : null }),
        },
      });
    }
    await db.crmCampaignTarget.updateMany({ where: { organizationId, id: { in: u.campaignTargets } }, data: { personId: dropId } });
    if (u.campaignTargetsDropped.length) {
      await db.crmCampaignTarget.createMany({
        data: u.campaignTargetsDropped.map((c) => ({
          organizationId,
          campaignId: c.campaignId,
          personId: dropId,
          assigneeId: c.assigneeId,
          status: c.status as "TODO",
          contactedAt: c.contactedAt ? new Date(c.contactedAt) : null,
          repliedAt: c.repliedAt ? new Date(c.repliedAt) : null,
        })),
        skipDuplicates: true,
      });
    }
    await db.crmCall.updateMany({ where: { organizationId, id: { in: u.calls } }, data: { personId: dropId } });
    await db.crmTextMessage.updateMany({ where: { organizationId, id: { in: u.texts } }, data: { personId: dropId } });
    for (const j of u.jobs) {
      await db.crmJob.updateMany({ where: { id: j.id, organizationId }, data: { personId: dropId, current: j.current } });
    }
    await db.crmPerson.update({
      where: { id: keepId },
      data: touched ? { updatedById: userId } : { ...(before as Prisma.CrmPersonUncheckedUpdateInput), custom, updatedById: userId },
    });
    await writeHistory(db, {
      organizationId,
      targetKind: "person",
      targetId: keepId,
      changes: [{ field: "unmerged", oldValue: null, newValue: { id: dropId, name: drop.name } }],
      userId,
      source: "merge",
    });
  } else {
    const [keep, drop] = [
      await db.crmCompany.findFirst({ where: { id: keepId, organizationId, deletedAt: null }, select: { id: true } }),
      await db.crmCompany.findFirst({ where: { id: dropId, organizationId }, select: { id: true, name: true } }),
    ];
    if (!keep || !drop) throw new CrmError("One of them isn't in the CRM any more.");
    // The kept one gives the Finance link and domain back before the duplicate takes them.
    await db.crmCompany.update({
      where: { id: keepId },
      data: touched ? { updatedById: userId } : { ...(before as Prisma.CrmCompanyUncheckedUpdateInput), custom, updatedById: userId },
    });
    await db.crmCompany.update({
      where: { id: dropId },
      data: { deletedAt: null, sponsorId: u.dropBefore.sponsorId, domain: u.dropBefore.domain, updatedById: userId },
    });
    await db.crmPerson.updateMany({ where: { organizationId, id: { in: u.people } }, data: { companyId: dropId } });
    await db.crmDeal.updateMany({ where: { organizationId, id: { in: u.deals } }, data: { companyId: dropId } });
    for (const j of u.jobs) {
      await db.crmJob.updateMany({ where: { id: j.id, organizationId }, data: { companyId: dropId, companyName: j.companyName } });
    }
    await db.crmQuote.updateMany({ where: { organizationId, id: { in: u.quotes } }, data: { companyId: dropId } });
    await db.crmActivityTarget.updateMany({ where: { organizationId, id: { in: u.targets } }, data: { targetId: dropId } });
    if (u.targetsDropped.length) {
      await db.crmActivityTarget.createMany({
        data: u.targetsDropped.map((t) => ({
          organizationId,
          activityId: t.activityId,
          targetKind: "company",
          targetId: dropId,
          occurredAt: new Date(t.occurredAt),
        })),
        skipDuplicates: true,
      });
    }
    await writeHistory(db, {
      organizationId,
      targetKind: "company",
      targetId: keepId,
      changes: [{ field: "unmerged", oldValue: null, newValue: { id: dropId, name: drop.name } }],
      userId,
      source: "merge",
    });
  }
  const closed = await db.crmActivity.updateMany({
    where: { id: row.id, organizationId, deletedAt: null },
    data: {
      deletedAt: new Date(),
      meta: { merged: dropId, undoneAt: new Date().toISOString(), undoneById: userId } as Prisma.InputJsonObject,
    },
  });
  // Undone once only (the whole undo rolls back otherwise).
  if (closed.count === 0) throw new CrmError("That merge can't be undone any more.");
  return { keepId, dropId };
}

/**
 * Pending duplicate suggestions the merge settles: this pair is accepted,
 * any other pair with the duplicate in it has nothing left to merge.
 */
async function closeMergeSuggestions(
  db: TxClient,
  organizationId: string,
  keepId: string,
  dropId: string,
  userId: string,
): Promise<void> {
  const pending = await db.crmSuggestion.findMany({
    where: {
      organizationId,
      kind: "MERGE",
      status: "PENDING",
      payload: { path: ["ids"], array_contains: [dropId] },
    },
    select: { id: true, payload: true },
  });
  for (const s of pending) {
    const ids = (s.payload as { ids?: string[] } | null)?.ids ?? [];
    if (!ids.includes(dropId)) continue;
    await db.crmSuggestion.update({
      where: { id: s.id },
      data: {
        status: ids.includes(keepId) ? "ACCEPTED" : "EXPIRED",
        reviewedById: userId,
        reviewedAt: new Date(),
      },
    });
  }
}
