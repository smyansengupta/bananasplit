import { z } from "zod";

import { MAX_LINKS, type LinkKind } from "@/lib/profile/links";
import { profileDetailsSchema, profileLinkSchema } from "@/lib/profile/schema";

/**
 * The two onboarding flows from the design (docs/features/onboarding-flows.md):
 *
 *   A  "Your profile", right after sign-up (docs/features/personal-and-clubs.md):
 *      basics (photo, name, pronouns, time zone; required, completes
 *      onboarding) -> school -> bio and links -> when you can't meet ->
 *      review, then the Personal dashboard. Joining a club adds one small
 *      club step, "Your role in <club>" (/onboarding/join/[orgSlug]).
 *   B  Create an organization, only for the person creating one:
 *      B1 name -> labels -> finance -> teams -> weekly pulse -> invite
 *      officers -> connect tools (optional) -> bring (move things in from
 *      Personal; skipped when there's nothing to bring) -> the club, as
 *      its admin.
 *
 * Pure and client-safe: the pages, forms and actions share these.
 */

/**
 * "Your profile" (Flow A), one run of five steps right after sign-up.
 * Step 1 is required (saving it completes onboarding and makes the
 * Personal space); every later step can be skipped and finished later
 * from the Personal dashboard.
 */
export const PROFILE_STEPS = ["basics", "school", "bio", "availability", "review"] as const;
export type ProfileStep = (typeof PROFILE_STEPS)[number];

/** The one required step. */
export const FIRST_PROFILE_STEP = "basics" satisfies ProfileStep;

/** The stepper's short names, in order. */
export const PROFILE_STEP_TITLES: Record<ProfileStep, string> = {
  basics: "About you",
  school: "School",
  bio: "Bio and links",
  availability: "When you can't meet",
  review: "Review",
};

export function isProfileStep(value: unknown): value is ProfileStep {
  return typeof value === "string" && (PROFILE_STEPS as readonly string[]).includes(value);
}

export function profileStepHref(step: ProfileStep): string {
  return `/onboarding/profile/${step}`;
}

/**
 * Where a new account goes after sign-up: /onboarding, carrying where
 * sign-up started (an already-safe callbackUrl) so step 1 returns there.
 */
export function onboardingHref(after?: string | null): string {
  return after ? `/onboarding?callbackUrl=${encodeURIComponent(after)}` : "/onboarding";
}

export function nextProfileStep(step: ProfileStep): ProfileStep | null {
  return PROFILE_STEPS[PROFILE_STEPS.indexOf(step) + 1] ?? null;
}

export function previousProfileStep(step: ProfileStep): ProfileStep | null {
  const i = PROFILE_STEPS.indexOf(step);
  return i > 0 ? PROFILE_STEPS[i - 1] : null;
}

/**
 * The profile steps still empty, for the dashboard's "Finish your profile"
 * card: school (no major and no grad year), bio (no bio and no links),
 * availability (nothing marked). Basics is always done once onboarded.
 */
export function unfinishedProfileSteps(profile: {
  major: string | null;
  gradYear: number | null;
  bio: string | null;
  links: readonly unknown[];
  blockedHours: number;
}): ProfileStep[] {
  const out: ProfileStep[] = [];
  if (!profile.major && profile.gradYear === null) out.push("school");
  if (!profile.bio && profile.links.length === 0) out.push("bio");
  if (profile.blockedHours === 0) out.push("availability");
  return out;
}

// B1 is /onboarding/organization; the rest live under the new org's slug.
// Connecting tools comes after inviting officers: it's optional, and a new
// club's first minutes are better spent on its own setup and its people.
// The weekly pulse is picked right after Teams (redesign guide 15.2).
export const ORG_STEPS = [
  "labels",
  "finance",
  "teams",
  "pulse",
  "invite",
  "data",
  "bring",
] as const;
export type OrgStep = (typeof ORG_STEPS)[number];
/** Eight steps in the stepper: B1 plus these seven. */
export const ORG_STEP_COUNT = ORG_STEPS.length + 1;

/** The stepper's names, in order. */
export const ORG_STEP_NAMES = [
  "Organization basics",
  "Tags",
  "Finance",
  "Teams",
  // When the club's weekly recap goes out, to whom, and how.
  "Weekly pulse",
  "Invite officers",
  // Optional: a club's data is stored in Bananasplit whether or not it connects anything.
  "Connect tools",
  // "Bring anything in?": events, polls and tasks from the creator's Personal space.
  "Bring things in",
] as const;

export function isOrgStep(value: unknown): value is OrgStep {
  return typeof value === "string" && (ORG_STEPS as readonly string[]).includes(value);
}

export function orgStepHref(orgSlug: string, step: OrgStep): string {
  return `/onboarding/organization/${orgSlug}/${step}`;
}

export function nextOrgStep(step: OrgStep): OrgStep | null {
  return ORG_STEPS[ORG_STEPS.indexOf(step) + 1] ?? null;
}

export function previousOrgStep(step: OrgStep): OrgStep | null {
  const i = ORG_STEPS.indexOf(step);
  return i > 0 ? ORG_STEPS[i - 1] : null;
}

// ---------------------------------------------------------------- A1-A3 input

export const PRONOUN_CHOICES = ["he/him", "she/her", "they/them"] as const;

/**
 * The role picker in "Your role in <club>" (the one club step after
 * joining), stored as that membership's title.
 */
export const ROLE_CHOICES = [
  "President",
  "Vice President",
  "Treasurer",
  "Secretary",
  "Project Manager",
  "Developer",
  "Designer",
  "Marketing",
  "Events",
  "Outreach",
  "Member",
] as const;

export const MAX_TITLE = 80;
/** The bio box in setup is short on purpose; the profile page allows more. */
export const SETUP_BIO_MAX = 280;

const { name, pronouns, timezone, major, gradYear, bio } = profileDetailsSchema.shape;

export const basicsSchema = z.object({ name, pronouns, timezone }).strict();

/** A title: spaces collapsed, at most MAX_TITLE characters, "" -> null. */
const titleSchema = z
  .string()
  .transform((s) => s.replace(/\s+/g, " ").trim())
  .pipe(z.string().max(MAX_TITLE, `Keep your role under ${MAX_TITLE} characters.`))
  .transform((s) => (s ? s : null))
  .nullable()
  .optional()
  .transform((v) => v ?? null);

/** School: about you, not your club role (that's per club, set on joining). */
export const schoolSchema = z.object({ major, gradYear }).strict();

/** "Your role in <club>": the membership's title. */
export const clubRoleSchema = z.object({ title: titleSchema }).strict();

/** "Your role in <club>", the one club step after joining (code, link or emailed invite). */
export function clubRoleHref(orgSlug: string): string {
  return `/onboarding/join/${encodeURIComponent(orgSlug)}`;
}

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
