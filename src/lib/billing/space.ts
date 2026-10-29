import type { OrgKind, OrgPlan } from "@/generated/prisma/enums";

import {
  FEATURE_LABELS,
  isPluralFeature,
  personalPlanFor,
  PLAN_LIMITS,
  PLAN_NAMES,
  planIncludes,
  type PlanFeature,
  type PlanLimits,
  type PricedPlan,
} from "./features";

/**
 * What a space (a Personal space or a club) can use right now, the one
 * place the app asks (docs/features/personal-and-clubs.md). Pure and
 * client-safe; the pricing table keeps asking planIncludes().
 *
 *   PERSONAL          its plan, Personal Free (FREE) or Personal Plus
 *                     (src/lib/billing/features.ts): tasks, the calendar
 *                     and RSVP pages, polls, notes and files, settings;
 *                     Plus adds themes, calendar sync and AI.
 *   TRIAL, running    everything (Team Advanced), for 30 days from the
 *                     organization's start, with Team Advanced's limits.
 *   TRIAL, ended      Team Free (a reverse trial): nothing pauses, nothing
 *                     is deleted, and the organization keeps working on the
 *                     free plan until the owner picks Team or Team
 *                     Advanced. The row stays TRIAL until then; the app
 *                     reads it as TEAM_FREE.
 *   TEAM_FREE         Team Free.
 *   CLUB, SOCIETY     that plan (Team, Team Advanced).
 *
 *   spaceIncludes(org, "finance")      // gate a page, a link, an action
 *   spaceLimits(org)                   // storage, largest file, note history
 *   spaceStatus(org)                   // "personal" | "trial" | "free" | "paid"
 *   trialDaysLeft(org)                 // Settings › Plan, the trial banner
 */

/** The three columns of Organization that decide what a space includes. */
export interface SpaceInfo {
  kind: OrgKind;
  plan: OrgPlan;
  /** TRIAL only: when the trial ends. */
  trialEndsAt: Date | null;
}

/** How long a new organization's trial runs. */
export const TRIAL_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export type SpaceStatus = "personal" | "trial" | "free" | "paid";

/** When an organization started at `now` ends its trial. */
export function trialEndsAtFrom(now: Date = new Date()): Date {
  return new Date(now.getTime() + TRIAL_DAYS * DAY_MS);
}

export function isPersonalSpace(space: Pick<SpaceInfo, "kind">): boolean {
  return space.kind === "PERSONAL";
}

/**
 * Enough of a space to know its plan right now: kind and plan, and the
 * trial's end when there is one (without it, a trial counts as running).
 */
export type PlanSpace = Pick<SpaceInfo, "kind" | "plan"> & Partial<Pick<SpaceInfo, "trialEndsAt">>;

/** Whether a trial has run out (the owner hasn't picked a plan, so it's on Team Free). */
function trialEnded(space: PlanSpace, now: Date): boolean {
  return (
    space.plan === "TRIAL" &&
    space.trialEndsAt != null &&
    space.trialEndsAt.getTime() <= now.getTime()
  );
}

/** Where the space stands: Personal, a running trial, Team Free (or a trial that ended), or paid. */
export function spaceStatus(space: SpaceInfo, now: Date = new Date()): SpaceStatus {
  if (space.kind === "PERSONAL") return "personal";
  if (space.plan === "TRIAL") return trialEnded(space, now) ? "free" : "trial";
  if (space.plan === "TEAM_FREE") return "free";
  return "paid";
}

/** Whole days left in a trial (0 on its last day or after), or null when not on one. */
export function trialDaysLeft(space: SpaceInfo, now: Date = new Date()): number | null {
  if (space.kind !== "CLUB" || space.plan !== "TRIAL" || !space.trialEndsAt) return null;
  return Math.max(0, Math.ceil((space.trialEndsAt.getTime() - now.getTime()) / DAY_MS));
}

/**
 * The priced plan whose features and limits the space has: a running trial
 * is Team Advanced, an ended one Team Free.
 */
export function effectivePlan(space: PlanSpace, now: Date = new Date()): PricedPlan {
  if (space.kind === "PERSONAL") return space.plan === "PERSONAL_PLUS" ? "PERSONAL_PLUS" : "FREE";
  if (space.plan === "TRIAL") return trialEnded(space, now) ? "TEAM_FREE" : "SOCIETY";
  // An organization is never on a Personal plan (the database refuses it).
  if (space.plan === "FREE" || space.plan === "PERSONAL_PLUS") return "TEAM_FREE";
  return space.plan;
}

/** Whether the space includes `feature` right now. */
export function spaceIncludes(
  space: SpaceInfo,
  feature: PlanFeature,
  now: Date = new Date(),
): boolean {
  return planIncludes(effectivePlan(space, now), feature);
}

/** The space's limits right now: its plan's (a running trial's are Team Advanced's). */
export function spaceLimits(space: PlanSpace, now: Date = new Date()): PlanLimits {
  return PLAN_LIMITS[effectivePlan(space, now)];
}

/** What a refused action says when the space doesn't include its feature. */
export function featureRefusal(space: Pick<SpaceInfo, "kind">, feature: PlanFeature): string {
  const plural = isPluralFeature(feature);
  if (space.kind === "PERSONAL") {
    return personalPlanFor(feature) === "PERSONAL_PLUS"
      ? `${FEATURE_LABELS[feature]} ${plural ? "come" : "comes"} with ${PLAN_NAMES.PERSONAL_PLUS}.`
      : `${FEATURE_LABELS[feature]} ${plural ? "are" : "is"} for organizations. Start an organization or join one to use it.`;
  }
  return `${FEATURE_LABELS[feature]} ${plural ? "aren't" : "isn't"} on this organization's plan.`;
}

/**
 * What withOrgAction returns instead of running an action the space refuses
 * (src/server/db/context.ts): a feature the space lacks. Shaped like the
 * actions' own `{ error }` results, so forms show `error`.
 */
export interface SpaceRefusal {
  ok: false;
  error: string;
  refused: "feature";
}

export function isSpaceRefusal(value: unknown): value is SpaceRefusal {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { ok?: unknown }).ok === false &&
    (value as { refused?: unknown }).refused === "feature"
  );
}

/** Why `space` refuses an action, or null when it may run: the `feature` it belongs to, if any. */
export function spaceRefusal(
  space: SpaceInfo,
  options: { feature?: PlanFeature },
  now: Date = new Date(),
): SpaceRefusal | null {
  if (options.feature && !spaceIncludes(space, options.feature, now)) {
    return { ok: false, error: featureRefusal(space, options.feature), refused: "feature" };
  }
  return null;
}
