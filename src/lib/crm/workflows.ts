import { z } from "zod";

/**
 * Workflows (docs/features/crm.md, module 6): When / If / Then, as data.
 * Pure and client-safe: the builder draws from it, the server validates
 * every save with it, and the engine (src/server/crm/workflow-engine.ts)
 * matches events and checks conditions with the same functions, so the
 * builder's "this would run" and the engine always agree.
 *
 * A workflow's JSON columns:
 * - trigger: { type, params }  (CrmWorkflow.trigger)
 * - conditions: [{ field, op, value }]  (all must hold)
 * - actions: [{ type, params }]  (run in order)
 */

// ---- When ----------------------------------------------------------------------

export const TRIGGER_TYPES = [
  "record.created",
  "field.changed",
  "stage.changed",
  "form.submitted",
  "email.replied",
  "meeting.booked",
  "date.reached",
  "no.activity",
  "deal.stuck",
] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];

/** Triggers the daily job looks for (not events). */
export const SCHEDULED_TRIGGERS: readonly TriggerType[] = ["date.reached", "no.activity", "deal.stuck"];

export const WORKFLOW_OBJECTS = ["person", "company", "deal"] as const;
export type WorkflowObject = (typeof WORKFLOW_OBJECTS)[number];

export const TRIGGER_INFO: Record<TriggerType, { label: string; hint: string; objects: readonly WorkflowObject[] }> = {
  "record.created": { label: "Something is added", hint: "A person, company or item is added", objects: WORKFLOW_OBJECTS },
  "field.changed": { label: "A field changes", hint: "Any field, custom fields too", objects: WORKFLOW_OBJECTS },
  "stage.changed": { label: "An item moves stage", hint: "Into a stage, or won or lost", objects: ["deal"] },
  "form.submitted": { label: "A form is filled in", hint: "Someone answers one of your forms", objects: ["person"] },
  "email.replied": { label: "Someone replies", hint: "A reply to your email comes in", objects: ["person"] },
  "meeting.booked": { label: "A meeting is booked", hint: "Through a booking link", objects: ["person"] },
  "date.reached": { label: "A date comes", hint: "Days before or after a date field", objects: WORKFLOW_OBJECTS },
  "no.activity": { label: "Nothing happens for a while", hint: "No contact for some days", objects: WORKFLOW_OBJECTS },
  "deal.stuck": { label: "An item is stuck", hint: "In one stage too long", objects: ["deal"] },
};

const id = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
const fieldKey = z.string().min(1).max(80).regex(/^[A-Za-z0-9_.-]+$/);

export const triggerSchema = z
  .object({
    type: z.enum(TRIGGER_TYPES),
    params: z
      .object({
        object: z.enum(WORKFLOW_OBJECTS).optional(),
        pipelineId: id.nullable().optional(),
        field: fieldKey.optional(),
        toStageId: id.nullable().optional(),
        toKind: z.enum(["WON", "LOST"]).nullable().optional(),
        formId: id.nullable().optional(),
        /** no.activity and deal.stuck: how many days (deal.stuck defaults to the stage's own limit). */
        days: z.number().int().min(1).max(730).optional(),
        /** date.reached: negative is before the date, positive after. */
        offsetDays: z.number().int().min(-365).max(365).optional(),
      })
      .strict()
      .default({}),
  })
  .strict();
export type Trigger = z.infer<typeof triggerSchema>;

/** The object a trigger is about. */
export function triggerObject(t: Trigger): WorkflowObject {
  if (t.type === "stage.changed" || t.type === "deal.stuck") return "deal";
  if (t.type === "form.submitted" || t.type === "email.replied" || t.type === "meeting.booked") {
    return t.params.object ?? "person";
  }
  return t.params.object ?? "person";
}

// ---- If ---------------------------------------------------------------------------

export const CONDITION_OPS = [
  "is",
  "is_not",
  "contains",
  "not_contains",
  "empty",
  "not_empty",
  "gt",
  "gte",
  "lt",
  "lte",
  "any_of",
] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];

export const OP_LABELS: Record<ConditionOp, string> = {
  is: "is",
  is_not: "is not",
  contains: "contains",
  not_contains: "doesn't contain",
  empty: "is empty",
  not_empty: "is filled in",
  gt: "is more than",
  gte: "is at least",
  lt: "is less than",
  lte: "is at most",
  any_of: "is one of",
};

