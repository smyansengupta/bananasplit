/**
 * Outreach plans (docs/features/crm.md, "Redesign", Outreach): to the
 * person there is one kind of thing, a plan, whether it is a sequence
 * (timed steps that stop when they reply), a list split among members, or
 * one email to everyone on a list (a one-step plan). This is the pure part:
 * statuses in words, the step list the card edits (waits drawn as their own
 * steps), the little preview on each plan in the list, who a plan is for
 * as plain-language chips, results as bars, and the plan's own settings
 * kept beside a sequence's send window. Client-safe.
 */

export type PlanStatus = "draft" | "running" | "paused" | "done";

export const PLAN_STATUS_LABEL: Record<PlanStatus, string> = {
  draft: "Draft",
  running: "Running",
  paused: "Paused",
  done: "Done",
};

export function sequencePlanStatus(status: string): PlanStatus {
  return status === "ON" ? "running" : status === "OFF" ? "paused" : "draft";
}

export function campaignPlanStatus(status: string): PlanStatus {
  return status === "ACTIVE"
    ? "running"
    : status === "DONE" || status === "ARCHIVED"
      ? "done"
      : "draft";
}

// ---------------------------------------------------------------- steps

/** A step as stored (CrmSequenceStep): its wait is on the step itself. */
export interface StoredStep {
  kind: string;
  delayDays: number;
  delayHours: number;
  subject: string | null;
  body: string | null;
  templateId: string | null;
  taskTitle: string | null;
}

export type UiStepKind = "email" | "wait" | "text" | "task" | "call" | "linkedin";

/** A step as the plan card shows it: a wait is its own step between the others. */
export interface UiStep {
  key: string;
  kind: UiStepKind;
  /** A wait's length. */
  days?: number;
  hours?: number;
  subject?: string;
  body?: string;
  /** A task, call or LinkedIn step's title. */
  title?: string;
  templateId?: string | null;
}

const STORED_TO_UI: Record<string, UiStepKind> = {
  EMAIL: "email",
  TEXT: "text",
  TASK: "task",
  CALL: "call",
  LINKEDIN: "linkedin",
};

const UI_TO_STORED: Record<Exclude<UiStepKind, "wait">, string> = {
  email: "EMAIL",
  text: "TEXT",
  task: "TASK",
  call: "CALL",
  linkedin: "LINKEDIN",
};

let seq = 0;
/** A key for a step made in the browser. */
export function stepKey(prefix = "s"): string {
  seq += 1;
  return `${prefix}${Date.now().toString(36)}${seq}`;
}

/** Stored steps as the card's list: each delay becomes a wait before its step. */
export function stepsToUi(steps: readonly StoredStep[]): UiStep[] {
  const out: UiStep[] = [];
  steps.forEach((s, i) => {
    if (s.delayDays > 0 || s.delayHours > 0) {
      out.push({ key: `w${i}`, kind: "wait", days: s.delayDays, hours: s.delayHours });
    }
    const kind = STORED_TO_UI[s.kind] ?? "task";
    out.push({
      key: `s${i}`,
      kind,
      subject: s.subject ?? "",
      body: s.body ?? "",
      title: s.taskTitle ?? "",
      templateId: s.templateId,
    });
  });
  return out;
}

/** The card's list back as stored steps: waits fold into the step after them. */
export function uiToSteps(ui: readonly UiStep[]): StoredStep[] {
  const out: StoredStep[] = [];
  let days = 0;
  let hours = 0;
  for (const s of ui) {
    if (s.kind === "wait") {
      days += Math.max(0, Math.round(s.days ?? 0));
      hours += Math.max(0, Math.round(s.hours ?? 0));
      continue;
    }
    days += Math.floor(hours / 24);
    hours %= 24;
    out.push({
      kind: UI_TO_STORED[s.kind],
      delayDays: Math.min(days, 365),
      delayHours: hours,
      subject: s.kind === "email" ? (s.subject ?? "") : null,
      body: s.kind === "email" || s.kind === "text" ? (s.body ?? "") : null,
      templateId: s.kind === "email" ? (s.templateId ?? null) : null,
      taskTitle: s.kind === "email" ? null : s.title?.trim() || null,
    });
    days = 0;
    hours = 0;
  }
  return out;
}

/** "Day 0", "Day 3": when each step that does something happens, counted from the start. */
export function stepDays(ui: readonly UiStep[]): (number | null)[] {
  let day = 0;
  return ui.map((s) => {
    if (s.kind === "wait") {
      day += Math.max(0, s.days ?? 0) + Math.floor(Math.max(0, s.hours ?? 0) / 24);
      return null;
    }
    return day;
  });
}

const STEP_TITLE: Record<UiStepKind, string> = {
  email: "Email",
  wait: "Wait",
  text: "Text",
  task: "Task",
  call: "Call",
  linkedin: "LinkedIn",
};

