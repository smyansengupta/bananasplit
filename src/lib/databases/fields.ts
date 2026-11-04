import { z } from "zod";

import { normalizePhone } from "@/lib/rsvp/format";

/**
 * Field types of club-made databases (DatabaseField, docs/features/
 * databases.md "Your own databases"): what each stores, its options, and how
 * a typed or pasted value becomes the stored one. Pure and client-safe: the
 * grid formats with it and the server validates every write with it.
 *
 * Stored values (DatabaseRecord.values[fieldId]; an empty cell has no key):
 *   TEXT, LONG_TEXT, EMAIL, PHONE, URL   string
 *   NUMBER, CURRENCY                      number
 *   DATE                                  "YYYY-MM-DD"
 *   CHECKBOX                              true (unchecked is empty)
 *   SELECT                                a choice id
 *   MULTI_SELECT                          choice ids, in choice order
 *   MEMBER                                a member's user id
 */

export const FIELD_TYPES = [
  "TEXT",
  "LONG_TEXT",
  "NUMBER",
  "CURRENCY",
  "DATE",
  "CHECKBOX",
  "SELECT",
  "MULTI_SELECT",
  "MEMBER",
  "EMAIL",
  "PHONE",
  "URL",
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

export const FIELD_TYPE_META: Record<FieldType, { label: string; icon: string; hint: string }> = {
  TEXT: { label: "Text", icon: "Type", hint: "A short line: a name, a title, a size." },
  LONG_TEXT: { label: "Long text", icon: "AlignLeft", hint: "Notes and paragraphs." },
  NUMBER: { label: "Number", icon: "Hash", hint: "Counts and amounts." },
  CURRENCY: { label: "Money", icon: "DollarSign", hint: "Dollars and cents." },
  DATE: { label: "Date", icon: "Calendar", hint: "A day." },
  CHECKBOX: { label: "Checkbox", icon: "SquareCheck", hint: "Yes or no." },
  SELECT: { label: "Single select", icon: "CircleDot", hint: "One of a list of choices." },
  MULTI_SELECT: { label: "Multi-select", icon: "Tags", hint: "Any of a list of choices." },
  MEMBER: { label: "Member", icon: "User", hint: "Someone in your organization." },
  EMAIL: { label: "Email", icon: "Mail", hint: "An email address." },
  PHONE: { label: "Phone", icon: "Phone", hint: "A phone number." },
  URL: { label: "Link", icon: "Link", hint: "A web address." },
};

/** Choice colours: the usual tag palette, legible on light and dark themes alike. */
export const CHOICE_COLORS = [
  "gray",
  "yellow",
  "orange",
  "red",
  "pink",
  "purple",
  "blue",
  "teal",
  "green",
  "brown",
] as const;
export type ChoiceColor = (typeof CHOICE_COLORS)[number];

export const CHOICE_COLOR_CLASS: Record<ChoiceColor, string> = {
  gray: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300",
  yellow: "bg-yellow-400/25 text-yellow-800 dark:text-yellow-200",
  orange: "bg-orange-400/20 text-orange-800 dark:text-orange-200",
  red: "bg-red-500/15 text-red-700 dark:text-red-300",
  pink: "bg-pink-500/15 text-pink-700 dark:text-pink-300",
  purple: "bg-purple-500/15 text-purple-700 dark:text-purple-300",
  blue: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  teal: "bg-teal-500/15 text-teal-700 dark:text-teal-300",
  green: "bg-green-500/15 text-green-700 dark:text-green-300",
  brown: "bg-amber-800/15 text-amber-900 dark:text-amber-200",
};

export const LIMITS = {
  fieldsPerDatabase: 60,
  choicesPerField: 100,
  recordsPerDatabase: 10_000,
  databasesPerClub: 100,
  text: 1_000,
  longText: 10_000,
} as const;

const choiceSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
  label: z.string().trim().min(1).max(80),
  color: z.enum(CHOICE_COLORS),
});
export type Choice = z.infer<typeof choiceSchema>;

export const fieldOptionsSchema = z
  .object({
    choices: z.array(choiceSchema).max(LIMITS.choicesPerField).optional(),
    decimals: z.number().int().min(0).max(4).optional(),
  })
  .strict();
export type FieldOptions = z.infer<typeof fieldOptionsSchema>;

export interface FieldDef {
  id: string;
  name: string;
  type: FieldType;
  options: FieldOptions;
  isPrimary: boolean;
}

/** The options as stored, or {} when they don't parse (never throws). */
export function readOptions(raw: unknown): FieldOptions {
  const parsed = fieldOptionsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : {};
}

