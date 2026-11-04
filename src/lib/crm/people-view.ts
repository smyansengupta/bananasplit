/**
 * The People tab's pure parts (docs/features/crm.md, "Redesign"): the
 * lists in Filters, the one next step a row shows (with its ambient
 * button and the reason beside it), the relationship pill's colour, what
 * a merge keeps from each side, and reading a pasted email signature.
 * Client-safe; the server decides the inputs.
 */

import type { TagColor } from "@/lib/tag-colors";

import { COLD_AFTER_DAYS } from "./strength";
import { taskStepText, type TaskStep } from "./task-steps";

const DAY = 86_400_000;

// ---------------------------------------------------------------- lists

/** A list in Filters that the CRM keeps by itself (`?list=`). */
export interface BuiltInList {
  id: "" | "due" | "cold" | "new" | "dupes";
  label: string;
}

export const PEOPLE_LISTS: readonly BuiltInList[] = [
  { id: "", label: "Everyone" },
  { id: "due", label: "Follow-ups due" },
  { id: "cold", label: "Going cold" },
  { id: "new", label: "New this week" },
  { id: "dupes", label: "Look like duplicates" },
];

export const COMPANY_LISTS: readonly BuiltInList[] = [
  { id: "", label: "All companies" },
  { id: "due", label: "Follow-ups due" },
  { id: "cold", label: "Gone quiet" },
  { id: "new", label: "New this week" },
];

/**
 * What `?list=` names: a built-in list, one of the organization's own
 * (a CrmView id), or nothing (everyone). An unknown built-in reads as a
 * saved list's id; the page checks it exists.
 */
export function readList(
  raw: string | null | undefined,
  companies: boolean,
): { kind: "all" } | { kind: "builtin"; id: Exclude<BuiltInList["id"], ""> } | { kind: "view"; id: string } {
  const v = (raw ?? "").trim();
  if (!v) return { kind: "all" };
  const lists = companies ? COMPANY_LISTS : PEOPLE_LISTS;
  const hit = lists.find((l) => l.id === v);
  if (hit && hit.id) return { kind: "builtin", id: hit.id };
  if (/^[A-Za-z0-9_-]{1,64}$/.test(v) && !["due", "cold", "new", "dupes"].includes(v)) {
    return { kind: "view", id: v };
  }
  return { kind: "all" };
}

// ---------------------------------------------------------------- relationship tags

/** A relationship type's stored colour (CrmSettings) as one of the tag tones; null is the neutral grey. */
export function relationshipTone(color: string | null | undefined): TagColor | null {
  switch ((color ?? "").toLowerCase()) {
    case "blue":
    case "navy":
      return "navy";
    case "purple":
    case "plum":
      return "plum";
    case "pink":
    case "red":
    case "burgundy":
      return "burgundy";
    case "orange":
    case "brown":
    case "rust":
      return "rust";
    case "yellow":
    case "ochre":
      return "ochre";
    case "green":
    case "forest":
      return "forest";
    case "teal":
      return "teal";
    default:
      return null;
  }
}

// ---------------------------------------------------------------- the next step on a row

/** The ambient button tones (src/components/ambient/ambient-button.tsx). */
export type AmbientTone = "solid" | "outline" | "spark";

export type RowActionKind = "merge" | "reply" | "followup" | "checkin" | "add";

export interface RowNext {
  /** The one ambient button, with its reason (shown beside it). */
  action: { kind: RowActionKind; label: string; tone: AmbientTone; reason: string } | null;
  /** The next step in words when there's nothing to press. */
  text: string | null;
}

export interface RowNextInput {
  nextFollowUpAt: Date | null;
  lastContactedAt: Date | null;
  doNotContact?: boolean;
  /** A pending duplicate: who, and the first reason the scan gave. */
  duplicate?: { name: string; reason: string | null } | null;
  /** They wrote and nobody has answered. */
  wroteAt?: Date | null;
  /** An open task linked to them: it is their next step (src/lib/crm/task-steps.ts). */
  task?: TaskStep | null;
}

function shortDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY);
}

