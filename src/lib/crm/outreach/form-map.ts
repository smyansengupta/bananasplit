/**
 * Forms to the CRM (docs/features/crm.md, module 4): a form can send each
 * response to the CRM as a new (or matched) person, and optionally a new
 * item in a pipeline, with its questions mapped to the CRM's fields. The
 * mapping is Form.crmDestination; this reads, suggests and applies it.
 * Pure and client-safe (the form's Settings show the same mapping).
 */

export const CRM_TARGETS = [
  { key: "name", label: "Name" },
  { key: "firstName", label: "First name" },
  { key: "lastName", label: "Last name" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "title", label: "Title" },
  { key: "company", label: "Company" },
  { key: "location", label: "Location" },
  { key: "linkedinUrl", label: "LinkedIn" },
  { key: "website", label: "Website" },
  { key: "note", label: "Note on their timeline" },
  { key: "itemTitle", label: "Item title" },
  { key: "amount", label: "Amount" },
] as const;

export type CrmTargetKey = (typeof CRM_TARGETS)[number]["key"];

const TARGET_KEYS = new Set<string>(CRM_TARGETS.map((t) => t.key));

export interface CrmDestination {
  /** person: a person only; deal: a person and an item in `pipelineId`. */
  object: "person" | "deal";
  pipelineId?: string | null;
  stageId?: string | null;
  /** questionId -> CRM field. */
  map: Record<string, CrmTargetKey>;
  /** Give new people an owner by the organization's routing (Settings > Routing). */
  route?: boolean;
  /** Tag new people with this relationship type. */
  relationship?: string | null;
}

export function readDestination(raw: unknown): CrmDestination | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Partial<CrmDestination>;
  if (d.object !== "person" && d.object !== "deal") return null;
  const map: Record<string, CrmTargetKey> = {};
  if (d.map && typeof d.map === "object") {
    for (const [q, t] of Object.entries(d.map)) {
      if (/^[A-Za-z0-9_-]{1,40}$/.test(q) && typeof t === "string" && TARGET_KEYS.has(t)) map[q] = t as CrmTargetKey;
    }
  }
  return {
    object: d.object,
    pipelineId: typeof d.pipelineId === "string" ? d.pipelineId : null,
    stageId: typeof d.stageId === "string" ? d.stageId : null,
    map,
    route: d.route === true,
    relationship: typeof d.relationship === "string" ? d.relationship : null,
  };
}

export interface MappableQuestion {
  id: string;
  type: string;
  title: string;
  fieldId?: string | null;
  options?: { id: string; label: string }[] | null;
}

/** A first guess at the mapping, from each question's type and words. */
export function suggestMap(questions: readonly MappableQuestion[]): Record<string, CrmTargetKey> {
  const out: Record<string, CrmTargetKey> = {};
  const used = new Set<string>();
  const take = (q: MappableQuestion, key: CrmTargetKey) => {
    if (used.has(key)) return;
    out[q.id] = key;
    used.add(key);
  };
  for (const q of questions) {
    const t = q.title.toLowerCase();
    if (q.type === "email" || /\be-?mail\b/.test(t)) take(q, "email");
    else if (q.type === "phone" || /\b(phone|mobile|cell)\b/.test(t)) take(q, "phone");
    else if (/\bfirst name\b/.test(t)) take(q, "firstName");
    else if (/\b(last name|surname|family name)\b/.test(t)) take(q, "lastName");
    else if (/\b(full )?name\b/.test(t) && !/\b(company|organi[sz]ation|business|school)\b/.test(t)) take(q, "name");
    else if (/\b(company|organi[sz]ation|business|employer|school|university)\b/.test(t)) take(q, "company");
    else if (/\b(title|role|position|job)\b/.test(t)) take(q, "title");
    else if (/\blinkedin\b/.test(t)) take(q, "linkedinUrl");
    else if (/\b(website|site|url)\b/.test(t)) take(q, "website");
    else if (/\b(city|location|where are you|based)\b/.test(t)) take(q, "location");
    else if (/\b(amount|budget|pledge|donation)\b/.test(t) && q.type === "number") take(q, "amount");
  }
  return out;
}

export interface Mapped {
  person: {
    name: string | null;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
    title: string | null;
    company: string | null;
    location: string | null;
    linkedinUrl: string | null;
    website: string | null;
  };
  note: string | null;
  itemTitle: string | null;
  amountCents: number | null;
}

function text(value: unknown, q: MappableQuestion | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  const label = (id: unknown) => q?.options?.find((o) => o.id === id)?.label ?? String(id);
  if (Array.isArray(value)) return value.map(label).join(", ").slice(0, 500) || null;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (q?.options?.length) return label(value).slice(0, 500);
  return String(value).trim().slice(0, 2000) || null;
}

/**
 * One response's values (by the question's field id) read through the
 * mapping. Unmapped answers become the timeline note, so nothing a person
 * wrote is lost.
 */
export function applyMap(
  dest: CrmDestination,
  questions: readonly MappableQuestion[],
  values: Readonly<Record<string, unknown>>,
): Mapped {
  const out: Mapped = {
    person: {
      name: null,
      firstName: null,
      lastName: null,
      email: null,
      phone: null,
      title: null,
      company: null,
      location: null,
      linkedinUrl: null,
      website: null,
    },
    note: null,
    itemTitle: null,
    amountCents: null,
  };
  const noteLines: string[] = [];
  for (const q of questions) {
    if (!q.fieldId || q.type === "section") continue;
    const v = text(values[q.fieldId], q);
    if (v === null) continue;
    const target = dest.map[q.id];
    if (!target || target === "note") {
      noteLines.push(`${q.title || "Answer"}: ${v}`);
      continue;
    }
    if (target === "itemTitle") out.itemTitle = v.slice(0, 200);
    else if (target === "amount") {
      const n = Number(String(values[q.fieldId]).replace(/[^0-9.]/g, ""));
      out.amountCents = Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
    } else if (target === "email") out.person.email = v.toLowerCase().slice(0, 254);
    else out.person[target] = v.slice(0, 300);
  }
  out.note = noteLines.length ? noteLines.join("\n").slice(0, 10_000) : null;
  return out;
}
