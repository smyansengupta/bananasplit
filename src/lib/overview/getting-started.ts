/**
 * "Get your club started" (the Overview, for owners and admins): a new
 * club's first steps. Each step is done when the club has the thing (worked
 * out from its data, never stored), or when an admin checks it off as not
 * needed (OrgSettings.startedSkipped). Once every step is one or the other,
 * the card goes away by itself. Pure and client-safe.
 */

export const STARTED_STEP_KEYS = [
  "picture",
  "members",
  "event",
  "types",
  "task",
  "teams",
  "budget",
  "database",
] as const;

export type StartedStepKey = (typeof STARTED_STEP_KEYS)[number];

/** What the club already has, step by step. */
export type StartedState = Record<StartedStepKey, boolean>;

export interface StartedStep {
  key: StartedStepKey;
  label: string;
  /** One line on why, under the label. */
  hint: string;
  /** Under /app/{slug}. */
  path: string;
  /** A suggestion, not a must: says so beside the label. */
  recommended?: boolean;
}

/**
 * Paths starting "/onboarding/" are whole (a setup page that returns to the
 * Overview when it's done); the rest are under /app/{slug}.
 */
export const STARTED_STEPS: readonly StartedStep[] = [
  {
    key: "picture",
    label: "Add a picture",
    hint: "Your logo on the sidebar, invites and sign-up pages.",
    path: "/onboarding/organization/{slug}/picture",
  },
  {
    key: "members",
    label: "Invite your members",
    hint: "Share the link, or send emails.",
    path: "/settings/members",
  },
  {
    key: "event",
    label: "Put your first meeting on the calendar",
    hint: "Members get it in their calendar and Up next.",
    path: "/meetings?new=1",
  },
  {
    key: "types",
    label: "Pick your event types",
    hint: "Meetings, socials, workshops, in your colours.",
    path: "/onboarding/organization/{slug}/events",
  },
  {
    key: "task",
    label: "Create a task or an epic",
    hint: "Give the work an owner and a due date.",
    path: "/tasks?new=1",
  },
  {
    key: "teams",
    label: "Add your teams",
    hint: "They become your org chart.",
    path: "/onboarding/organization/{slug}/teams",
  },
  {
    key: "budget",
    label: "Set up your budgets",
    hint: "What you can spend this budget period.",
    path: "/finance/budget",
  },
  {
    key: "database",
    label: "Set up a database",
    hint: "Attendance, sign-ups or anything else.",
    path: "/databases",
    recommended: true,
  },
];

/** More setup that never "finishes": links under the steps, not steps. */
export const STARTED_EXTRAS: readonly { label: string; path: string }[] = [
  { label: "Import from another app", path: "/onboarding/organization/{slug}/import" },
  { label: "Task tags", path: "/onboarding/organization/{slug}/labels" },
  { label: "Emails", path: "/onboarding/organization/{slug}/emails" },
  { label: "Connect your tools", path: "/setup" },
];

/** A step's or extra's link for the organization `slug`. */
export function startedHref(slug: string, path: string): string {
  return path.startsWith("/onboarding/") ? path.replace("{slug}", slug) : `/app/${slug}${path}`;
}

export function isStartedStep(value: unknown): value is StartedStepKey {
  return (STARTED_STEP_KEYS as readonly string[]).includes(value as string);
}

export type StepStatus = "done" | "skipped" | "todo";

export interface StartedProgress {
  steps: (StartedStep & { status: StepStatus })[];
  /** Done or checked off. */
  finished: number;
  total: number;
  /** Every step is done or checked off: the card hides. */
  complete: boolean;
}

/** Each step's status, and whether the card still shows. */
export function startedProgress(state: StartedState, skipped: readonly string[]): StartedProgress {
  const steps = STARTED_STEPS.map((step) => ({
    ...step,
    status: (state[step.key]
      ? "done"
      : skipped.includes(step.key)
        ? "skipped"
        : "todo") as StepStatus,
  }));
  const finished = steps.filter((s) => s.status !== "todo").length;
  return { steps, finished, total: steps.length, complete: finished === steps.length };
}
