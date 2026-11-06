import { z } from "zod";

/**
 * The review queue's suggestions (docs/features/crm.md, "One review queue
 * for every AI change"): what each kind proposes, checked with zod on the
 * way in (proposeChange) and again before it is applied (acceptSuggestion),
 * and how a person sees it as a before and after. Pure and client-safe.
 *
 * Every AI change, automation proposal, connected-app write and email-
 * sourced suggestion is one CrmSuggestion row: a kind, a payload, the
 * record it is about (targetKind/targetId) and its citation (the meeting,
 * email, form, file, page or conversation it came from). Duplicates
 * (MERGE) keep their own page and are not in this queue.
 */

export const QUEUE_KINDS = [
  "CREATE_PERSON",
  "CREATE_COMPANY",
  "UPDATE_FIELD",
  "MOVE_STAGE",
  "LOG_ACTIVITY",
  "DRAFT_EMAIL",
  "CREATE_TASK",
] as const;
export type QueueKind = (typeof QUEUE_KINDS)[number];

export const SUGGESTION_SOURCES = ["AI", "AUTOMATION", "CONNECTOR", "EMAIL", "IMPORT", "DEDUPE", "SIGNAL"] as const;
export type SuggestionSource = (typeof SUGGESTION_SOURCES)[number];

export const KIND_LABELS: Record<QueueKind, string> = {
  CREATE_PERSON: "New person",
  CREATE_COMPANY: "New company",
  UPDATE_FIELD: "Change",
  MOVE_STAGE: "Stage move",
  LOG_ACTIVITY: "Log to the timeline",
  DRAFT_EMAIL: "Email draft",
  CREATE_TASK: "Task",
};

export const SOURCE_LABELS: Record<SuggestionSource, string> = {
  AI: "AI",
  AUTOMATION: "Automation",
  CONNECTOR: "Connected app",
  EMAIL: "Email",
  IMPORT: "Import",
  DEDUPE: "Duplicates",
  SIGNAL: "Signal",
};

export const TARGET_KINDS = ["person", "company", "deal"] as const;
export type TargetKind = (typeof TARGET_KINDS)[number];

const ID = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const shortText = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));
const dayKey = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullish()
  .transform((v) => v ?? null);

export const targetRef = z.object({ kind: z.enum(TARGET_KINDS), id: ID });
export type TargetRef = z.infer<typeof targetRef>;

/** Where a suggestion came from: a meeting, an email, a form, a file, a web page, a pasted chat. */
export const citationSchema = z.object({
  kind: z.enum([
    "meeting",
    "email",
    "form",
    "file",
    "transcript",
    "conversation",
    "card",
    "web",
    "record",
    "connector",
    "agent",
    "automation",
    "member",
  ]),
  label: z.string().trim().max(200),
  id: z.string().max(100).nullish(),
  url: z.string().max(1000).nullish(),
  /** A short quote from the source that supports it. */
  quote: z.string().max(400).nullish(),
});
export type Citation = z.infer<typeof citationSchema>;

/** Values a person can be made with (the review queue shows each). */
export const newPersonValues = z.object({
  name: shortText(200),
  primaryEmail: optionalText(254),
  phone: optionalText(60),
  title: optionalText(200),
  companyName: optionalText(200),
  linkedinUrl: optionalText(500),
  website: optionalText(500),
  location: optionalText(200),
});
export type NewPersonValues = z.infer<typeof newPersonValues>;

export const newCompanyValues = z.object({
  name: shortText(200),
  domain: optionalText(200),
  website: optionalText(500),
  industry: optionalText(200),
  size: optionalText(60),
  address: optionalText(500),
  description: optionalText(2000),
});
export type NewCompanyValues = z.infer<typeof newCompanyValues>;

const activityKinds = z.enum(["NOTE", "MEETING", "CALL", "EMAIL", "TEXT"]);

