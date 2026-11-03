import { Prisma } from "@/generated/prisma/client";
import type { TxClient } from "@/server/db/context";

import { emitCrmEvent } from "./events";

/**
 * Field history (Salesforce's, docs/features/crm.md module 1): every change
 * to a person, company or pipeline item is a CrmFieldHistory row with who,
 * when, the old value and the new one. A bulk edit's rows share a batchId,
 * which is what Undo reverts; restoring a record to an earlier point reads
 * these rows backwards. Values are JSON: dates as ISO strings.
 */

export type HistoryTarget = "person" | "company" | "deal";

export type HistorySource = "user" | "ai" | "automation" | "import" | "merge" | "connector" | "system" | "finance";

export interface FieldChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

/** A value as history stores it. */
export function historyValue(v: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (v === undefined || v === null) return Prisma.DbNull;
  if (v instanceof Date) return v.toISOString();
  return v as Prisma.InputJsonValue;
}

/** The same value either way? (Dates by instant, arrays and objects by content.) */
export function sameValue(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => (v instanceof Date ? v.toISOString() : v === undefined || v === "" ? null : v);
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

/** The changes from `before` to `after` for the keys `after` names. */
export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): FieldChange[] {
  const out: FieldChange[] = [];
  for (const [field, newValue] of Object.entries(after)) {
    if (newValue === undefined) continue;
    const oldValue = before[field];
    if (!sameValue(oldValue, newValue)) out.push({ field, oldValue, newValue });
  }
  return out;
}

/** The custom-JSON changes, under custom.<fieldId>. */
export function diffCustom(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): FieldChange[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const out: FieldChange[] = [];
  for (const k of keys) {
    if (!sameValue(before[k], after[k])) {
      out.push({ field: `custom.${k}`, oldValue: before[k] ?? null, newValue: after[k] ?? null });
    }
  }
  return out;
}

export async function writeHistory(
  db: TxClient,
  input: {
    organizationId: string;
    targetKind: HistoryTarget;
    targetId: string;
    changes: readonly FieldChange[];
    userId: string | null;
    source?: HistorySource;
    batchId?: string | null;
    at?: Date;
  },
): Promise<void> {
  if (input.changes.length === 0) return;
  await db.crmFieldHistory.createMany({
    data: input.changes.map((c) => ({
      organizationId: input.organizationId,
      targetKind: input.targetKind,
      targetId: input.targetId,
      field: c.field,
      oldValue: historyValue(c.oldValue),
      newValue: historyValue(c.newValue),
      changedById: input.userId,
      source: input.source ?? "user",
      batchId: input.batchId ?? null,
      changedAt: input.at ?? new Date(),
    })),
  });  await emitCrmEvent(db, input.organizationId, {
    type: "record.changed",
    targetKind: input.targetKind,
    targetId: input.targetId,
    fields: input.changes.map((c) => c.field),
    userId: input.userId,
    source: input.source,
  });
}

/** A fresh batch id for one bulk edit. */
export function newBatchId(): string {
  const bytes = new Uint8Array(9);
  globalThis.crypto.getRandomValues(bytes);
  return `b_${Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("")}`;
}

export interface HistoryEntry {
  id: string;
  field: string;
  oldValue: unknown;
  newValue: unknown;
  changedById: string | null;
  source: string;
  batchId: string | null;
  changedAt: Date;
}

export async function historyOf(
  db: TxClient,
  organizationId: string,
  targetKind: HistoryTarget,
  targetId: string,
  take = 200,
): Promise<HistoryEntry[]> {
  // Records merged into this one bring their history along.
  const merged = await db.crmFieldHistory.findMany({
    where: { organizationId, targetKind, field: "mergedInto", newValue: { equals: targetId } },
    select: { targetId: true },
    take: 50,
  });
  const ids = [targetId, ...merged.map((m) => m.targetId)];
  return db.crmFieldHistory.findMany({
    where: { organizationId, targetKind, targetId: { in: ids } },
    orderBy: [{ changedAt: "desc" }, { id: "desc" }],
    take,
    select: {
      id: true,
      field: true,
      oldValue: true,
      newValue: true,
      changedById: true,
      source: true,
      batchId: true,
      changedAt: true,
    },
  });
}

/**
 * What each field was at `at`: for every field changed after it, the old
 * value of its first change after it. Fields untouched since keep their
 * current value (and aren't in the result).
 */
export function valuesAt(entries: readonly HistoryEntry[], at: Date): Map<string, unknown> {
  const after = entries
    .filter((e) => e.changedAt > at)
    .sort((a, b) => a.changedAt.getTime() - b.changedAt.getTime() || a.id.localeCompare(b.id));
  const out = new Map<string, unknown>();
  for (const e of after) {
    if (!out.has(e.field)) out.set(e.field, e.oldValue);
  }
  return out;
}
