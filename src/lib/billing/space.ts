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
 *                     Plus adds themes, integrations and AI. A new account's
 *                     space starts on FREE with a trialEndsAt: Personal Plus
 *                     for TRIAL_DAYS, then Personal Free, no card asked.
 *   TRIAL, running    everything (Team Advanced), for TRIAL_DAYS from the
 *                     organization's start, with Team Advanced's limits.
 *   TRIAL, ended      the plan the owner picked during the trial
 *                     (planAfterTrial), else Team Free (a reverse trial):
 *                     nothing pauses, nothing is deleted. Every new
 *                     organization starts here whatever plan was clicked;
 *                     picking one never cuts the trial short. The row stays
 *                     TRIAL; the app reads it as the plan it ended on.
 *   TEAM_FREE         Team Free.
 *   CLUB, SOCIETY     that plan (Team, Team Advanced).
 *
 *   spaceIncludes(org, "finance")      // gate a page, a link, an action
 *   spaceLimits(org)                   // storage, largest file, note history
 *   spaceStatus(org)                   // "personal" | "trial" | "free" | "paid"
 *   trialDaysLeft(org)                 // Settings › Plan, the trial banner
 *   trialJustEnded(org)                // the "your trial is up" dialog
 */

/** The columns of Organization that decide what a space includes. */
export interface SpaceInfo {
  kind: OrgKind;
  plan: OrgPlan;
  /** When the space's trial ends: an organization on TRIAL, or a Personal space on FREE. */
  trialEndsAt: Date | null;
  /** TRIAL only: the plan picked during the trial, which starts when it ends. */
  planAfterTrial: OrgPlan | null;
}

/** How long a new account's or organization's trial of the top plan runs. */
export const TRIAL_DAYS = 14;

/** Owners hear the trial is almost up from this many days before it ends (the banner, the email). */
export const TRIAL_NOTICE_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

export type SpaceStatus = "personal" | "trial" | "free" | "paid";

/** When a space started at `now` ends its trial. */
export function trialEndsAtFrom(now: Date = new Date()): Date {
  return new Date(now.getTime() + TRIAL_DAYS * DAY_MS);
}

export function isPersonalSpace(space: Pick<SpaceInfo, "kind">): boolean {
  return space.kind === "PERSONAL";
}

/**
 * Enough of a space to know its plan right now: kind, plan and the trial
 * columns. All four are required, so a query that forgets the trial's end
 * can't read a running trial as Free (or an ended one as running).
 */
export type PlanSpace = Pick<SpaceInfo, "kind" | "plan" | "trialEndsAt" | "planAfterTrial">;

/** Who an organization's trial ends on: the plan picked during it, else Team Free. */
function afterTrial(space: PlanSpace): "TEAM_FREE" | "CLUB" | "SOCIETY" {
  const next = space.planAfterTrial;
  return next === "CLUB" || next === "SOCIETY" ? next : "TEAM_FREE";
}

/** Whether the space is on a trial (running or ended): an organization on TRIAL, a Personal space on FREE with an end. */
function onTrial(space: PlanSpace): boolean {
  return space.kind === "PERSONAL"
    ? space.plan === "FREE" && space.trialEndsAt != null
    : space.plan === "TRIAL";
}

/** Whether a trial has run out (nobody picked a plan, so it's on the free one). */
function trialEnded(space: PlanSpace, now: Date): boolean {
  return (
    onTrial(space) && space.trialEndsAt != null && space.trialEndsAt.getTime() <= now.getTime()
  );
}

/** Whether a trial is still running. */
function trialRunning(space: PlanSpace, now: Date): boolean {
  return onTrial(space) && !trialEnded(space, now);
}

/** Where the space stands: Personal, a running trial, Team Free (or a trial that ended), or paid. */
export function spaceStatus(space: SpaceInfo, now: Date = new Date()): SpaceStatus {
  if (space.kind === "PERSONAL") return "personal";
  if (space.plan === "TRIAL") {
    if (!trialEnded(space, now)) return "trial";
    return afterTrial(space) === "TEAM_FREE" ? "free" : "paid";
  }
  if (space.plan === "TEAM_FREE") return "free";
  return "paid";
}

/** Whole days left in a trial (0 once it has ended), or null when not on one. */
export function trialDaysLeft(space: SpaceInfo, now: Date = new Date()): number | null {
  if (!onTrial(space) || !space.trialEndsAt) return null;
  return Math.max(0, Math.ceil((space.trialEndsAt.getTime() - now.getTime()) / DAY_MS));
}

/** The plan a trial is of: Personal Plus for a Personal space, Team Advanced for an organization. */
export function trialPlanName(space: Pick<SpaceInfo, "kind">): string {
  return PLAN_NAMES[space.kind === "PERSONAL" ? "PERSONAL_PLUS" : "SOCIETY"];
}

/** The plan a trial ends on: Personal Free; for an organization, the one picked during it, else Free. */
export function trialFallbackName(space: PlanSpace): string {
  return PLAN_NAMES[space.kind === "PERSONAL" ? "FREE" : afterTrial(space)];
}

/** Whether a running trial is about to hand over: the plan picked for after it (TRIAL only). */
export function planPickedForAfterTrial(
  space: PlanSpace,
  now: Date = new Date(),
): PricedPlan | null {
  if (space.kind !== "CLUB" || space.plan !== "TRIAL" || trialEnded(space, now)) return null;
  return space.planAfterTrial ? afterTrial(space) : null;
}

/** Whether the trial has ended (the space is on the plan it ended on, and the row still says so). */
export function trialJustEnded(space: SpaceInfo, now: Date = new Date()): boolean {
  return trialEnded(space, now);
}

/**
 * The priced plan whose features and limits the space has: a running trial
 * is Team Advanced (Personal Plus for a Personal space), an ended one the
 * plan picked during it, else Team Free (Personal Free).
 */
export function effectivePlan(space: PlanSpace, now: Date = new Date()): PricedPlan {
  if (space.kind === "PERSONAL") {
    return space.plan === "PERSONAL_PLUS" || trialRunning(space, now) ? "PERSONAL_PLUS" : "FREE";
  }
  if (space.plan === "TRIAL") return trialEnded(space, now) ? afterTrial(space) : "SOCIETY";
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
