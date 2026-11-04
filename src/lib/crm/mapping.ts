import { builtinFields, type CrmObject } from "./fields";

/**
 * Bringing people in from a file (docs/features/crm.md, "Move in from a
 * spreadsheet in minutes"): which tool a file came from, which column
 * means what, and what one row becomes. Pure: the importer (src/server/
 * crm/import.ts) runs it on the server, the mapping screen runs it in the
 * browser for the preview.
 *
 * Targets a column can map to:
 *   a built-in field key            "name", "primaryEmail", "company"...
 *   a custom field                  "custom:<fieldId>"
 *   the row's note or activity      "activity.body", "activity.subject",
 *                                   "activity.date", "activity.kind"
 *   nothing                         null (skipped)
 * HubSpot, Salesforce and Pipedrive exports keep their notes and activity:
 * a row's note becomes a NOTE on the timeline, dated when the export says.
 */

export const IMPORT_SOURCES = [
  "csv",
  "notion",
  "airtable",
  "hubspot",
  "salesforce",
  "pipedrive",
  "vcard",
] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];

export const IMPORT_SOURCE_LABELS: Record<ImportSource, string> = {
  csv: "Spreadsheet",
  notion: "Notion",
  airtable: "Airtable",
  hubspot: "HubSpot",
  salesforce: "Salesforce",
  pipedrive: "Pipedrive",
  vcard: "Contacts (vCard)",
};

export const ACTIVITY_TARGETS = [
  "activity.body",
  "activity.subject",
  "activity.date",
  "activity.kind",
] as const;

export const ACTIVITY_TARGET_LABELS: Record<(typeof ACTIVITY_TARGETS)[number], string> = {
  "activity.body": "Note or activity text",
  "activity.subject": "Activity subject",
  "activity.date": "Activity date",
  "activity.kind": "Activity type",
};

export type Mapping = Record<string, string | null>;

/** "Person - Email Address" -> "person email address": what aliases are written in. */
export function headerKey(header: string): string {
  return header
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Which tool a file came from, by the column names only it uses. */
export function detectSource(headers: readonly string[], fileName = ""): ImportSource {
  const keys = new Set(headers.map(headerKey));
  const has = (...names: string[]) => names.some((n) => keys.has(n));
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".vcf") || lower.endsWith(".vcard")) return "vcard";
  if (has("record id", "contact owner", "lifecycle stage", "hubspot score", "associated company")) {
    return "hubspot";
  }
  if (headers.some((h) => /^(person|organization|deal|activity|note) - /i.test(h))) return "pipedrive";
  if (has("account name", "mailing city", "mailing street", "lead source", "contact id", "account id")) {
    return "salesforce";
  }
  // Notion stamps every export with "Last edited time"; Airtable names its
  // files after the base and view ("Contacts-Grid view.csv").
  if (lower.includes("notion") || has("last edited time", "last edited by")) return "notion";
  if (lower.includes("airtable") || /-grid view.csv$/i.test(fileName) || has("created time", "last modified time")) {
    return "airtable";
  }
  return "csv";
}

/** Columns each tool names for notes and activity. */
const ACTIVITY_ALIASES: Record<(typeof ACTIVITY_TARGETS)[number], readonly string[]> = {
  "activity.body": [
    "notes",
    "note",
    "note content",
    "note body",
    "body",
    "activity note",
    "description",
    "comments",
    "last note",
    "activity description",
  ],
  "activity.subject": ["activity subject", "subject", "activity title"],
  "activity.date": [
    "activity date",
    "note date",
    "note add time",
    "activity due date",
    "date of last activity",
    "last activity date",
    "created date",
    "create date",
  ],
  "activity.kind": ["activity type", "type of activity", "engagement type"],
};

export interface CustomFieldRef {
  id: string;
  name: string;
}