export function hasChoices(type: FieldType): boolean {
  return type === "SELECT" || type === "MULTI_SELECT";
}

/** A short random id for a new choice. */
export function choiceId(): string {
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 10);
}

export type CellResult = { ok: true; value: StoredValue | null } | { ok: false; error: string };
export type StoredValue = string | number | boolean | string[];

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isRealDate(key: string): boolean {
  if (!DATE.test(key)) return false;
  const d = new Date(`${key}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === key;
}

/** "3/14/2026", "2026-03-14", "Mar 14 2026" -> "2026-03-14" (for pasted and imported dates). */
export function parseDateInput(input: string): string | null {
  const s = input.trim();
  // A day that doesn't exist (Feb 30) is wrong, not March 2nd.
  if (DATE.test(s)) return isRealDate(s) ? s : null;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s);
  if (us) {
    const year = us[3]!.length === 2 ? 2000 + Number(us[3]) : Number(us[3]);
    const key = `${year}-${us[1]!.padStart(2, "0")}-${us[2]!.padStart(2, "0")}`;
    return isRealDate(key) ? key : null;
  }
  // Anything else must name its month ("Mar 14 2026"): bare digit strings
  // are too ambiguous to guess.
  if (!/[a-z]/i.test(s)) return null;
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return isRealDate(key) ? key : null;
}

function normalizeUrl(input: string): string | null {
  const s = input.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname.includes(".")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

function toNumber(input: unknown): number | null {
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  if (typeof input !== "string") return null;
  const cleaned = input.trim().replace(/[$,\s]/g, "");
  if (!cleaned || !/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && Math.abs(n) < 1e15 ? n : null;
}

const empty = (v: unknown) =>
  v === null ||
  v === undefined ||
  (typeof v === "string" && v.trim() === "") ||
  (Array.isArray(v) && v.length === 0);

/**
 * A cell value as it will be stored, or why it can't be. `input` is what
 * the grid sends (the stored shape) or a pasted/imported string. `members`
 * is the set of the club's user ids, for MEMBER fields (omit to skip that
 * check, e.g. on the client).
 */
export function parseCell(
  field: Pick<FieldDef, "type" | "options">,
  input: unknown,
  members?: ReadonlySet<string>,
): CellResult {
  if (empty(input) || input === false) return { ok: true, value: null };
  switch (field.type) {
    case "TEXT":
    case "LONG_TEXT": {
      if (typeof input !== "string" && typeof input !== "number")
        return { ok: false, error: "Enter text." };
      const s = String(input);
      const max = field.type === "TEXT" ? LIMITS.text : LIMITS.longText;
      if (s.length > max)
        return { ok: false, error: `Keep it under ${max.toLocaleString()} characters.` };
      return {
        ok: true,
        value: field.type === "TEXT" ? s.replace(/\s*\n\s*/g, " ").trim() : s.trimEnd(),
      };
    }
    case "NUMBER":
    case "CURRENCY": {
      const n = toNumber(input);
      if (n === null) return { ok: false, error: "Enter a number." };
      const decimals = field.type === "CURRENCY" ? 2 : (field.options.decimals ?? 4);
      const f = 10 ** decimals;
      return { ok: true, value: Math.round(n * f) / f };
    }
    case "DATE": {
      const key = typeof input === "string" ? parseDateInput(input) : null;
      return key ? { ok: true, value: key } : { ok: false, error: "Enter a date." };
    }
    case "CHECKBOX": {
      if (input === true) return { ok: true, value: true };
      if (typeof input === "string") {
        const s = input.trim().toLowerCase();
        if (["true", "yes", "y", "1", "x", "✓", "checked"].includes(s))
          return { ok: true, value: true };
        if (["false", "no", "n", "0", "unchecked"].includes(s)) return { ok: true, value: null };
      }
      return { ok: false, error: "Checked or not." };
    }
    case "SELECT":
    case "MULTI_SELECT": {
      const choices = field.options.choices ?? [];
      const byId = new Map(choices.map((c) => [c.id, c]));
      const byLabel = new Map(choices.map((c) => [c.label.toLowerCase(), c]));
      const resolve = (v: unknown) =>
        typeof v === "string" ? (byId.get(v) ?? byLabel.get(v.trim().toLowerCase()) ?? null) : null;
      const raw = Array.isArray(input)
        ? input
        : typeof input === "string" && field.type === "MULTI_SELECT"
          ? input.split(/[,;]/)
          : [input];
      const picked = raw.filter((v) => !empty(v)).map(resolve);
      if (picked.some((c) => c === null)) return { ok: false, error: "Pick one of the choices." };
      const ids = new Set(picked.map((c) => c!.id));
      if (field.type === "SELECT") {
        if (ids.size > 1) return { ok: false, error: "Pick one choice." };
        return { ok: true, value: [...ids][0] ?? null };
      }
      const ordered = choices.filter((c) => ids.has(c.id)).map((c) => c.id);
      return { ok: true, value: ordered.length ? ordered : null };
    }
    case "MEMBER": {
      if (typeof input !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(input)) {
        return { ok: false, error: "Pick someone in the organization." };
      }
      if (members && !members.has(input))
        return { ok: false, error: "Pick someone in the organization." };
      return { ok: true, value: input };
    }
    case "EMAIL": {
      const s = typeof input === "string" ? input.trim().toLowerCase() : "";
      return s.length <= 254 && EMAIL.test(s)
        ? { ok: true, value: s }
        : { ok: false, error: "Enter an email address." };
    }
    case "PHONE": {
      const s = typeof input === "string" ? input : String(input);
      const phone = normalizePhone(s);
      return phone ? { ok: true, value: phone } : { ok: false, error: "Enter a phone number." };
    }
    case "URL": {
      const s = typeof input === "string" ? normalizeUrl(input) : null;
      return s && s.length <= 2000
        ? { ok: true, value: s }
        : { ok: false, error: "Enter a link like example.com." };
    }
  }
}

/**
 * The value in another field type, for changing a field's type: whatever
 * still parses is kept (a number in a text field stays, "Yes" becomes a
 * checkbox), the rest is cleared. `members` maps the club's user ids to
 * their names: a member cell becomes their name, and a member field only
 * takes people in the club.
 */
export function convertValue(
  from: Pick<FieldDef, "type" | "options">,
  to: Pick<FieldDef, "type" | "options">,
  value: unknown,
  members?: ReadonlyMap<string, string>,
): StoredValue | null {
  const memberIds = members ? new Set(members.keys()) : undefined;
  // Between single and multi-select the choices carry over, ids and all.
  if (hasChoices(from.type) && hasChoices(to.type)) {
    const same = parseCell(to, value, memberIds);
    return same.ok ? same.value : null;
  }
  // Choices and members are stored as ids, and an id is valid text too:
  // convert those from what the cell shows ("Paid", "Maya Patel"), never
  // from the id itself.
  if (!hasChoices(from.type) && from.type !== "MEMBER") {
    const asIs = parseCell(to, value, memberIds);
    if (asIs.ok && asIs.value !== null) return asIs.value;
  }
  const fromText = parseCell(to, displayText(from, value, members ?? new Map()), memberIds);
  return fromText.ok ? fromText.value : null;
}

/**
 * Choices for a field turning into a select: its values as the cells show
 * them, one choice per distinct value (case aside). A field holds at most
 * 100 choices, so the most used values win; a value longer than a choice
 * label (80 characters) gets none. Cells left without a choice are cleared
 * when the values convert, and counted.
 */
export function choicesFromValues(
  from: Pick<FieldDef, "type" | "options">,
  to: "SELECT" | "MULTI_SELECT",
  values: readonly unknown[],
  members: ReadonlyMap<string, string>,
): Choice[] {
  const seen = new Map<string, { label: string; uses: number; order: number }>();
  for (const value of values) {
    const text = displayText(from, value, members);
    for (const part of to === "MULTI_SELECT" ? text.split(/[,;]/) : [text]) {
      const label = part.trim().replace(/\s+/g, " ");
      if (!label || label.length > 80) continue;
      const key = label.toLowerCase();
      const hit = seen.get(key);
      if (hit) hit.uses++;
      else seen.set(key, { label, uses: 1, order: seen.size });
    }
  }
  return [...seen.values()]
    .sort((a, b) => b.uses - a.uses || a.order - b.order)
    .slice(0, LIMITS.choicesPerField)
    .sort((a, b) => a.order - b.order)
    .map((c, j) => ({
      id: choiceId(),
      label: c.label,
      color: CHOICE_COLORS[(j + 1) % CHOICE_COLORS.length]!,
    }));
}

/**
 * A short fingerprint of a field's choices. Saving the whole list sends the
 * fingerprint it started from, and the server refuses the save when the
 * choices have changed since (someone else edited them meanwhile).
 */
export function choicesVersion(choices: readonly Choice[] | undefined): string {
  const text = JSON.stringify((choices ?? []).map((c) => [c.id, c.label, c.color]));
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${(choices ?? []).length}-${hash.toString(36)}`;
}

/** A value as plain text: for search, CSV export and type changes. */
export function displayText(
  field: Pick<FieldDef, "type" | "options">,
  value: unknown,
  memberNames: ReadonlyMap<string, string>,
): string {
  if (value === null || value === undefined) return "";
  switch (field.type) {
    case "CHECKBOX":
      return value === true ? "Yes" : "";
    case "SELECT":
    case "MULTI_SELECT": {
      const ids = Array.isArray(value) ? value : [value];
      const labels = new Map((field.options.choices ?? []).map((c) => [c.id, c.label]));
      return ids
        .map((id) => labels.get(String(id)) ?? "")
        .filter(Boolean)
        .join(", ");
    }
    case "MEMBER":
      return memberNames.get(String(value)) ?? "";
    case "CURRENCY":
      return typeof value === "number" ? `$${value.toFixed(2)}` : "";
    default:
      return String(value);
  }
}

/** Column names that hold phone numbers. */
const PHONE_HEADER = /\b(phone|mobile|cell|tel|telephone|whatsapp)\b/i;
/** Column names that hold ids and codes: digits that aren't amounts. */
const ID_HEADER =
  /(\b(id|nuid|sid|zip|zipcode|postcode|postal|code|pin)\b|\b(student|member|employee|account|order|ticket|card)\s*(no|num|number|#)|#\s*$)/i;

/** "(617) 555-0101", "+1 617 555 0101", "617.555.0101": written the way phone numbers are. */
function phoneShaped(v: string): boolean {
  const digits = v.replace(/\D/g, "").length;
  if (digits < 7 || digits > 15 || !/^\+?[\d\s().-]+$/.test(v) || DATE.test(v)) return false;
  return v.startsWith("+") || /[()]/.test(v) || (v.match(/\d[\s.-]+\d/g)?.length ?? 0) >= 2;
}

/**
 * Digits that are ids, not amounts: a leading zero, or every value the same
 * length of 7 to 15 digits (student ids, phone numbers without punctuation).
 */
function idShaped(values: readonly string[]): boolean {
  if (!values.every((v) => /^\d+$/.test(v))) return false;
  if (values.some((v) => /^0\d/.test(v))) return true;
  const lengths = new Set(values.map((v) => v.length));
  const length = values[0]!.length;
  return values.length >= 2 && lengths.size === 1 && length >= 7 && length <= 15;
}

/**
 * For a CSV import's column: the most specific type every non-empty value
 * fits. `header` is the column's name, a hint for phone numbers and ids.
 */
export function inferFieldType(samples: readonly string[], header = ""): FieldType {
  const values = samples.map((s) => s.trim()).filter(Boolean);
  if (values.length === 0) return "TEXT";
  const all = (test: (v: string) => boolean) => values.every(test);
  if (all((v) => /^(yes|no|y|n|true|false|x|✓)$/i.test(v))) return "CHECKBOX";
  if (all((v) => /^\$\s?[-\d,]+(\.\d{1,2})?$/.test(v))) return "CURRENCY";
  // Phone numbers and ids are digits but not amounts: catch them before
  // numbers, or 5551234567 shows as "5,551,234,567" and a leading zero is lost.
  const phones = all((v) => normalizePhone(v) !== null);
  if (phones && (PHONE_HEADER.test(header) || all(phoneShaped))) return "PHONE";
  if (all((v) => /^\d+$/.test(v)) && (ID_HEADER.test(header) || idShaped(values))) return "TEXT";
  if (all((v) => toNumber(v) !== null && !/^0\d/.test(v))) return "NUMBER";
  if (all((v) => EMAIL.test(v))) return "EMAIL";
  if (all((v) => /^\d{4}-\d{2}-\d{2}$/.test(v) || /^\d{1,2}\/\d{1,2}\/(\d{2}|\d{4})$/.test(v)))
    return "DATE";
  if (all((v) => /^https?:\/\//i.test(v))) return "URL";
  if (all((v) => /^[+()\d\s.-]{7,}$/.test(v) && normalizePhone(v) !== null)) return "PHONE";
  // A few short values repeating (sizes, years, statuses): a single select.
  const distinct = new Set(values.map((v) => v.toLowerCase()));
  if (
    values.length >= 4 &&
    distinct.size <= Math.min(12, Math.floor(values.length / 2)) &&
    values.every((v) => v.length <= 40)
  ) {
    return "SELECT";
  }
  if (values.some((v) => v.length > 120 || v.includes("\n"))) return "LONG_TEXT";
  return "TEXT";
}
