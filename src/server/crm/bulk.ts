import { CrmError, requireCrm, type CrmActor } from "./access";
import { restoreCompanies, trashCompanies, updateCompany, type CompanyInput } from "./companies";
import { moveDeal, restoreDeals, trashDeals, updateDeal, type DealInput } from "./deals";
import { historyOf, newBatchId, valuesAt, type HistoryTarget } from "./history";
import { crmGivenInBulk } from "./inbox-notify";
import { restorePeople, trashPeople, updatePerson, type PersonInput } from "./people";


/**
 * Bulk edits with Undo, and restoring a record to an earlier point
 * (docs/features/crm.md: "Undo on every bulk edit. Restore any record to an
 * earlier point from its field history."). A bulk edit is one batchId in
 * field history; Undo puts back each field the batch changed, as a new
 * change, so it can itself be undone.
 */

export type BulkObject = HistoryTarget;

export type BulkPatch = PersonInput | CompanyInput | DealInput;

/** Most records one bulk action touches. */
export const MAX_BULK = 500;

function checkIds(ids: readonly string[]): string[] {
  const unique = [...new Set(ids)];
  if (unique.length === 0) throw new CrmError("Pick at least one.");
  if (unique.length > MAX_BULK) throw new CrmError(`Up to ${MAX_BULK} at a time.`);
  return unique;
}

/** Applies one patch to many records; returns the batch to undo it with. */
export async function bulkUpdate(
  actor: CrmActor,
  object: BulkObject,
  ids: readonly string[],
  patch: BulkPatch,
): Promise<{ batchId: string; changed: number }> {
  await requireCrm(actor);
  const list = checkIds(ids);
  const batchId = newBatchId();
  let changed = 0;
  for (const id of list) {
    const opts = { batchId, trusted: true };
    if (object === "person") {
      if ((await updatePerson(actor, id, patch as PersonInput, opts)).changed.length) changed++;
    } else if (object === "company") {
      if ((await updateCompany(actor, id, patch as CompanyInput, opts)).changed.length) changed++;
    } else {
      const p = patch as DealInput;
      if (p.stageId) {
        const r = await moveDeal(actor, id, { stageId: p.stageId, closeReason: p.closeReason }, opts);
        if (r.needs) throw new CrmError(`Some need ${r.needs.labels.join(", ")} before that stage.`);
      }
      const { stageId: _s, ...rest } = p;
      void _s;
      if ((await updateDeal(actor, id, rest, opts)).changed.length || p.stageId) changed++;
    }
  }
  // Given to someone else: one Inbox line for them, not one per record.
  const to = (patch as { ownerId?: string | null }).ownerId;
  if (to && changed > 0) {
    await crmGivenInBulk(actor.db, actor.organizationId, { to, byUserId: actor.userId, kind: object, count: changed, batchId });
  }
  return { batchId, changed };
}

export async function bulkTrash(
  actor: CrmActor,
  object: BulkObject,
  ids: readonly string[],
): Promise<{ batchId: string; count: number }> {
  const list = checkIds(ids);
  const batchId = newBatchId();
  const count =
    object === "person"
      ? await trashPeople(actor, list, batchId)
      : object === "company"
        ? await trashCompanies(actor, list, batchId)
        : await trashDeals(actor, list, batchId);
  return { batchId, count };
}

/** A history value back as what the update functions take. */
function patchFrom(object: BulkObject, values: Map<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const custom: Record<string, unknown> = {};
  for (const [field, value] of values) {
    if (field.startsWith("custom.")) {
      custom[field.slice(7)] = value;
      continue;
    }
    if (["created", "merged", "mergedInto", "deletedAt"].includes(field) || field.startsWith("kept.")) continue;
    if (object === "deal" && field === "amountCents") {
      patch.amount = typeof value === "number" ? value / 100 : null;
      continue;
    }
    if (object === "deal" && (field === "closedAt" || field === "stageEnteredAt")) continue;
    patch[field] = value;
  }
  if (Object.keys(custom).length > 0) patch.custom = custom;
  return patch;
}

async function applyPatch(
  actor: CrmActor,
  object: BulkObject,
  id: string,
  patch: Record<string, unknown>,
  batchId: string,
): Promise<void> {
  const opts = { batchId, trusted: true };
  if (object === "person") await updatePerson(actor, id, patch as PersonInput, opts);
  else if (object === "company") await updateCompany(actor, id, patch as CompanyInput, opts);
  else {
    const { stageId, ...rest } = patch as DealInput;
    if (stageId) {
      const r = await moveDeal(actor, id, { stageId }, opts);
      if (r.needs) throw new CrmError(`Fill in ${r.needs.labels.join(", ")} first.`);
    }
    await updateDeal(actor, id, rest, opts);
  }
}

/** Undoes one bulk edit (or bulk trash). Returns how many records came back. */
export async function undoBatch(actor: CrmActor, batchId: string): Promise<{ count: number; batchId: string }> {
  await requireCrm(actor);
  const { db, organizationId } = actor;
  const rows = await db.crmFieldHistory.findMany({
    where: { organizationId, batchId },
    orderBy: [{ changedAt: "asc" }, { id: "asc" }],
    select: { targetKind: true, targetId: true, field: true, oldValue: true, changedById: true },
  });
  if (rows.length === 0) throw new CrmError("There's nothing left to undo.");
  if (rows.some((r) => r.changedById && r.changedById !== actor.userId)) {
    throw new CrmError("Only the person who made that change can undo it.");
  }
  const byTarget = new Map<string, { kind: BulkObject; id: string; values: Map<string, unknown>; trashed: boolean }>();
  for (const r of rows) {
    const key = `${r.targetKind}:${r.targetId}`;
    let t = byTarget.get(key);
    if (!t) {
      t = { kind: r.targetKind as BulkObject, id: r.targetId, values: new Map(), trashed: false };
      byTarget.set(key, t);
    }
    if (r.field === "deletedAt") t.trashed = true;
    // The first change in the batch holds the value from before it.
    else if (!t.values.has(r.field)) t.values.set(r.field, r.oldValue);
  }
  const undo = newBatchId();
  for (const t of byTarget.values()) {
    if (t.trashed) {
      if (t.kind === "person") await restorePeople(actor, [t.id]);
      else if (t.kind === "company") await restoreCompanies(actor, [t.id]);
      else await restoreDeals(actor, [t.id]);
    }
    const patch = patchFrom(t.kind, t.values);
    if (Object.keys(patch).length > 0) await applyPatch(actor, t.kind, t.id, patch, undo);
  }
  return { count: byTarget.size, batchId: undo };
}

/** Puts a record's fields back to what they were at `at` (a new change, so it can be undone). */
export async function restoreToPoint(
  actor: CrmActor,
  object: BulkObject,
  id: string,
  at: Date,
): Promise<{ batchId: string; fields: number }> {
  await requireCrm(actor);
  const { db, organizationId } = actor;
  const entries = await historyOf(db, organizationId, object, id, 2000);
  const values = valuesAt(entries, at);
  const patch = patchFrom(object, values);
  const batchId = newBatchId();
  if (Object.keys(patch).length === 0) return { batchId, fields: 0 };
  await applyPatch(actor, object, id, patch, batchId);
  return { batchId, fields: Object.keys(patch).length };
}
