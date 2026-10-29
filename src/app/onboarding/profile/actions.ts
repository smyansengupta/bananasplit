"use server";

import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth/session";
import { availabilitySchema } from "@/lib/availability";
import { basicsSchema, bioSchema, schoolSchema } from "@/lib/onboarding/steps";
import { profileFieldErrors } from "@/lib/profile/schema";
import { personalThemeSchema } from "@/lib/theme/personal";
import { markProfileSetupComplete, updateOwnOnboardingFields } from "@/server/onboarding/profile";
import {
  ensurePersonalSpace,
  personalHomeHref,
  setPersonalSpaceTimezone,
} from "@/server/personal/space";
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

/**
 * Step 1, the one required step: name, pronouns, time zone (the photo saves
 * on its own). Saving it completes onboarding and makes the Personal space
 * (docs/features/personal-and-clubs.md); the rest can be skipped.
 */
export async function saveBasicsStep(input: unknown): Promise<StepSaveResult> {
  const user = await requireUser();
  const parsed = basicsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: profileFieldErrors(parsed.error) };
  return save(async () => {
    await updateOwnProfile(user.id, parsed.data);
    await markProfileSetupComplete(user.id);
    await ensurePersonalSpace(user.id);
    if (parsed.data.timezone) await setPersonalSpaceTimezone(user.id, parsed.data.timezone);
  }, "basics");
}

/** Step 2: major and graduation year (the club role is per club, set on joining). */
export async function saveSchoolStep(input: unknown): Promise<StepSaveResult> {
  const user = await requireUser();
  const parsed = schoolSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: profileFieldErrors(parsed.error) };
  return save(() => updateOwnProfile(user.id, parsed.data), "school");
}

/** Step 3: bio and links. */
export async function saveBioStep(input: unknown): Promise<StepSaveResult> {
  const user = await requireUser();
  const parsed = bioSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: profileFieldErrors(parsed.error) };
  return save(() => updateOwnProfile(user.id, parsed.data), "bio");
}

/** The profile page and theme settings: the personal theme, or null to follow the club. */
export async function saveThemeStep(input: unknown): Promise<StepSaveResult> {
  const user = await requireUser();
  if (input === null)
    return save(() => updateOwnOnboardingFields(user.id, { themePreference: null }), "theme");
  const parsed = personalThemeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: profileFieldErrors(parsed.error) };
  return save(() => updateOwnOnboardingFields(user.id, { themePreference: parsed.data }), "theme");
}

/** Step 4 (and the profile page): blocked hours and rules. */
export async function saveAvailabilityStep(input: unknown): Promise<StepSaveResult> {
  const user = await requireUser();
  const parsed = availabilitySchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: profileFieldErrors(parsed.error) };
  return save(
    () => updateOwnOnboardingFields(user.id, { availability: parsed.data }),
    "availability",
  );
}

/**
 * The end of the flow (Done on review, or "Finish later" anywhere after
 * step 1): the Personal dashboard, which offers whatever was skipped.
 */
export async function finishProfileSetup(): Promise<void> {
  const user = await requireUser();
  await markProfileSetupComplete(user.id);
  redirect(await personalHomeHref(user.id));
}