/** "Same phone as Samuel Rivera", from the scan's "Same phone" (or "Same email (x)"). */
export function duplicateReason(reason: string | null, other: string): string {
  const r = (reason ?? "").replace(/\s*\(.*\)\s*$/, "").trim();
  if (/^same /i.test(r)) return `${r} as ${other}`;
  if (/^similar names?$/i.test(r)) return `Similar name to ${other}`;
  return `Looks like ${other}`;
}

/**
 * The one thing a People row offers, most pressing first: merge a likely
 * duplicate, answer someone who wrote, a follow-up that's due, someone
 * going cold, or a next step when someone you've talked to has none.
 * Otherwise the next step in words, and no button. An open linked task is
 * a next step (its due date is when): it shows in words, and nobody with
 * one is "going cold" or missing a step.
 */
export function rowNext(input: RowNextInput, now: Date = new Date()): RowNext {
  if (input.duplicate) {
    return {
      action: {
        kind: "merge",
        label: "Merge",
        tone: "solid",
        reason: duplicateReason(input.duplicate.reason, input.duplicate.name),
      },
      text: null,
    };
  }
  const later = input.nextFollowUpAt && input.nextFollowUpAt > endOfDay(now) ? input.nextFollowUpAt : null;
  if (input.doNotContact) {
    return { action: null, text: "Asked not to be contacted" };
  }
  if (input.wroteAt) {
    const n = daysBetween(input.wroteAt, now);
    return {
      action: {
        kind: "reply",
        label: "Reply",
        tone: "solid",
        reason: n <= 0 ? "Wrote today" : n === 1 ? "Wrote yesterday" : `Wrote ${n} days ago`,
      },
      text: null,
    };
  }
  if (input.nextFollowUpAt && !later) {
    const late = daysBetween(input.nextFollowUpAt, now);
    return {
      action: {
        kind: "followup",
        label: "Follow up",
        tone: "solid",
        reason: late <= 0 ? "Due today" : late === 1 ? "A day late" : `${late} days late`,
      },
      text: null,
    };
  }
  if (input.task) {
    const laterKey = later ? later.toISOString().slice(0, 10) : null;
    // A later follow-up that comes before the task is the nearer step.
    if (!laterKey || (input.task.dueKey !== null && input.task.dueKey <= laterKey)) {
      return { action: null, text: taskStepText(input.task, now.toISOString().slice(0, 10)) };
    }
  }
  const quiet = input.lastContactedAt ? daysBetween(input.lastContactedAt, now) : null;
  if (!input.task && !later && quiet !== null && quiet >= COLD_AFTER_DAYS) {
    return {
      action: { kind: "checkin", label: "Check in", tone: "spark", reason: `${quiet} days quiet` },
      text: null,
    };
  }
  if (later) return { action: null, text: `Follow up, ${shortDate(later)}` };
  // Nobody has talked to them yet: nothing in progress to keep going.
  if (!input.lastContactedAt) return { action: null, text: "None yet" };
  return {
    action: { kind: "add", label: "Add a next step", tone: "outline", reason: "No next step" },
    text: null,
  };
}

