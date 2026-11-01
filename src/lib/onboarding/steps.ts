import { z } from "zod";

import { MAX_LINKS, type LinkKind } from "@/lib/profile/links";
import { profileDetailsSchema, profileLinkSchema } from "@/lib/profile/schema";

/**
 * Onboarding (docs/features/onboarding-flows.md), organization first, no
 * step counts, three minutes end to end:
 *
 *   Account   sign up. That makes the Personal space, with its trial; then
 *             "What brings you here?" (/onboarding/start).
 *   Join      the invite code (or an emailed invite), then your profile,
 *             one screen (/onboarding/join/<org>/profile).
 *   Create    the organization's name (/onboarding/organization), then
 *             Invite and (sometimes) Bring: ORG_FLOW. The rest is in
 *             "Get your organization started" on its Overview.
 *   Personal  "Just me": PERSONAL_STEPS, your profile last.
 *
 * Pure and client-safe: the pages, forms and actions share these.
 */

/** Your profile in an organization you joined: photo, name, pronouns, time zone, role, bio, links. */
export function clubRoleHref(orgSlug: string): string {
  return `/onboarding/join/${encodeURIComponent(orgSlug)}/profile`;
}

/**
 * Where a new account goes after sign-up: /onboarding, carrying where
 * sign-up started (an already-safe callbackUrl), which wins over the
 * "What brings you here?" choice.
 */
export function onboardingHref(after?: string | null): string {
  return after ? `/onboarding?callbackUrl=${encodeURIComponent(after)}` : "/onboarding";
}

/** "What brings you here?": join, create, or just me. */
export const START_HREF = "/onboarding/start";

// ---------------------------------------------------------------- Setting up

/**
 * Setting up an organization once it's made: three screens end to end.
 * Creating it (its name) lands on Invite, then Bring (only when the
 * creator has Personal things to bring), then the organization itself.
 * "basics" is before Invite so Back edits the organization instead of
 * starting another. Everything else a club sets up (a picture, task tags,
 * event types, teams, emails, importing from another app, your profile)
 * is a page of its own, opened from "Get your organization started" on
 * the Overview; finishing one goes back there.
 */
export const ORG_STEPS = [
  "basics",
  "invite",
  "bring",
  "import",
  "picture",
  "labels",
  "events",
  "teams",
  "emails",
  "profile",
] as const;
export type OrgStep = (typeof ORG_STEPS)[number];

/** The steps a new organization walks through, in order (the rest stand alone). */
export const ORG_FLOW: readonly OrgStep[] = ["basics", "invite", "bring"];

/** "Just me": setting up the personal workspace, your profile last. */
export const PERSONAL_STEPS = ["import", "labels", "emails", "profile"] as const;
export type PersonalStep = (typeof PERSONAL_STEPS)[number];

export type SetupFlow = "org" | "personal";
export type SetupStep = OrgStep | PersonalStep;

export function stepsOf(flow: SetupFlow): readonly SetupStep[] {
  return flow === "org" ? ORG_STEPS : PERSONAL_STEPS;
}

export function isSetupStep(flow: SetupFlow, value: unknown): value is SetupStep {
  return typeof value === "string" && (stepsOf(flow) as readonly string[]).includes(value);
}

export function isOrgStep(value: unknown): value is OrgStep {
  return isSetupStep("org", value);
}

/** A step's page: under the organization's URL, or /onboarding/personal/<step>. */
export function setupStepHref(flow: SetupFlow, orgSlug: string, step: SetupStep): string {
  return flow === "org"
    ? `/onboarding/organization/${orgSlug}/${step}`
    : `/onboarding/personal/${step}`;
}

export function orgStepHref(orgSlug: string, step: OrgStep): string {
  return setupStepHref("org", orgSlug, step);
}

/** The steps walked in order: an organization's ORG_FLOW, or every Personal step. */
function walkOf(flow: SetupFlow): readonly SetupStep[] {
  return flow === "org" ? ORG_FLOW : PERSONAL_STEPS;
}

/** The step after `step`, or null after the last (or for a step that stands alone). */
export function nextSetupStep(flow: SetupFlow, step: SetupStep): SetupStep | null {
  const steps = walkOf(flow);
  const i = (steps as readonly string[]).indexOf(step);
  return i < 0 ? null : (steps[i + 1] ?? null);
}

/** The step before `step`, or null before the first (or for a step that stands alone). */
export function previousSetupStep(flow: SetupFlow, step: SetupStep): SetupStep | null {
  const steps = walkOf(flow);
  const i = (steps as readonly string[]).indexOf(step);
  return i > 0 ? steps[i - 1]! : null;
}

// ---------------------------------------------------------------- Input

export const PRONOUN_CHOICES = ["he/him", "she/her", "they/them"] as const;

/** The bio box in setup is short on purpose; the profile page allows more. */
export const SETUP_BIO_MAX = 280;

const { name, pronouns, timezone, major, gradYear, bio } = profileDetailsSchema.shape;

export const basicsSchema = z.object({ name, pronouns, timezone }).strict();

/** School: about you, not your club role (that's per club, set on joining). */
export const schoolSchema = z.object({ major, gradYear }).strict();

export const bioSchema = z
  .object({
    bio,
    links: z
      .array(profileLinkSchema)
      .max(MAX_LINKS, `Add at most ${MAX_LINKS} links.`)
      .optional()
      .transform((v) => v ?? []),
  })
  .strict();

/** A1-A3 inputs, for the forms. */
export type BasicsInput = z.input<typeof basicsSchema>;
export type SchoolInput = z.input<typeof schoolSchema>;
export type BioInput = z.input<typeof bioSchema>;

/** "Computer Science, Mathematics" <-> ["Computer Science", "Mathematics"] */
export const MAJOR_SEPARATOR = ", ";

export function splitMajor(major: string | null): [string, string] {
  if (!major) return ["", ""];
  const i = major.indexOf(MAJOR_SEPARATOR);
  return i < 0 ? [major, ""] : [major.slice(0, i), major.slice(i + MAJOR_SEPARATOR.length)];
}

export function joinMajor(first: string, second: string): string {
  return [first.trim(), second.trim()].filter(Boolean).join(MAJOR_SEPARATOR);
}

/** A3: "The type is detected from the URL." */
export function detectLinkKind(url: string): LinkKind {
  const raw = url.trim().toLowerCase();
  let host = raw;
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:/.test(raw) ? raw : `https://${raw}`).hostname;
  } catch {
    // keep the raw text; the match below decides
  }
  const on = (h: string) => host === h || host.endsWith(`.${h}`);
  if (on("linkedin.com")) return "linkedin";
  if (on("github.com")) return "github";
  if (on("instagram.com")) return "instagram";
  if (on("tiktok.com")) return "tiktok";
  if (on("x.com") || on("twitter.com")) return "x";
  return "website";
}

/**
 * The next `count` graduation years, starting with this academic year's, so
 * a year that has already graduated never shows. Worked out from the date
 * (never a fixed list), so it moves on by itself every July.
 */
export function gradYearChoices(now = new Date(), count = 4): number[] {
  // From July, this year's seniors have graduated.
  const first = now.getUTCMonth() >= 6 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
  return Array.from({ length: count }, (_, i) => first + i);
}
