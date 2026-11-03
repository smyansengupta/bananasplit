import { normalizeDomain, normalizeEmail } from "./dedupe";
import type { CrmObject } from "./fields";

/**
 * The CRM's validation rules (docs/features/crm.md: "Validation rules and
 * fields required only at a given stage"). Pure, so the record page can
 * say what's missing before it asks the server, and the server says the
 * same thing when it refuses.
 *
 * Two kinds of rule:
 * - Shapes: an email is an email, a link is a link, an amount isn't
 *   negative, a follow-up date is a real date.
 * - Required fields: fields an organization makes required everywhere
 *   (its CRM database's column settings) and fields a stage asks for
 *   (CrmStage.requiredFields, e.g. "Reason" on Lost). A key is a built-in
 *   field key or a custom field's id.
 */

export class CrmValidationError extends Error {
  /** The fields that failed, for the form to point at. */
  readonly fields: string[];

  constructor(message: string, fields: string[] = []) {
    super(message);
    this.name = "CrmValidationError";
    this.fields = fields;
  }
}

const isBlank = (v: unknown) =>
  v === null ||
  v === undefined ||
  (typeof v === "string" && v.trim() === "") ||
  (Array.isArray(v) && v.length === 0);

/** Checks the shapes of the built-in values being written; throws CrmValidationError. */
export function checkShapes(object: CrmObject, patch: Record<string, unknown>): void {
  const problems: { key: string; message: string }[] = [];
  const text = (key: string, max: number) => {
    const v = patch[key];
    if (v === undefined || v === null) return;
    if (typeof v !== "string") problems.push({ key, message: "Enter text." });
    else if (v.length > max) problems.push({ key, message: `Keep it under ${max.toLocaleString()} characters.` });
  };
  const nameKey = object === "deal" ? "title" : "name";
  if (nameKey in patch && isBlank(patch[nameKey])) {
    problems.push({ key: nameKey, message: object === "deal" ? "Give it a title." : "Give it a name." });
  }
  text(nameKey, 200);
  for (const key of ["title", "location", "source", "industry", "size", "address", "nextStep"]) text(key, 300);
  for (const key of ["description", "closeReason"]) text(key, 5000);
  if (typeof patch.primaryEmail === "string" && patch.primaryEmail.trim() && !normalizeEmail(patch.primaryEmail)) {
    problems.push({ key: "primaryEmail", message: "That email address doesn't look right." });
  }
  if (typeof patch.domain === "string" && patch.domain.trim() && !normalizeDomain(patch.domain)) {
    problems.push({ key: "domain", message: "Write a domain like example.com." });
  }
  for (const key of ["website", "linkedinUrl"]) {
    const v = patch[key];
    if (typeof v === "string" && v.trim() && !isUrl(v)) {
      problems.push({ key, message: "Write a link like example.com." });
    }
  }
  if (patch.amountCents !== undefined && patch.amountCents !== null) {
    const n = patch.amountCents;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > 1e13) {
      problems.push({ key: "amount", message: "Enter an amount of zero or more." });
    }
  }
  if (patch.keepInTouchDays !== undefined && patch.keepInTouchDays !== null) {
    const n = patch.keepInTouchDays;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 3650) {
      problems.push({ key: "keepInTouchDays", message: "Pick a number of days between 1 and 3650." });
    }
  }
  for (const key of ["nextFollowUpAt", "expectedOn", "nextStepAt"]) {
    const v = patch[key];
    if (v !== undefined && v !== null && !(v instanceof Date && !Number.isNaN(v.getTime()))) {
      problems.push({ key, message: "Pick a real date." });
    }
  }
  if (problems.length > 0) {
    throw new CrmValidationError(problems[0]!.message, problems.map((p) => p.key));
  }
}

/** Is it a web link (with or without https://)? */
export function isUrl(input: string): boolean {
  const s = input.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    return (u.protocol === "http:" || u.protocol === "https:") && u.hostname.includes(".");
  } catch {
    return false;
  }
}

/** "example.com/about" -> "https://example.com/about". */
export function normalizeUrl(input: string | null | undefined): string | null {
  const s = (input ?? "").trim();
  if (!s || !isUrl(s)) return null;
  return /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`;
}

/**
 * Which of `required` a record leaves empty. `values` holds the record's
 * built-in values by field key (amount, company, person...) and its custom
 * values by field id.
 */
export function missingRequired(required: readonly string[], values: Record<string, unknown>): string[] {
  return required.filter((key) => isBlank(values[key]));
}

/** "Add Reason and Amount first." */
export function missingMessage(labels: readonly string[], to?: string): string {
  if (labels.length === 0) return "";
  const list =
    labels.length === 1
      ? labels[0]!
      : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
  return to ? `Add ${list} to move it to ${to}.` : `Add ${list} first.`;
}