export const activityPayload = z.object({
  kind: activityKinds,
  subject: optionalText(500),
  body: optionalText(20_000),
  /** ISO instant; now when absent. */
  occurredAt: z.string().max(40).nullish(),
  direction: z.enum(["INBOUND", "OUTBOUND"]).nullish(),
  targets: z.array(targetRef).max(20).default([]),
});
export type ActivityPayload = z.infer<typeof activityPayload>;

export const taskPayload = z.object({
  title: shortText(200),
  description: optionalText(4000),
  dueDate: dayKey,
  /** A member's user id; nobody when null. */
  ownerId: ID.nullish().transform((v) => v ?? null),
  /** "They'll confirm budget in March": also sets the record's next follow-up. */
  followUp: z.boolean().default(false),
  /** Who made the promise: "us" ("I'll send the deck") or "them" ("they'll confirm"). */
  promiseBy: z.enum(["us", "them"]).nullish(),
});
export type TaskPayload = z.infer<typeof taskPayload>;

export const fieldChange = z.object({
  /** A built-in key ("title") or "custom.<fieldId>". */
  field: z.string().regex(/^(custom\.[A-Za-z0-9_-]{1,64}|[A-Za-z][A-Za-z0-9]{0,40})$/),
  label: z.string().max(120),
  before: z.unknown().optional(),
  after: z.unknown(),
});
export type FieldChange = z.infer<typeof fieldChange>;

export const PAYLOADS = {
  CREATE_PERSON: z.object({
    person: newPersonValues,
    /** Logged on them once they are made (a pasted conversation, a card's notes). */
    activity: activityPayload.omit({ targets: true }).nullish(),
    /** Their next step, made as a task linked to them. */
    task: taskPayload.nullish(),
  }),
  CREATE_COMPANY: z.object({ company: newCompanyValues }),
  UPDATE_FIELD: z.object({ changes: z.array(fieldChange).min(1).max(40) }),
  MOVE_STAGE: z.object({
    stageId: ID,
    stageName: z.string().max(200),
    fromStageName: z.string().max(200).nullish(),
    closeReason: optionalText(2000),
  }),
  LOG_ACTIVITY: activityPayload,
  DRAFT_EMAIL: z.object({
    to: z.array(z.string().trim().max(254)).max(20),
    subject: shortText(300),
    body: shortText(20_000),
    /** Why it was drafted ("No reply in 40 days"). */
    why: optionalText(500),
    /** The unsent draft waiting in compose (src/server/crm/drafts.ts). */
    draftId: ID.nullish().transform((v) => v ?? null),
  }),
  CREATE_TASK: taskPayload,
} satisfies Record<QueueKind, z.ZodType>;

export type PayloadOf<K extends QueueKind> = z.infer<(typeof PAYLOADS)[K]>;

/** A payload as stored: what accepting it did, for Undo. */
export interface Applied {
  batchId?: string | null;
  createdKind?: TargetKind | null;
  createdId?: string | null;
  activityId?: string | null;
  taskId?: string | null;
  threadId?: string | null;
  at: string;
}

/** The payload for `kind`, parsed; throws a ZodError when it doesn't fit. */
export function parsePayload<K extends QueueKind>(kind: K, payload: unknown): PayloadOf<K> {
  return PAYLOADS[kind].parse(payload) as PayloadOf<K>;
}

export function isQueueKind(value: unknown): value is QueueKind {
  return typeof value === "string" && (QUEUE_KINDS as readonly string[]).includes(value);
}

/** One line of the before and after a reviewer reads. */
export interface DiffRow {
  label: string;
  before: string | null;
  after: string;
}

function text(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map((x) => text(x) ?? "").filter(Boolean).join(", ") || null;
  return JSON.stringify(v);
}

const PERSON_LABELS: Record<keyof NewPersonValues, string> = {
  name: "Name",
  primaryEmail: "Email",
  phone: "Phone",
  title: "Title",
  companyName: "Company",
  linkedinUrl: "LinkedIn",
  website: "Website",
  location: "Location",
};

const COMPANY_LABELS: Record<keyof NewCompanyValues, string> = {
  name: "Name",
  domain: "Domain",
  website: "Website",
  industry: "Industry",
  size: "Size",
  address: "Address",
  description: "About",
};

