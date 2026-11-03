/**
 * The CRM's built-in fields: one description per field of a person, a
 * company and a pipeline item, shared by the record pages, the lists, the
 * Databases view, the importer, Reports, validation and field history.
 * Custom fields are DatabaseField rows on the CRM's databases (their ids
 * key each row's `custom` JSON); a key here never looks like a field id.
 * Pure and client-safe.
 */

export const CRM_OBJECTS = ["person", "company", "deal"] as const;
export type CrmObject = (typeof CRM_OBJECTS)[number];

export type BuiltinType =
  | "TEXT"
  | "LONG_TEXT"
  | "EMAIL"
  | "PHONE"
  | "URL"
  | "DATE"
  | "NUMBER"
  | "CURRENCY"
  | "CHECKBOX"
  | "SELECT"
  | "MEMBER"
  | "COMPANY"
  | "PERSON"
  | "STAGE";

export interface BuiltinField {
  key: string;
  label: string;
  type: BuiltinType;
  /** People edit it on the record (not computed). */
  editable: boolean;
  /** A column the importer can fill. */
  importable: boolean;
  /** Other column names the importer matches (lowercase, any punctuation). */
  aliases?: readonly string[];
}

export const RECORD_STATUSES = ["ACTIVE", "INACTIVE", "ALUMNI"] as const;
export type RecordStatus = (typeof RECORD_STATUSES)[number];
export const STATUS_LABELS: Record<RecordStatus, string> = {
  ACTIVE: "Active",
  INACTIVE: "Inactive",
  ALUMNI: "Alumni",
};

export const FORECAST_CATEGORIES = ["PIPELINE", "BEST_CASE", "COMMIT", "OMITTED"] as const;
export const FORECAST_LABELS: Record<(typeof FORECAST_CATEGORIES)[number], string> = {
  PIPELINE: "Pipeline",
  BEST_CASE: "Best case",
  COMMIT: "Commit",
  OMITTED: "Left out",
};

export const PERSON_FIELDS: readonly BuiltinField[] = [
  { key: "name", label: "Name", type: "TEXT", editable: true, importable: true, aliases: ["full name", "contact name", "person name", "person", "contact"] },
  { key: "firstName", label: "First name", type: "TEXT", editable: true, importable: true, aliases: ["first", "given name", "forename", "first name"] },
  { key: "lastName", label: "Last name", type: "TEXT", editable: true, importable: true, aliases: ["last", "surname", "family name", "last name"] },
  { key: "primaryEmail", label: "Email", type: "EMAIL", editable: true, importable: true, aliases: ["email", "email address", "e-mail", "work email", "primary email", "person email"] },
  { key: "otherEmails", label: "Other emails", type: "TEXT", editable: false, importable: true, aliases: ["secondary email", "other email", "personal email", "alternate email"] },
  { key: "phone", label: "Phone", type: "PHONE", editable: true, importable: true, aliases: ["phone number", "mobile", "mobile phone", "cell", "telephone", "work phone", "person phone"] },
  { key: "title", label: "Title", type: "TEXT", editable: true, importable: true, aliases: ["job title", "position", "role", "job"] },
  { key: "company", label: "Company", type: "COMPANY", editable: true, importable: true, aliases: ["company name", "organization", "organisation", "account name", "account", "employer", "organization name", "org"] },
  { key: "linkedinUrl", label: "LinkedIn", type: "URL", editable: true, importable: true, aliases: ["linkedin", "linkedin url", "linkedin profile"] },
  { key: "website", label: "Website", type: "URL", editable: true, importable: true, aliases: ["web", "url", "homepage", "personal website"] },
  { key: "location", label: "Location", type: "TEXT", editable: true, importable: true, aliases: ["city", "address", "mailing city", "country", "region", "state"] },
  { key: "relationship", label: "Relationship", type: "SELECT", editable: true, importable: true, aliases: ["type", "contact type", "lifecycle stage", "category", "relationship type", "segment"] },
  { key: "status", label: "Status", type: "SELECT", editable: true, importable: true, aliases: ["state", "active"] },
  { key: "owner", label: "Owner", type: "MEMBER", editable: true, importable: true, aliases: ["contact owner", "owner name", "assigned to", "account owner"] },
  { key: "source", label: "Source", type: "TEXT", editable: true, importable: true, aliases: ["lead source", "original source", "how we met"] },
  { key: "nextFollowUpAt", label: "Next follow-up", type: "DATE", editable: true, importable: true, aliases: ["follow up", "follow-up date", "next activity date", "next step date"] },
  { key: "keepInTouchDays", label: "Keep in touch every (days)", type: "NUMBER", editable: true, importable: false },
  { key: "doNotContact", label: "Do not contact", type: "CHECKBOX", editable: true, importable: true, aliases: ["do not contact", "unsubscribed", "opted out", "do not email"] },
  { key: "notes", label: "Notes", type: "LONG_TEXT", editable: false, importable: true, aliases: ["note", "notes", "description", "comments", "about", "note - content", "bio"] },
  { key: "lastContactedAt", label: "Last contacted", type: "DATE", editable: false, importable: true, aliases: ["last contacted", "last activity date", "last contact", "last activity"] },
  { key: "strength", label: "Relationship strength", type: "NUMBER", editable: false, importable: false },
  { key: "createdAt", label: "Added", type: "DATE", editable: false, importable: false },
];