/** A step's heading on the card: "Email", "Wait 3 days", "Text if no reply", "Task: call". */
export function stepTitle(step: UiStep, after: UiStep | null = null): string {
  if (step.kind === "wait") {
    const d = step.days ?? 0;
    const h = step.hours ?? 0;
    if (d === 0 && h > 0) return `Wait ${h} ${h === 1 ? "hour" : "hours"}`;
    return `Wait ${d} ${d === 1 ? "day" : "days"}`;
  }
  const followsWait = after?.kind === "wait";
  if (step.kind === "text") return followsWait ? "Text if no reply" : "Text";
  if (step.kind === "email") return followsWait ? "Email if no reply" : "Email";
  if (step.kind === "call") return "Task: call";
  if (step.kind === "linkedin") return "Task: LinkedIn";
  return step.title?.trim() ? `Task: ${step.title.trim()}` : "Task";
}

export interface StepPreview {
  what: string;
  when: string;
  kind: Exclude<UiStepKind, "wait">;
}

/** The first few steps for a plan's card in the list: what each does and on which day. */
export function previewOf(steps: readonly StoredStep[], max = 3): StepPreview[] {
  const ui = stepsToUi(steps);
  const days = stepDays(ui);
  const out: StepPreview[] = [];
  ui.forEach((s, i) => {
    if (s.kind === "wait" || out.length >= max) return;
    const what =
      s.kind === "email"
        ? s.subject?.trim() || "Email"
        : s.kind === "text"
          ? "Text"
          : s.title?.trim() || STEP_TITLE[s.kind];
    out.push({
      what: what.length > 34 ? `${what.slice(0, 33).trimEnd()}…` : what,
      when: `Day ${days[i]}`,
      kind: s.kind,
    });
  });
  return out;
}

/** A text that would go out as more than one message. */
export const TEXT_LIMIT = 160;

export function textTooLong(body: string | null | undefined): boolean {
  return (body ?? "").trim().length > TEXT_LIMIT;
}

/**
 * A long text cut to whole sentences that fit in one message (the first
 * sentence cut at a word when even it is too long). Never adds words.
 */