/** The before and after of a suggestion, as rows. */
export function diffRows(kind: QueueKind, payload: unknown): DiffRow[] {
  const parsed = PAYLOADS[kind].safeParse(payload);
  if (!parsed.success) return [];
  switch (kind) {
    case "CREATE_PERSON": {
      const p = parsed.data as PayloadOf<"CREATE_PERSON">;
      const rows: DiffRow[] = [];
      for (const [k, label] of Object.entries(PERSON_LABELS) as [keyof NewPersonValues, string][]) {
        const v = text(p.person[k]);
        if (v) rows.push({ label, before: null, after: v });
      }
      if (p.activity) rows.push({ label: "Timeline", before: null, after: p.activity.subject ?? p.activity.body ?? "A note" });
      if (p.task) rows.push({ label: "Next step", before: null, after: taskLine(p.task) });
      return rows;
    }
    case "CREATE_COMPANY": {
      const c = (parsed.data as PayloadOf<"CREATE_COMPANY">).company;
      return (Object.entries(COMPANY_LABELS) as [keyof NewCompanyValues, string][])
        .map(([k, label]) => ({ label, before: null, after: text(c[k]) ?? "" }))
        .filter((r) => r.after);
    }
    case "UPDATE_FIELD":
      return (parsed.data as PayloadOf<"UPDATE_FIELD">).changes.map((c) => ({
        label: c.label,
        before: text(c.before),
        after: text(c.after) ?? "Empty",
      }));
    case "MOVE_STAGE": {
      const m = parsed.data as PayloadOf<"MOVE_STAGE">;
      const rows: DiffRow[] = [{ label: "Stage", before: m.fromStageName ?? null, after: m.stageName }];
      if (m.closeReason) rows.push({ label: "Reason", before: null, after: m.closeReason });
      return rows;
    }
    case "LOG_ACTIVITY": {
      const a = parsed.data as PayloadOf<"LOG_ACTIVITY">;
      return [
        { label: ACTIVITY_LABELS[a.kind], before: null, after: [a.subject, a.body].filter(Boolean).join("\n\n") || "No text" },
      ];
    }
    case "DRAFT_EMAIL": {
      const d = parsed.data as PayloadOf<"DRAFT_EMAIL">;
      return [
        { label: "To", before: null, after: d.to.join(", ") || "Nobody yet" },
        { label: "Subject", before: null, after: d.subject },
        { label: "Message", before: null, after: d.body },
      ];
    }
    case "CREATE_TASK":
      return [{ label: "Task", before: null, after: taskLine(parsed.data as PayloadOf<"CREATE_TASK">) }];
  }
}

export const ACTIVITY_LABELS: Record<z.infer<typeof activityKinds>, string> = {
  NOTE: "Note",
  MEETING: "Meeting",
  CALL: "Call",
  EMAIL: "Email",
  TEXT: "Message",
};

function taskLine(t: TaskPayload): string {
  const due = t.dueDate
    ? ` by ${new Date(`${t.dueDate}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`
    : "";
  return `${t.title}${due}${t.followUp ? " (follow-up)" : ""}`;
}

/** History's source for a suggestion's source (CrmFieldHistory.source). */
export function historySourceOf(source: SuggestionSource): "ai" | "connector" | "automation" | "import" | "system" {
  switch (source) {
    case "AI":
      return "ai";
    case "CONNECTOR":
      return "connector";
    case "AUTOMATION":
      return "automation";
    case "IMPORT":
      return "import";
    default:
      return "system";
  }
}

/**
 * Whether a connected app's write may apply at once rather than wait for a
 * person (docs/features/crm.md, MCP): only on a WRITE grant, and only the
 * low-risk kinds (logging activity, adding a note). Field changes, stage
 * moves, new records and drafts always queue.
 */
export function connectorAppliesDirectly(kind: QueueKind, access: "READ" | "WRITE"): boolean {
  return access === "WRITE" && kind === "LOG_ACTIVITY";
}