/**
 * A suggested target for each column: remembered choices first (the last
 * import of a file with the same columns), then a custom field of the same
 * name, then a built-in field's name or alias, then a note column. Each
 * target is used once; a column nothing fits is skipped.
 */
export function suggestMapping(
  object: CrmObject,
  headers: readonly string[],
  custom: readonly CustomFieldRef[] = [],
  remembered: Mapping = {},
): Mapping {
  const out: Mapping = {};
  const used = new Set<string>();
  const take = (header: string, target: string | null) => {
    out[header] = target;
    if (target) used.add(target);
  };
  const fields = builtinFields(object).filter((f) => f.importable);
  // Exact names beat aliases: a "Name" column is the name even if another
  // column's alias also says name.
  for (const h of headers) {
    if (h in remembered) {
      const t = remembered[h] ?? null;
      if (!t || !used.has(t)) take(h, t);
    }
  }
  const open = () => headers.filter((h) => !(h in out));
  for (const h of open()) {
    const k = headerKey(h);
    const c = custom.find((f) => headerKey(f.name) === k);
    if (c && !used.has(`custom:${c.id}`)) take(h, `custom:${c.id}`);
  }
  for (const h of open()) {
    const k = headerKey(h);
    const f = fields.find((x) => headerKey(x.label) === k || x.key.toLowerCase() === k.replace(/ /g, ""));
    if (f && !used.has(f.key)) take(h, f.key);
  }
  for (const h of open()) {
    const k = headerKey(h);
    const f = fields.find((x) => (x.aliases ?? []).some((a) => headerKey(a) === k));
    if (f && !used.has(f.key)) take(h, f.key);
  }
  for (const h of open()) {
    const k = headerKey(h);
    for (const t of ACTIVITY_TARGETS) {
      if (used.has(t)) continue;
      if (ACTIVITY_ALIASES[t].includes(k)) {
        take(h, t);
        break;
      }
    }
  }
  // A person's "notes" alias lives on the built-in list too; prefer the activity.
  if (object === "person") {
    for (const [h, t] of Object.entries(out)) {
      if (t === "notes" && !used.has("activity.body")) {
        out[h] = "activity.body";
        used.delete("notes");
        used.add("activity.body");
      }
    }
  }
  for (const h of open()) out[h] = null;
  return out;
}

/** A stable name for a set of columns, so the same export maps the same way next time. */
export function mappingSignature(object: CrmObject, headers: readonly string[]): string {
  const text = `${object}|${[...headers].map(headerKey).sort().join("|")}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${object}:${h.toString(36)}`;
}

export interface MappedRow {
  /** Built-in fields, as written in the file (the server validates them). */
  fields: Record<string, string>;
  /** Custom fields by id, as written. */
  custom: Record<string, string>;
  /** The row's note or activity, if it has one. */
  activity: { body: string; subject?: string; date?: string; kind?: string } | null;
}

/** One row of the file under a mapping. Empty cells are left out. */
export function mapRow(row: Record<string, string>, mapping: Mapping): MappedRow {
  const fields: Record<string, string> = {};
  const custom: Record<string, string> = {};
  const act: Record<string, string> = {};
  for (const [header, target] of Object.entries(mapping)) {
    if (!target) continue;
    const raw = (row[header] ?? "").trim();
    if (!raw) continue;
    if (target.startsWith("custom:")) custom[target.slice(7)] = raw;
    else if (target.startsWith("activity.")) act[target.slice(9)] = raw;
    else if (fields[target]) fields[target] = `${fields[target]}; ${raw}`;
    else fields[target] = raw;
  }
  const activity = act.body
    ? { body: act.body, subject: act.subject, date: act.date, kind: act.kind }
    : null;
  return { fields, custom, activity };
}