export function shortenText(body: string, limit = TEXT_LIMIT): string {
  const text = body.replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;
  const sentences = text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [text];
  let out = "";
  for (const s of sentences) {
    const next = `${out}${s}`.trimEnd();
    if (next.length > limit) break;
    out = `${next} `;
  }
  out = out.trim();
  if (out) return out;
  const cut = text.slice(0, limit - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > 40 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

// ---------------------------------------------------------------- the list

export interface PlanFilter {
  status?: PlanStatus | null;
  q?: string | null;
}

/** Plans matching the Filters pick and the search (name or who it's for). */
export function filterPlans<T extends { name: string; status: PlanStatus; who: string }>(
  plans: readonly T[],
  { status, q }: PlanFilter,
): T[] {
  const words = (q ?? "").trim().toLowerCase();
  return plans.filter(
    (p) =>
      (!status || p.status === status) &&
      (!words || p.name.toLowerCase().includes(words) || p.who.toLowerCase().includes(words)),
  );
}

/** Running first, then drafts, paused, done; newest first within each. */
export function sortPlans<T extends { status: PlanStatus; updatedAt: string }>(
  plans: readonly T[],
): T[] {
  const rank: Record<PlanStatus, number> = { running: 0, draft: 1, paused: 2, done: 3 };
  return [...plans].sort(
    (a, b) => rank[a.status] - rank[b.status] || b.updatedAt.localeCompare(a.updatedAt),
  );
}

// ---------------------------------------------------------------- results

export interface FunnelBar {
  label: string;
  n: number;
  /** Of the row before it, as "34%"; empty for the first. */
  pct: string;
  /** Width against the first row, 0 to 1. */
  share: number;
}

/** Sent, opened, replied as bars, each a share of the first. */
export function funnel(rows: readonly { label: string; n: number }[]): FunnelBar[] {
  const top = Math.max(1, rows[0]?.n ?? 0);
  return rows.map((r, i) => {
    const before = i === 0 ? null : rows[0]!.n;
    return {
      label: r.label,
      n: r.n,
      pct: before === null || before === 0 ? "" : `${Math.round((r.n / before) * 100)}%`,
      share: Math.min(1, r.n / top),
    };
  });
}

// ---------------------------------------------------------------- who and settings

/** Who a plan is for: the People page's own filters (a list's, src/server/crm/outreach/lists.ts). */
export interface Audience {
  relationship?: string | null;
  status?: "ACTIVE" | "INACTIVE" | "ALUMNI" | "all" | null;
  /** "me", "none" or a member id. */
  owner?: string | null;
  due?: "due" | "cold" | "new" | null;
}

export type AudienceKey = keyof Audience;

export interface AudienceChip {
  key: AudienceKey;
  value: string;
  label: string;
}

const DUE_WORDS: Record<string, string> = {
  due: "due for a follow-up",
  cold: "gone quiet",
  new: "added this week",
};

const STATUS_WORDS: Record<string, string> = {
  ACTIVE: "active",
  INACTIVE: "inactive",
  ALUMNI: "past members",
  all: "active or not",
};

/** The audience as chips: "Donors", "gone quiet", "mine". */
export function audienceChips(
  a: Audience,
  names: { relationships: ReadonlyMap<string, string>; members: ReadonlyMap<string, string> },
): AudienceChip[] {
  const out: AudienceChip[] = [];
  if (a.relationship) {
    out.push({
      key: "relationship",
      value: a.relationship,
      label: names.relationships.get(a.relationship) ?? "a relationship type",
    });
  }
  if (a.status && a.status !== "ACTIVE") {
    out.push({ key: "status", value: a.status, label: STATUS_WORDS[a.status] ?? a.status });
  }
  if (a.due) out.push({ key: "due", value: a.due, label: DUE_WORDS[a.due] ?? a.due });
  if (a.owner) {
    out.push({
      key: "owner",
      value: a.owner,
      label:
        a.owner === "me"
          ? "mine"
          : a.owner === "none"
            ? "with no owner"
            : `owned by ${names.members.get(a.owner) ?? "a member"}`,
    });
  }
  return out;
}

/** A few filters not set yet, offered as dashed "+" chips. */
export function audienceOffers(
  a: Audience,
  relationships: readonly { id: string; label: string }[],
): AudienceChip[] {
  const out: AudienceChip[] = [];
  if (!a.relationship) {
    for (const r of relationships.slice(0, 3))
      out.push({ key: "relationship", value: r.id, label: r.label });
  }
  if (!a.due) {
    out.push({ key: "due", value: "cold", label: DUE_WORDS.cold! });
    out.push({ key: "due", value: "due", label: DUE_WORDS.due! });
  }
  if (!a.owner) out.push({ key: "owner", value: "me", label: "mine" });
  return out;
}

/** Whether an audience picks anyone out (an empty one is everyone active). */
export function audienceSet(a: Audience): boolean {
  return Boolean(a.relationship || a.owner || a.due || (a.status && a.status !== "ACTIVE"));
}

export type PlanFrom = "owner" | "me";

/** What a plan keeps beside a sequence's send window: who sends, a daily cap, who it's for. */
export interface PlanExtras {
  from: PlanFrom;
  /** Most of this plan's emails a day; null is the organization's own cap. */
  dailyCap: number | null;
  who: Audience;
  /** People let in although another plan has them. */
  include: string[];
}

export const DEFAULT_EXTRAS: PlanExtras = { from: "me", dailyCap: null, who: {}, include: [] };

const DUE = new Set(["due", "cold", "new"]);
const STATUS = new Set(["ACTIVE", "INACTIVE", "ALUMNI", "all"]);
const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** A plan's extras from a sequence's stored send window (`plan` key), cleaned. */
export function readExtras(sendWindow: unknown): PlanExtras {
  const raw =
    sendWindow && typeof sendWindow === "object"
      ? ((sendWindow as Record<string, unknown>).plan as Record<string, unknown> | undefined)
      : undefined;
  if (!raw || typeof raw !== "object") return { ...DEFAULT_EXTRAS, who: {}, include: [] };
  const who = (raw.who && typeof raw.who === "object" ? raw.who : {}) as Record<string, unknown>;
  const cap = Number(raw.dailyCap);
  const str = (v: unknown) => (typeof v === "string" && ID.test(v) ? v : null);
  return {
    from: raw.from === "owner" ? "owner" : "me",
    dailyCap: Number.isInteger(cap) && cap >= 1 ? Math.min(cap, 2000) : null,
    who: {
      relationship: str(who.relationship),
      owner: str(who.owner),
      due: typeof who.due === "string" && DUE.has(who.due) ? (who.due as Audience["due"]) : null,
      status:
        typeof who.status === "string" && STATUS.has(who.status)
          ? (who.status as Audience["status"])
          : null,
    },
    include: Array.isArray(raw.include)
      ? raw.include.filter((v): v is string => typeof v === "string" && ID.test(v)).slice(0, 500)
      : [],
  };
}

/** A send window with the plan's extras put back under `plan`. */
export function withExtras(sendWindow: unknown, extras: PlanExtras): Record<string, unknown> {
  const base =
    sendWindow && typeof sendWindow === "object"
      ? { ...(sendWindow as Record<string, unknown>) }
      : {};
  const who: Record<string, string> = {};
  for (const [k, v] of Object.entries(extras.who)) if (v) who[k] = v;
  return {
    ...base,
    plan: {
      from: extras.from,
      dailyCap: extras.dailyCap,
      who,
      include: [...new Set(extras.include)].slice(0, 500),
    },
  };
}

/** The daily cap stepper: steps of 10, between 10 and 200. */
export function stepCap(cap: number | null, by: number, orgCap: number): number {
  const from = cap ?? Math.min(orgCap, 200);
  return Math.min(200, Math.max(10, Math.round((from + by) / 10) * 10));
}