function endOfDay(now: Date): Date {
  const d = new Date(now);
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

/** "Today", "Oct 12": when someone was last talked to, for the table. */
export function lastTalked(at: Date | null, now: Date = new Date()): string {
  if (!at) return "Never";
  const n = daysBetween(at, now);
  if (n <= 0) return "Today";
  if (n === 1) return "Yesterday";
  return at.getUTCFullYear() === now.getUTCFullYear()
    ? shortDate(at)
    : at.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

/** Strength 0 to 100 as the table's four bars. */
export function strengthBars(strength: number): number {
  if (strength <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil(strength / 25)));
}

// ---------------------------------------------------------------- merging two

export const MERGE_FIELDS = ["name", "primaryEmail", "phone", "companyId", "ownerId"] as const;
export type MergeField = (typeof MERGE_FIELDS)[number];
export type MergeSide = "a" | "b";
export type MergePicks = Record<MergeField, MergeSide>;

/**
 * What a merge does with the picks in the Merge card: the record whose
 * name you keep is the one kept (the other merges into it); every other
 * field picked from the other side is written over the kept one after.
 */
export function mergeWith(
  a: Record<MergeField, string | null>,
  b: Record<MergeField, string | null>,
  picks: MergePicks,
): { keep: MergeSide; patch: Partial<Record<MergeField, string | null>> } {
  const keep = picks.name;
  const other = keep === "a" ? b : a;
  const kept = keep === "a" ? a : b;
  const patch: Partial<Record<MergeField, string | null>> = {};
  for (const f of MERGE_FIELDS) {
    if (f === "name" || picks[f] === keep) continue;
    if ((other[f] ?? null) !== (kept[f] ?? null)) patch[f] = other[f] ?? null;
  }
  return { keep, patch };
}

/** The picks a merge starts with: each field from whichever side has it, the fuller record first. */
export function defaultPicks(
  a: Record<MergeField, string | null>,
  b: Record<MergeField, string | null>,
): MergePicks {
  const filled = (r: Record<MergeField, string | null>) => MERGE_FIELDS.filter((f) => r[f]).length;
  const base: MergeSide = filled(b) > filled(a) ? "b" : "a";
  const picks = {} as MergePicks;
  for (const f of MERGE_FIELDS) {
    const mine = base === "a" ? a[f] : b[f];
    picks[f] = mine ? base : base === "a" ? (b[f] ? "b" : "a") : a[f] ? "a" : "b";
  }
  return picks;
}

// ---------------------------------------------------------------- a pasted signature

export interface ContactFill {
  name: string | null;
  title: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
}

const SIGN_OFF = /^(best|thanks|thank you|regards|kind regards|warm regards|cheers|sincerely|all the best|sent from)\b|^(?:--|\u2014)/i;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
const PHONE = /\+?\(?\d[\d\s().-]{6,}\d/;
const URL_RE = /\b(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/\S*)?/i;

/**
 * An email signature or a business card's text into a person, without AI:
 * the address, the number, the website, and the first line that reads as a
 * name, then the lines under it as title and company. The New card uses
 * the organization's AI when it's connected and this when it isn't.
 */
export function parseSignature(text: string): ContactFill {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/^[>\s|*_]+|[\s|*_]+$/g, "").trim())
    .filter(Boolean);
  const email = EMAIL.exec(text)?.[0]?.toLowerCase() ?? null;
  const phone = PHONE.exec(text.replace(EMAIL, " "))?.[0]?.trim() ?? null;
  let website: string | null = null;
  for (const l of lines) {
    if (EMAIL.test(l)) continue;
    const m = URL_RE.exec(l);
    if (m) {
      website = m[0].replace(/^https?:\/\//i, "").replace(/\/$/, "");
      break;
    }
  }
  const plain = (l: string) =>
    !EMAIL.test(l) && !PHONE.test(l) && !URL_RE.test(l) && !SIGN_OFF.test(l) && l.length <= 60;
  const nameAt = lines.findIndex(
    (l) => plain(l) && /^[\p{L}][\p{L}'.-]*(?:\s+[\p{L}][\p{L}'.-]*){1,3}$/u.test(l),
  );
  const name = nameAt >= 0 ? lines[nameAt]! : null;
  const after = nameAt >= 0 ? lines.slice(nameAt + 1).filter(plain) : [];
  let title: string | null = null;
  let company: string | null = null;
  for (const l of after.slice(0, 2)) {
    // "Program Director, Harbor Light Foundation" or "Program Director at Harbor Light".
    const split = /^(.+?)(?:,\s+|\s+at\s+|\s+[|\u00B7-]\s+)(.+)$/i.exec(l);
    if (!title && split) {
      title = split[1]!.trim();
      company = split[2]!.trim();
      break;
    }
    if (!title) title = l;
    else if (!company) company = l;
  }
  return { name, title, company, email, phone, website };
}

// ---------------------------------------------------------------- "already here" on the New card

/**
 * The one existing record a new one most looks like, when it's likely
 * enough to say so (the duplicate scan's own bar), with the reason.
 */
export function likeliest<T extends { id: string }>(
  draft: T,
  candidates: readonly T[],
  score: (a: T, b: T) => { score: number; reasons: string[] },
  bar: number,
): { record: T; score: number; reason: string | null } | null {
  let best: { record: T; score: number; reason: string | null } | null = null;
  for (const c of candidates) {
    if (c.id === draft.id) continue;
    const s = score(draft, c);
    if (s.score >= bar && (!best || s.score > best.score)) {
      best = { record: c, score: s.score, reason: s.reasons[0] ?? null };
    }
  }
  return best;
}