/** Ops that take no value. */
export const VALUELESS_OPS: readonly ConditionOp[] = ["empty", "not_empty"];

export const conditionSchema = z
  .object({
    field: fieldKey,
    op: z.enum(CONDITION_OPS),
    value: z.union([z.string().max(300), z.number(), z.boolean(), z.null()]).optional(),
  })
  .strict();
export type Condition = z.infer<typeof conditionSchema>;

/** A record as conditions read it: built-in keys and custom.<fieldId>, values plain. */
export type RecordValues = Record<string, unknown>;

function asText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(asText).join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.replace(/[$,\s]/g, ""));
    if (Number.isFinite(n)) return n;
    const t = Date.parse(v);
    if (!Number.isNaN(t) && /^\d{4}-\d{2}-\d{2}/.test(v)) return t;
  }
  return null;
}

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
}

/** One condition against a record. Unknown fields read as empty. */
export function conditionHolds(c: Condition, record: RecordValues): boolean {
  const actual = record[c.field];
  const want = c.value;
  switch (c.op) {
    case "empty":
      return isEmpty(actual);
    case "not_empty":
      return !isEmpty(actual);
    case "is":
    case "is_not": {
      const same = Array.isArray(actual)
        ? actual.map((x) => asText(x).toLowerCase()).includes(asText(want).toLowerCase())
        : typeof actual === "boolean" || typeof want === "boolean"
          ? String(actual ?? false) === String(want ?? false)
          : asNumber(actual) !== null && asNumber(want) !== null && typeof want === "number"
            ? asNumber(actual) === asNumber(want)
            : asText(actual).trim().toLowerCase() === asText(want).trim().toLowerCase();
      return c.op === "is" ? same : !same;
    }
    case "contains":
    case "not_contains": {
      const has = asText(actual).toLowerCase().includes(asText(want).toLowerCase());
      return c.op === "contains" ? has : !has;
    }
    case "any_of": {
      const options = asText(want)
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      const values = Array.isArray(actual) ? actual.map((x) => asText(x).toLowerCase()) : [asText(actual).toLowerCase()];
      return values.some((v) => options.includes(v));
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const a = asNumber(actual);
      const b = asNumber(want);
      if (a === null || b === null) return false;
      return c.op === "gt" ? a > b : c.op === "gte" ? a >= b : c.op === "lt" ? a < b : a <= b;
    }
  }
}

/** Every condition holds (none: always). */
export function conditionsHold(conditions: readonly Condition[], record: RecordValues): boolean {
  return conditions.every((c) => conditionHolds(c, record));
}

// ---- Then ---------------------------------------------------------------------------

