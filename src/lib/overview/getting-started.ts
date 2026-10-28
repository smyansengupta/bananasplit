/**
 * "Get your club started" (the Overview, for owners and admins): a new
 * club's first steps. Each step is done when the club has the thing (worked
 * out from its data, never stored), or when an admin checks it off as not
 * needed (OrgSettings.startedSkipped). Once every step is one or the other,
 * the card goes away by itself. Pure and client-safe.
 */

export const STARTED_STEP_KEYS = [
  "name",
  "picture",
  "members",
  "event",
  "task",
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

export const STARTED_STEPS: readonly StartedStep[] = [
  {
    key: "name",
    label: "Name the organization",
    hint: "The name members and guests see everywhere.",
    path: "/settings/general",
  },
  {
    key: "picture",
    label: "Add an organization picture",
    hint: "Your logo on the sidebar, invites and RSVP pages.",
    path: "/settings/general",
  },
  {
    key: "members",
    label: "Invite your members",
    hint: "Share a join code or link.",
    path: "/settings/members",
  },
  {
    key: "event",
    label: "Put your first meeting on the calendar",
    hint: "Members get it in their calendar and Up next.",
    path: "/calendar",
  },
  {
    key: "task",
    label: "Create a task or an epic",
    hint: "Give the work an owner and a due date.",
    path: "/tasks?new=1",
  },
  {
    key: "budget",
    label: "Set up your budgets",
    hint: "What you can spend this term, line by line.",
    path: "/finance/budget",
  },
  {
    key: "database",
    label: "Set up a database",
    hint: "Track attendance, sign-ups or anything else.",
    path: "/databases",
    recommended: true,
  },
];

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
