"use server";

import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/session";
import { availabilitySchema } from "@/lib/availability";
import { basicsSchema, bioSchema, schoolSchema } from "@/lib/onboarding/steps";
import { profileFieldErrors } from "@/lib/profile/schema";
import { personalThemeSchema } from "@/lib/theme/personal";
import { markProfileSetupComplete, updateOwnOnboardingFields } from "@/server/onboarding/profile";
import { updateOwnProfile } from "@/server/profiles/service";

/**
 * Profile setup (onboarding Flow A). Each step saves the signed-in user's
 * own row as soon as they press Continue; input is untrusted and validated
 * again here with the same schemas as the forms.
 */

export type StepSaveResult = { ok: true } | { ok: false; fieldErrors: Record<string, string> };

const GENERIC = { form: "Couldn't save. Try again." };

async function save(run: () => Promise<void>, where: string): Promise<StepSaveResult> {
  try {
    await run();
    return { ok: true };
  } catch (error) {
    console.error(
      `[onboarding] save ${where} failed`,
      error instanceof Error ? error.message : error,
    );
    return { ok: false, fieldErrors: GENERIC };
  }
}

/** A1: name, pronouns, time zone. */
export async function saveBasicsStep(input: unknown): Promise<StepSaveResult> {
  const user = await requireUser();
  const parsed = basicsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: profileFieldErrors(parsed.error) };
  return save(() => updateOwnProfile(user.id, parsed.data), "basics");
}

/** A2: major, graduation year, role (the title the user joins orgs with). */
export async function saveSchoolStep(input: unknown): Promise<StepSaveResult> {
  const user = await requireUser();
  const parsed = schoolSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: profileFieldErrors(parsed.error) };
  const { preferredTitle, ...profile } = parsed.data;
  return save(async () => {
    await updateOwnProfile(user.id, profile);
    await updateOwnOnboardingFields(user.id, { preferredTitle });
  }, "school");
}

/** A3: bio and links. */
export async function saveBioStep(input: unknown): Promise<StepSaveResult> {
  const user = await requireUser();
  const parsed = bioSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: profileFieldErrors(parsed.error) };
  return save(() => updateOwnProfile(user.id, parsed.data), "bio");
}

/** A4 (and the profile page): the personal theme, or null to follow the org. */
export async function saveThemeStep(input: unknown): Promise<StepSaveResult> {
  const user = await requireUser();
  if (input === null)
    return save(() => updateOwnOnboardingFields(user.id, { themePreference: null }), "theme");
  const parsed = personalThemeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: profileFieldErrors(parsed.error) };
  return save(() => updateOwnOnboardingFields(user.id, { themePreference: parsed.data }), "theme");
}

/** A5 (and the profile page): blocked hours and rules. */
export async function saveAvailabilityStep(input: unknown): Promise<StepSaveResult> {
  const user = await requireUser();
  const parsed = availabilitySchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: profileFieldErrors(parsed.error) };
  return save(
    () => updateOwnOnboardingFields(user.id, { availability: parsed.data }),
    "availability",
  );
}

const FINISH_TARGETS = {
  join: "/onboarding/join",
  create: "/onboarding/organization",
  home: "/app",
} as const;

/** A6 -> A7: the profile is complete; go join, create, or home. */
export async function finishProfileSetup(next: keyof typeof FINISH_TARGETS): Promise<void> {
  const user = await requireUser();
  await markProfileSetupComplete(user.id);
  redirect(FINISH_TARGETS[next] ?? "/onboarding");
}
