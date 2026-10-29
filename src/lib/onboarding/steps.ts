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
 *   Create    organization basics (/onboarding/organization), setting it up
 *             (ORG_STEPS: importing first, since switching is the hard
 *             part), and your profile last.
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
 * Setting up an organization once it's made. Creating it lands on Import,
 * first because moving off another app is what decides whether anyone
 * switches; "basics" (name and time zone again) is only before it so Back
 * from Import edits the organization instead of starting another. Your
 * profile comes last. Every step but the profile can be skipped.
 */
export const ORG_STEPS = [
  "basics",
  "import",
  "picture",
  "labels",
  "events",
  "teams",
  "emails",
  "imessage",
  "tools",
  "invite",
  "bring",
  "profile",
] as const;
export type OrgStep = (typeof ORG_STEPS)[number];

/** "Just me": setting up the personal workspace, your profile last. */
export const PERSONAL_STEPS = ["import", "labels", "emails", "imessage", "profile"] as const;
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

/** The step after `step`, or null after the last. */
export function nextSetupStep(flow: SetupFlow, step: SetupStep): SetupStep | null {
  const steps = stepsOf(flow);
  return steps[(steps as readonly string[]).indexOf(step) + 1] ?? null;
}

/** The step before `step`, or null before the first. */
export function previousSetupStep(flow: SetupFlow, step: SetupStep): SetupStep | null {
  const steps = stepsOf(flow);
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
