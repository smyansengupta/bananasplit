/**
 * What merging two records keeps (docs/features/crm.md: "merges keep
 * history, sequences and automations"). Pure: the server applies the plan.
 *
 * The record you keep wins every field it has; an empty one is filled from
 * the duplicate; where both have a different value the kept one stays and
 * the other is listed as a conflict (shown before the merge, and written to
 * field history after it, so nothing is lost). Custom fields merge the
 * same way, key by key. Dates take the later "last contacted" and the
 * earlier "next follow-up"; strength and score take the higher.
 */

export type Scalar = string | number | boolean | null | undefined;

export interface MergeInput {
  /** Built-in fields the merge looks at, by key. */
  fields: Record<string, Scalar | Date>;
  custom: Record<string, unknown>;
}

export interface MergeConflict {
  key: string;
  kept: unknown;
  dropped: unknown;
}

export interface MergePlan {
  /** Built-in fields to write on the kept record. */
  set: Record<string, Scalar | Date>;
  /** The kept record's custom JSON after the merge. */
  custom: Record<string, unknown>;
  conflicts: MergeConflict[];
}

const isEmpty = (v: unknown) =>
  v === null ||
  v === undefined ||
  v === "" ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === "string" && v.trim() === "");

const same = (a: unknown, b: unknown) => {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (typeof a === "string" && typeof b === "string") return a.trim().toLowerCase() === b.trim().toLowerCase();
  return JSON.stringify(a) === JSON.stringify(b);
};

/** Keys where the later date wins, and where the earlier does. */
const LATEST = new Set(["lastContactedAt"]);
const EARLIEST = new Set(["nextFollowUpAt", "createdAt"]);
const HIGHEST = new Set(["strength", "score", "keepInTouchDays"]);
/** Flags that, once set on either, stay set (consent is never lost in a merge). */
const STICKY = new Set(["doNotContact", "unsubscribedAt"]);

export function planMerge(keep: MergeInput, drop: MergeInput): MergePlan {
  const set: Record<string, Scalar | Date> = {};
  const conflicts: MergeConflict[] = [];
  for (const [key, dropped] of Object.entries(drop.fields)) {
    const kept = keep.fields[key];
    if (isEmpty(dropped)) continue;
    if (isEmpty(kept)) {
      set[key] = dropped;
      continue;
    }
    if (same(kept, dropped)) continue;
    if (LATEST.has(key) && dropped instanceof Date && kept instanceof Date) {
      if (dropped > kept) set[key] = dropped;
      continue;
    }
    if (EARLIEST.has(key) && dropped instanceof Date && kept instanceof Date) {
      if (dropped < kept) set[key] = dropped;
      continue;
    }
    if (HIGHEST.has(key) && typeof dropped === "number" && typeof kept === "number") {
      if (dropped > kept) set[key] = dropped;
      continue;
    }
    if (STICKY.has(key)) {
      if (dropped === true || dropped instanceof Date) set[key] = kept === true || kept instanceof Date ? kept : dropped;
      continue;
    }
    conflicts.push({ key, kept, dropped });
  }
  const custom: Record<string, unknown> = { ...keep.custom };
  for (const [key, dropped] of Object.entries(drop.custom)) {
    const kept = keep.custom[key];
    if (isEmpty(dropped)) continue;
    if (isEmpty(kept)) {
      custom[key] = dropped;
      continue;
    }
    if (Array.isArray(kept) && Array.isArray(dropped)) {
      // Relations and multi-selects: both sets of links survive.
      const seen = new Set(kept.map((v) => JSON.stringify(v)));
      custom[key] = [...kept, ...dropped.filter((v) => !seen.has(JSON.stringify(v)))];
      continue;
    }
    if (!same(kept, dropped)) conflicts.push({ key: `custom.${key}`, kept, dropped });
  }
  return { set, custom, conflicts };
}

/**
 * Which of two records to keep when nobody says: the one with more filled
 * in, then the older one (its history is longer).
 */
export function pickKeeper<T extends { id: string; createdAt: Date; fields: Record<string, unknown> }>(
  a: T,
  b: T,
): [keep: T, drop: T] {
  const filled = (r: T) => Object.values(r.fields).filter((v) => !isEmpty(v)).length;
  const fa = filled(a);
  const fb = filled(b);
  if (fa !== fb) return fa > fb ? [a, b] : [b, a];
  return a.createdAt <= b.createdAt ? [a, b] : [b, a];
}