export const ACTION_TYPES = [
  "task.create",
  "field.set",
  "stage.move",
  "owner.assign",
  "deal.create",
  "template.send",
  "sequence.enroll",
  "event.invite",
  "notify",
  "slack.post",
  "discord.post",
  "webhook.call",
  "finance.create",
  "project.start",
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export const ACTION_INFO: Record<ActionType, { label: string; hint: string; network?: boolean }> = {
  "task.create": { label: "Create a task", hint: "Linked to the record" },
  "field.set": { label: "Update a field", hint: "Set a value, or a date some days on" },
  "stage.move": { label: "Move to a stage", hint: "Items only" },
  "owner.assign": { label: "Assign an owner", hint: "Round-robin, fewest open, or one member" },
  "deal.create": { label: "Add to a pipeline", hint: "A new item for this person or company" },
  "template.send": { label: "Send a template", hint: "An email template, to the person" },
  "sequence.enroll": { label: "Enroll in a sequence", hint: "Timed emails that stop on reply" },
  "event.invite": { label: "Invite to an event", hint: "A meeting or event in Bananasplit" },
  notify: { label: "Notify someone", hint: "In their Inbox" },
  "slack.post": { label: "Post to Slack", hint: "Through a Slack webhook", network: true },
  "discord.post": { label: "Post to Discord", hint: "Through a Discord webhook", network: true },
  "webhook.call": { label: "Call a webhook", hint: "POST the record's ids to a URL", network: true },
  "finance.create": { label: "Create a Finance item", hint: "Money in or out, for a treasurer to check" },
  "project.start": { label: "Start a project", hint: "A project with tasks, an owner and files" },
};

const text = (max: number) => z.string().trim().max(max);
const httpsUrl = z
  .string()
  .trim()
  .max(500)
  .refine((u) => {
    try {
      return new URL(u).protocol === "https:";
    } catch {
      return false;
    }
  }, "Use an https:// address.");

export const ASSIGN_MODES = ["round_robin", "fewest", "member"] as const;
export type AssignMode = (typeof ASSIGN_MODES)[number];

export const actionSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("task.create"),
      params: z
        .object({
          title: text(200).min(1, "Give the task a title."),
          dueInDays: z.number().int().min(0).max(365).optional(),
          assignTo: z.enum(["owner", "member", "nobody"]).default("owner"),
          userId: id.optional(),
          priority: z.enum(["HIGH", "MEDIUM", "LOW"]).optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("field.set"),
      params: z.object({ field: fieldKey, value: z.union([z.string().max(300), z.number(), z.boolean(), z.null()]) }).strict(),
    })
    .strict(),
  z.object({ type: z.literal("stage.move"), params: z.object({ stageId: id }).strict() }).strict(),
  z
    .object({
      type: z.literal("owner.assign"),
      params: z
        .object({
          mode: z.enum(ASSIGN_MODES),
          /** Who takes turns (round-robin, fewest); empty: every member. */
          userIds: z.array(id).max(100).default([]),
          userId: id.optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("deal.create"),
      params: z.object({ pipelineId: id, stageId: id.optional(), title: text(200).optional() }).strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("template.send"),
      /** review: the email waits as a draft in Review for the owner instead of sending. */
      params: z.object({ templateId: id, review: z.boolean().optional() }).strict(),
    })
    .strict(),
  z.object({ type: z.literal("sequence.enroll"), params: z.object({ sequenceId: id }).strict() }).strict(),
  z.object({ type: z.literal("event.invite"), params: z.object({ eventId: id, review: z.boolean().optional() }).strict() }).strict(),
  z
    .object({
      type: z.literal("notify"),
      params: z
        .object({
          to: z.enum(["owner", "member", "managers"]).default("owner"),
          userId: id.optional(),
          message: text(300).min(1, "Say what the notice says."),
        })
        .strict(),
    })
    .strict(),
  z.object({ type: z.literal("slack.post"), params: z.object({ url: httpsUrl, message: text(1000).min(1) }).strict() }).strict(),
  z.object({ type: z.literal("discord.post"), params: z.object({ url: httpsUrl, message: text(1000).min(1) }).strict() }).strict(),
  z.object({ type: z.literal("webhook.call"), params: z.object({ url: httpsUrl }).strict() }).strict(),
  z
    .object({
      type: z.literal("finance.create"),
      params: z
        .object({
          direction: z.enum(["IN", "OUT"]),
          description: text(200).min(1, "Describe the Finance item."),
          /** Take the amount from the item; else `amount` in dollars. */
          amountFrom: z.enum(["item", "fixed"]).default("item"),
          amount: z.number().min(0).max(100_000_000).optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("project.start"),
      params: z
        .object({
          name: text(200).min(1, "Name the project."),
          tasks: z.array(text(200).min(1)).max(30).default([]),
          ownerFrom: z.enum(["owner", "member"]).default("owner"),
          userId: id.optional(),
          dueInDays: z.number().int().min(0).max(365).optional(),
          linkFiles: z.boolean().default(true),
        })
        .strict(),
    })
    .strict(),
]);
export type WorkflowAction = z.infer<typeof actionSchema>;

export const workflowInputSchema = z
  .object({
    name: z.string().trim().min(1, "Name the automation.").max(120),
    trigger: triggerSchema,
    conditions: z.array(conditionSchema).max(20).default([]),
    actions: z.array(actionSchema).min(1, "Add at least one step under Then.").max(20),
  })
  .strict();
export type WorkflowInput = z.infer<typeof workflowInputSchema>;

/** Reads a stored workflow's JSON, dropping what no longer parses (never throws). */
export function readWorkflow(row: { trigger: unknown; conditions: unknown; actions: unknown }): {
  trigger: Trigger | null;
  conditions: Condition[];
  actions: WorkflowAction[];
} {
  const t = triggerSchema.safeParse(row.trigger);
  const conditions = Array.isArray(row.conditions)
    ? row.conditions.flatMap((c) => {
        const p = conditionSchema.safeParse(c);
        return p.success ? [p.data] : [];
      })
    : [];
  const actions = Array.isArray(row.actions)
    ? row.actions.flatMap((a) => {
        const p = actionSchema.safeParse(a);
        return p.success ? [p.data] : [];
      })
    : [];
  return { trigger: t.success ? t.data : null, conditions, actions };
}

// ---- Matching events ----------------------------------------------------------------

/** What the engine knows about an event when it matches triggers (events.ts payload, plus a little). */
export interface MatchEvent {
  type: "record.changed" | "email.replied" | "email.bounced" | "meeting.booked" | "form.submitted" | "sequence.finished" | "call.logged" | "activity.logged";
  targetKind: WorkflowObject;
  fields: readonly string[];
  /** The workflow whose own action made this change, if one did. */
  workflowId?: string | null;
  /** How many automations deep this change is. */
  depth?: number;
}

/** What the engine read about the record (for pipeline, stage and form checks). */
export interface MatchRecord {
  pipelineId?: string | null;
  stageId?: string | null;
  stageKind?: "OPEN" | "WON" | "LOST" | null;
  formId?: string | null;
}

/** A builder field key to the name field history records it under. */
export function historyKey(object: WorkflowObject, key: string): string {
  if (key.startsWith("custom.")) return key;
  const map: Record<string, string> =
    object === "deal"
      ? { owner: "ownerId", amount: "amountCents", company: "companyId", person: "primaryPersonId", stage: "stageId" }
      : object === "person"
        ? { owner: "ownerId", company: "companyId" }
        : { owner: "ownerId" };
  return map[key] ?? key;
}

/** Does this event set off this trigger? (Scheduled triggers never match events.) */
export function triggerMatches(trigger: Trigger, event: MatchEvent, record: MatchRecord = {}): boolean {
  const p = trigger.params;
  const object = triggerObject(trigger);
  if (event.targetKind !== object) return false;
  if (object === "deal" && p.pipelineId && record.pipelineId !== p.pipelineId) return false;
  switch (trigger.type) {
    case "record.created":
      return event.type === "record.changed" && event.fields.includes("created");
    case "field.changed":
      return (
        event.type === "record.changed" &&
        !event.fields.includes("created") &&
        Boolean(p.field) &&
        event.fields.includes(historyKey(object, p.field!))
      );
    case "stage.changed":
      if (event.type !== "record.changed" || !event.fields.includes("stageId")) return false;
      if (p.toStageId && record.stageId !== p.toStageId) return false;
      if (p.toKind && record.stageKind !== p.toKind) return false;
      return true;
    case "form.submitted":
      if (event.type !== "form.submitted") return false;
      return !p.formId || record.formId === p.formId;
    case "email.replied":
      return event.type === "email.replied";
    case "meeting.booked":
      return event.type === "meeting.booked";
    default:
      return false;
  }
}

// ---- Loop protection ----------------------------------------------------------------

/** Most runs of one workflow on one record in an hour. */
export const RUN_CAP_PER_TARGET_PER_HOUR = 5;
/** An automation's change may set off another automation, this many deep at most. */
export const MAX_CHAIN_DEPTH = 3;

/**
 * Whether an event may start this workflow: a change one of its own steps
 * made never starts it again, and a chain of automations stops at
 * MAX_CHAIN_DEPTH (the hourly run cap backs both up).
 */
export function loopAllows(event: Pick<MatchEvent, "workflowId" | "depth">, workflowId: string): boolean {
  if (event.workflowId && event.workflowId === workflowId) return false;
  return (event.depth ?? 0) < MAX_CHAIN_DEPTH;
}

/** Under the hourly cap? `recentRuns` counts this workflow's runs on this record in the last hour. */
export function underRunCap(recentRuns: number): boolean {
  return recentRuns < RUN_CAP_PER_TARGET_PER_HOUR;
}

// ---- Fields ---------------------------------------------------------------------------

/** A field the builder offers, for conditions and for Update a field. */
export interface WorkflowField {
  key: string;
  label: string;
  kind: "text" | "number" | "date" | "bool" | "member" | "stage" | "status" | "relationship" | "forecast";
  /** Update a field may set it. */
  settable: boolean;
}

const F = (key: string, label: string, kind: WorkflowField["kind"], settable = true): WorkflowField => ({ key, label, kind, settable });

export const WORKFLOW_FIELDS: Record<WorkflowObject, readonly WorkflowField[]> = {
  person: [
    F("name", "Name", "text"),
    F("title", "Title", "text"),
    F("primaryEmail", "Email", "text", false),
    F("phone", "Phone", "text"),
    F("company", "Company", "text", false),
    F("relationship", "Relationship", "relationship"),
    F("status", "Status", "status"),
    F("owner", "Owner", "member"),
    F("source", "Source", "text"),
    F("location", "Location", "text"),
    F("nextFollowUpAt", "Next follow-up", "date"),
    F("lastContactedAt", "Last contacted", "date", false),
    F("keepInTouchDays", "Keep in touch every (days)", "number"),
    F("doNotContact", "Do not contact", "bool"),
    F("strength", "Relationship strength", "number", false),
    F("score", "Score", "number", false),
  ],
  company: [
    F("name", "Name", "text"),
    F("domain", "Domain", "text"),
    F("industry", "Industry", "text"),
    F("size", "Size", "text"),
    F("status", "Status", "status"),
    F("owner", "Owner", "member"),
    F("nextFollowUpAt", "Next follow-up", "date"),
    F("lastContactedAt", "Last contacted", "date", false),
    F("strength", "Relationship strength", "number", false),
    F("score", "Score", "number", false),
  ],
  deal: [
    F("title", "Title", "text"),
    F("stage", "Stage", "stage", false),
    F("amount", "Amount", "number"),
    F("expectedOn", "Expected", "date"),
    F("owner", "Owner", "member"),
    F("company", "Company", "text", false),
    F("person", "Person", "text", false),
    F("nextStep", "Next step", "text"),
    F("nextStepAt", "Next step by", "date"),
    F("forecastCategory", "Forecast", "forecast"),
    F("closeReason", "Reason", "text"),
    F("source", "Source", "text"),
    F("score", "Score", "number", false),
  ],
};

// ---- Helpers the actions share --------------------------------------------------------

/**
 * A field.set value: "+3d" / "-2d" / "today" become a date that many days
 * from `now` (yyyy-mm-dd); anything else stays as given.
 */
export function resolveValue(value: string | number | boolean | null, now: Date): string | number | boolean | null {
  if (typeof value !== "string") return value;
  const v = value.trim();
  if (v === "today") return now.toISOString().slice(0, 10);
  const m = /^([+-])(\d{1,3})d$/i.exec(v);
  if (m) {
    const days = Number(m[2]) * (m[1] === "-" ? -1 : 1);
    return new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10);
  }
  return value;
}

/** The member whose turn it is: the run count cycles through the list. */
export function roundRobinPick(candidates: readonly string[], turn: number): string | null {
  if (candidates.length === 0) return null;
  const i = ((turn % candidates.length) + candidates.length) % candidates.length;
  return candidates[i] ?? null;
}

/** The member with the fewest open items (ties: the list's order). */
export function fewestPick(candidates: readonly string[], openCounts: ReadonlyMap<string, number>): string | null {
  let best: string | null = null;
  let bestCount = Infinity;
  for (const c of candidates) {
    const n = openCounts.get(c) ?? 0;
    if (n < bestCount) {
      best = c;
      bestCount = n;
    }
  }
  return best;
}

/** Merge fields in a message: {name}, {title}, {stage}, {company}, {owner}, {amount}, {pipeline}, {link}, {days}. */
export function renderMessage(template: string, values: Record<string, string | number | null | undefined>): string {
  return template.replace(/\{([a-z_]+)\}/gi, (whole, key: string) => {
    const v = values[key.toLowerCase()];
    return v === undefined || v === null ? (key.toLowerCase() in values ? "" : whole) : String(v);
  });
}

export const MERGE_FIELDS = ["name", "title", "stage", "company", "owner", "amount", "pipeline", "link", "days"] as const;

/** One line describing a workflow, for lists: "When an item moves stage: create a task, notify someone". */
export function describeWorkflow(input: { trigger: Trigger | null; actions: readonly WorkflowAction[] }): string {
  const when = input.trigger ? TRIGGER_INFO[input.trigger.type].label : "Never";
  const then = input.actions.map((a) => ACTION_INFO[a.type].label.toLowerCase());
  return `When ${when.charAt(0).toLowerCase()}${when.slice(1)}: ${then.join(", ") || "nothing yet"}`;
}

/** The run log's entries (CrmWorkflowRun.log). */
export interface RunLogEntry {
  action: ActionType | "trigger" | "conditions";
  ok: boolean;
  detail: string;
  /** A network step waiting on its job. */
  queued?: boolean;
}