/** What a tool calls an activity, as a CrmActivityKind. */
export function activityKindOf(raw: string | undefined): "NOTE" | "EMAIL" | "CALL" | "MEETING" | "TASK" | "TEXT" {
  const s = (raw ?? "").toLowerCase();
  if (/mail/.test(s)) return "EMAIL";
  if (/call|phone/.test(s)) return "CALL";
  if (/meet|lunch|coffee|event/.test(s)) return "MEETING";
  if (/task|to-?do|deadline/.test(s)) return "TASK";
  if (/sms|text|whatsapp/.test(s)) return "TEXT";
  return "NOTE";
}

/** A date as a file writes it ("2026-03-14", "3/14/2026", "Mar 14, 2026 10:30 AM"). */
export function parseLooseDate(input: string | undefined): Date | null {
  const s = (input ?? "").trim();
  if (!s) return null;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:[ T](\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?)?$/i.exec(s);
  if (us) {
    const year = us[3]!.length === 2 ? 2000 + Number(us[3]) : Number(us[3]);
    let hour = us[4] ? Number(us[4]) : 12;
    if (us[6]) hour = (hour % 12) + (us[6].toLowerCase() === "pm" ? 12 : 0);
    const d = new Date(Date.UTC(year, Number(us[1]) - 1, Number(us[2]), hour, us[5] ? Number(us[5]) : 0));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  return d.getUTCFullYear() < 1900 || d.getUTCFullYear() > 2200 ? null : d;
}

// ---------------------------------------------------------------- vCard

/**
 * A vCard file (.vcf, from Apple, Google or Outlook contacts) as rows, with
 * the columns the person mapping already knows. Folded lines are unfolded,
 * quoted-printable is decoded, and every address after the first is kept.
 */
export function parseVcards(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const unfolded = text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
  const cards = unfolded.split(/^BEGIN:VCARD\s*$/im).slice(1);
  const rows: Record<string, string>[] = [];
  for (const card of cards) {
    const body = card.split(/^END:VCARD\s*$/im)[0] ?? "";
    const row: Record<string, string> = {};
    const emails: string[] = [];
    for (const line of body.split("\n")) {
      const idx = line.indexOf(":");
      if (idx < 0) continue;
      const left = line.slice(0, idx);
      let value = line.slice(idx + 1).trim();
      const [rawName, ...params] = left.split(";");
      const name = (rawName ?? "").replace(/^item\d+\./i, "").toUpperCase();
      if (params.some((p) => /ENCODING=QUOTED-PRINTABLE/i.test(p))) {
        value = value.replace(/=([0-9A-F]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
      }
      value = value.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
      if (!value) continue;
      switch (name) {
        case "FN":
          row["Name"] = value;
          break;
        case "N": {
          const [last, first] = value.split(";");
          if (first) row["First name"] = first;
          if (last) row["Last name"] = last;
          break;
        }
        case "EMAIL":
          emails.push(value);
          break;
        case "TEL":
          if (!row["Phone"]) row["Phone"] = value;
          break;
        case "ORG":
          row["Company"] = value.split(";")[0] ?? value;
          break;
        case "TITLE":
          row["Title"] = value;
          break;
        case "URL":
          if (/linkedin\.com/i.test(value)) row["LinkedIn"] = value;
          else if (!row["Website"]) row["Website"] = value;
          break;
        case "NOTE":
          row["Notes"] = value;
          break;
        case "ADR": {
          const parts = value.split(";").map((p) => p.trim()).filter(Boolean);
          if (parts.length && !row["Location"]) row["Location"] = parts.slice(-3).join(", ");
          break;
        }
        default:
          break;
      }
    }
    if (emails[0]) row["Email"] = emails[0];
    if (emails.length > 1) row["Other emails"] = emails.slice(1).join("; ");
    if (Object.keys(row).length > 0) rows.push(row);
  }
  const headers = [
    "Name",
    "First name",
    "Last name",
    "Email",
    "Other emails",
    "Phone",
    "Company",
    "Title",
    "Website",
    "LinkedIn",
    "Location",
    "Notes",
  ].filter((h) => rows.some((r) => r[h]));
  return { headers, rows };
}
