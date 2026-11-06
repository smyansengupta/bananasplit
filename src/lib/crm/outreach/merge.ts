/**
 * Mail merge (docs/features/crm.md, module 5, "Personal at scale"): fields
 * from the person, their company, their history with the organization and
 * the member sending, written {{first_name}} or with a fallback
 * {{first_name|there}}. Pure and client-safe: the template editor's
 * preview, the per-person edit and the send all render with these.
 */

export interface MergeField {
  key: string;
  label: string;
  /** What it reads in the editor's example. */
  example: string;
  group: "Person" | "Company" | "History" | "You";
}

export const MERGE_FIELDS: readonly MergeField[] = [
  { key: "first_name", label: "First name", example: "Ada", group: "Person" },
  { key: "last_name", label: "Last name", example: "Lovelace", group: "Person" },
  { key: "full_name", label: "Full name", example: "Ada Lovelace", group: "Person" },
  { key: "email", label: "Email", example: "ada@harborlight.org", group: "Person" },
  { key: "title", label: "Title", example: "Director", group: "Person" },
  { key: "company", label: "Company", example: "Harbor Light", group: "Company" },
  { key: "company_website", label: "Company website", example: "harborlight.org", group: "Company" },
  { key: "last_event", label: "Last event they came to", example: "the March showcase", group: "History" },
  { key: "last_event_date", label: "When that was", example: "March 14", group: "History" },
  { key: "events_attended", label: "Events they came to", example: "3", group: "History" },
  { key: "last_contacted", label: "When we last talked", example: "two months ago", group: "History" },
  { key: "last_gift", label: "Their last gift", example: "$250", group: "History" },
  { key: "my_name", label: "Your name", example: "Jackson Lamoureux", group: "You" },
  { key: "my_first_name", label: "Your first name", example: "Jackson", group: "You" },
  { key: "organization", label: "Your organization", example: "Harbor Robotics", group: "You" },
];

const KNOWN = new Set(MERGE_FIELDS.map((f) => f.key));

/** {{ key }} or {{ key | fallback }}. Keys are lowercase words and underscores. */
const TOKEN = /\{\{\s*([a-z_]+)\s*(?:\|\s*([^}]*?)\s*)?\}\}/g;

export type MergeValues = Partial<Record<string, string | null | undefined>>;

export interface Rendered {
  text: string;
  /** Fields the text uses that had no value and no fallback. */
  missing: string[];
  /** Tokens that aren't merge fields at all (a typo). */
  unknown: string[];
}

/**
 * Fills every merge field; one without a value uses its fallback or nothing.
 * `fields` names the keys that exist (default: an email's, MERGE_FIELDS);
 * workflows pass their own record fields (src/lib/crm/workflows.ts).
 */
export function renderMerge(text: string, values: MergeValues, fields: ReadonlySet<string> = KNOWN): Rendered {
  const missing = new Set<string>();
  const unknown = new Set<string>();
  const out = text.replace(TOKEN, (_all, key: string, fallback: string | undefined) => {
    if (!fields.has(key)) {
      unknown.add(key);
      return fallback ?? "";
    }
    const v = values[key];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v);
    if (fallback !== undefined) return fallback;
    missing.add(key);
    return "";
  });
  return {
    // A missing field mid-sentence leaves a double space or a space before a comma.
    text: out
      .replace(/[ \t]{2,}/g, " ")
      .replace(/ +([,.!?])/g, "$1")
      .replace(/[ \t]+$/gm, ""),
    missing: [...missing],
    unknown: [...unknown],
  };
}

/** The merge fields a text uses, in order, once each. */
export function mergeKeys(text: string): string[] {
  const keys: string[] = [];
  for (const m of text.matchAll(TOKEN)) if (!keys.includes(m[1]!)) keys.push(m[1]!);
  return keys;
}

/** Example values, for a template's preview before a person is picked. */
export function exampleValues(): MergeValues {
  return Object.fromEntries(MERGE_FIELDS.map((f) => [f.key, f.example]));
}

/** "two months ago", "last week", "yesterday": how long since, in words a letter uses. */
export function sinceWords(at: Date | null, now: Date = new Date()): string | null {
  if (!at) return null;
  const days = Math.floor((now.getTime() - at.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "last week";
  if (days < 30) return `${Math.round(days / 7)} weeks ago`;
  if (days < 60) return "last month";
  if (days < 365) return `${Math.round(days / 30)} months ago`;
  const years = Math.round(days / 365);
  return years === 1 ? "a year ago" : `${years} years ago`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const URL_RE = /\bhttps?:\/\/[^\s<>"')\]]+[^\s<>"')\].,;:!?]/g;

/**
 * A plain-text message as simple HTML: escaped, paragraphs and line breaks
 * kept, links made clickable (through `link`, which can wrap them for
 * click tracking). Every CRM email is written as text, so what the person
 * reads is what the member wrote, with no layout of ours around it.
 */
export function textToHtml(text: string, link: (url: string) => string = (u) => u): string {
  const paragraphs = text.replace(/\r\n/g, "\n").trim().split(/\n{2,}/);
  return paragraphs
    .map((p) => {
      let html = "";
      let last = 0;
      for (const m of p.matchAll(URL_RE)) {
        html += escapeHtml(p.slice(last, m.index));
        const url = m[0];
        html += `<a href="${escapeHtml(link(url))}">${escapeHtml(url)}</a>`;
        last = (m.index ?? 0) + url.length;
      }
      html += escapeHtml(p.slice(last));
      return `<p style="margin:0 0 14px">${html.replace(/\n/g, "<br>")}</p>`;
    })
    .join("");
}

/** The links a text holds (for the preview's "N links, tracked"). */
export function linksIn(text: string): string[] {
  return [...text.matchAll(URL_RE)].map((m) => m[0]);
}