export const COMPANY_FIELDS: readonly BuiltinField[] = [
  { key: "name", label: "Name", type: "TEXT", editable: true, importable: true, aliases: ["company name", "company", "organization", "organisation", "account name", "account", "organization - name", "name"] },
  { key: "domain", label: "Domain", type: "TEXT", editable: true, importable: true, aliases: ["company domain", "company domain name", "email domain"] },
  { key: "website", label: "Website", type: "URL", editable: true, importable: true, aliases: ["web", "url", "website url", "homepage"] },
  { key: "industry", label: "Industry", type: "TEXT", editable: true, importable: true, aliases: ["sector", "type"] },
  { key: "size", label: "Size", type: "TEXT", editable: true, importable: true, aliases: ["employees", "number of employees", "company size", "headcount"] },
  { key: "phone", label: "Phone", type: "PHONE", editable: true, importable: true, aliases: ["phone number", "company phone"] },
  { key: "address", label: "Address", type: "TEXT", editable: true, importable: true, aliases: ["street address", "location", "city", "billing address"] },
  { key: "description", label: "About", type: "LONG_TEXT", editable: true, importable: true, aliases: ["description", "about", "notes", "summary"] },
  { key: "status", label: "Status", type: "SELECT", editable: true, importable: true },
  { key: "owner", label: "Owner", type: "MEMBER", editable: true, importable: true, aliases: ["company owner", "account owner", "owner"] },
  { key: "nextFollowUpAt", label: "Next follow-up", type: "DATE", editable: true, importable: true },
  { key: "lastContactedAt", label: "Last contacted", type: "DATE", editable: false, importable: false },
  { key: "strength", label: "Relationship strength", type: "NUMBER", editable: false, importable: false },
  { key: "createdAt", label: "Added", type: "DATE", editable: false, importable: false },
];

export const DEAL_FIELDS: readonly BuiltinField[] = [
  { key: "title", label: "Title", type: "TEXT", editable: true, importable: true, aliases: ["deal name", "deal - title", "name", "opportunity name", "title", "deal title"] },
  { key: "stage", label: "Stage", type: "STAGE", editable: true, importable: true, aliases: ["deal stage", "deal - stage", "stage name", "status"] },
  { key: "amount", label: "Amount", type: "CURRENCY", editable: true, importable: true, aliases: ["value", "deal value", "deal - value", "amount", "pledge"] },
  { key: "expectedOn", label: "Expected", type: "DATE", editable: true, importable: true, aliases: ["close date", "expected close date", "deal - expected close date", "due"] },
  { key: "company", label: "Company", type: "COMPANY", editable: true, importable: true, aliases: ["company name", "organization - name", "account name", "organization"] },
  { key: "person", label: "Person", type: "PERSON", editable: true, importable: true, aliases: ["contact", "person - name", "contact name", "primary contact"] },
  { key: "owner", label: "Owner", type: "MEMBER", editable: true, importable: true, aliases: ["deal owner", "deal - owner", "owner"] },
  { key: "nextStep", label: "Next step", type: "TEXT", editable: true, importable: true, aliases: ["next step", "next activity"] },
  { key: "nextStepAt", label: "Next step by", type: "DATE", editable: true, importable: true, aliases: ["next activity date"] },
  { key: "forecastCategory", label: "Forecast", type: "SELECT", editable: true, importable: false },
  { key: "closeReason", label: "Reason", type: "LONG_TEXT", editable: true, importable: true, aliases: ["lost reason", "close reason", "won reason"] },
  { key: "source", label: "Source", type: "TEXT", editable: true, importable: true, aliases: ["lead source", "source"] },
  { key: "closedAt", label: "Closed", type: "DATE", editable: false, importable: false },
  { key: "createdAt", label: "Added", type: "DATE", editable: false, importable: false },
];

export function builtinFields(object: CrmObject): readonly BuiltinField[] {
  return object === "person" ? PERSON_FIELDS : object === "company" ? COMPANY_FIELDS : DEAL_FIELDS;
}

export function builtinField(object: CrmObject, key: string): BuiltinField | undefined {
  return builtinFields(object).find((f) => f.key === key);
}

/** A field key's label: a built-in's, a custom field's name from `custom`, else the key. */
export function fieldLabel(
  object: CrmObject,
  key: string,
  custom: ReadonlyMap<string, string> = new Map(),
): string {
  if (key.startsWith("custom.")) return custom.get(key.slice(7)) ?? "A removed field";
  return builtinField(object, key)?.label ?? custom.get(key) ?? key;
}

/** The key a custom field's changes are recorded under (CrmFieldHistory.field). */
export function customKey(fieldId: string): string {
  return `custom.${fieldId}`;
}

/** "Ada Lovelace" from its parts, or what was given. */
export function personName(input: {
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}): string {
  const parts = [input.firstName?.trim(), input.lastName?.trim()].filter(Boolean).join(" ");
  const name = input.name?.trim() || parts;
  if (name) return name.slice(0, 200);
  const local = input.email?.split("@")[0]?.replace(/[._+-]+/g, " ").trim();
  return local ? local.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 200) : "";
}

/** "Ada", "Lovelace" from "Ada Lovelace" (the last word is the last name). */
export function splitName(name: string): { firstName: string | null; lastName: string | null } {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { firstName: null, lastName: null };
  if (words.length === 1) return { firstName: words[0]!, lastName: null };
  return { firstName: words.slice(0, -1).join(" "), lastName: words[words.length - 1]! };
}

/** Two letters for an avatar. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[words.length - 1]![0]!).toUpperCase();
}

/** Cents as "$1,500" (whole dollars) or "$1,500.50". */
export function formatMoney(cents: number | null | undefined, currency = "USD"): string {
  if (cents === null || cents === undefined) return "";
  const whole = cents % 100 === 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(cents / 100);
}

/** "$1.5k" for column totals. */
export function formatMoneyShort(cents: number, currency = "USD"): string {
  const dollars = cents / 100;
  if (Math.abs(dollars) < 10_000) return formatMoney(Math.round(dollars) * 100, currency);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(dollars);
}
