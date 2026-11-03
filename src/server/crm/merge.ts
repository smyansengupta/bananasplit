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
 * calls, texts, job history, field history, and Relation links in every
 * database. Empty fields are filled from the duplicate; where both had a
 * value the kept one stays and the other is written to field history. The
 * duplicate goes to the trash, marked as merged, so it can be looked at.
 */

export interface MergeResult {
  keepId: string;
  dropId: string;
  conflicts: MergeConflict[];
  moved: Record<string, number>;
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
  moved.history = (
    await db.crmFieldHistory.updateMany({
      where: { organizationId, targetKind: "person", targetId: dropId },
      data: { targetId: keepId },
    })
  ).count;
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
  await logActivity(db, {
    organizationId,
    kind: "SYSTEM",
    subject: `Merged ${drop.name} into ${keep.name}`,
    targets: [{ kind: "person", id: keepId }],
    actorId: userId,
    createdById: userId,
    meta: { merged: dropId, moved },
  });
  await closeMergeSuggestions(db, organizationId, keepId, dropId, userId);
  return { keepId, dropId, conflicts: plan.conflicts, moved };
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
    throw new CrmError("Both are Finance sponsors. Merge the sponsors in Finance first.");
  }
  const plan = planMerge(
    { fields: pick(keep, COMPANY_MERGE_FIELDS), custom: (keep.custom ?? {}) as Record<string, unknown> },
    { fields: pick(drop, COMPANY_MERGE_FIELDS), custom: (drop.custom ?? {}) as Record<string, unknown> },
  );
  const moved: Record<string, number> = {};
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
  moved.history = (
    await db.crmFieldHistory.updateMany({
      where: { organizationId, targetKind: "company", targetId: dropId },
      data: { targetId: keepId },
    })
  ).count;
  moved.links = await repointRelations(db, organizationId, "company", dropId, keepId);
  // The sponsor link is unique: free it on the duplicate before the keeper takes it.
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
  await logActivity(db, {
    organizationId,
    kind: "SYSTEM",
    subject: `Merged ${drop.name} into ${keep.name}`,
    targets: [{ kind: "company", id: keepId }],
    actorId: userId,
    createdById: userId,
    meta: { merged: dropId, moved },
  });
  await closeMergeSuggestions(db, organizationId, keepId, dropId, userId);
  return { keepId, dropId, conflicts: plan.conflicts, moved };
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
