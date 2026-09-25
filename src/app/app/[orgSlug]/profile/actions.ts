"use server";

import { refresh } from "next/cache";

import { absoluteAppUrl } from "@/lib/app-url";
import { requireUser } from "@/lib/auth/session";
import {
  notificationPreferencesPatchSchema,
  type NotificationPreferences,
} from "@/lib/notifications/preferences";
import { profileDetailsSchema, profileFieldErrors, profileLinksSchema } from "@/lib/profile/schema";
import {
  rotateOwnIcsToken,
  turnOffOwnIcsFeed,
  updateOwnNotificationPreferences,
  updateOwnProfile,
} from "@/server/profiles/service";

/**
 * Profile Server Actions. Each acts on the signed-in user's own row only
 * (the service runs withUserTx for the session user; RLS and the column
 * grant enforce it again). The profile is the same in every org, so no org
 * id is taken. Input is untrusted and re-validated here.
 */

export type SaveResult = { ok: true } | { ok: false; fieldErrors: Record<string, string> };

const GENERIC_ERROR = { form: "Couldn't save. Try again." };

export async function saveProfileDetails(input: unknown): Promise<SaveResult> {
  const user = await requireUser();
  const parsed = profileDetailsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: profileFieldErrors(parsed.error) };
  try {
    await updateOwnProfile(user.id, parsed.data);
  } catch (error) {
    console.error("[profile] save details failed", error instanceof Error ? error.message : error);
    return { ok: false, fieldErrors: GENERIC_ERROR };
  }
  // Re-render the page and the shell (the user menu shows the new name).
  refresh();
  return { ok: true };
}

export async function saveProfileLinks(input: unknown): Promise<SaveResult> {
  const user = await requireUser();
  const parsed = profileLinksSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: profileFieldErrors(parsed.error) };
  try {
    await updateOwnProfile(user.id, parsed.data);
  } catch (error) {
    console.error("[profile] save links failed", error instanceof Error ? error.message : error);
    return { ok: false, fieldErrors: GENERIC_ERROR };
  }
  refresh();
  return { ok: true };
}

export type PreferencesResult =
  { ok: true; preferences: NotificationPreferences } | { ok: false; error: string };

/** One change from the notification section (a switch, the digest hour, the lead). */
export async function saveNotificationPreferences(patch: unknown): Promise<PreferencesResult> {
  const user = await requireUser();
  const parsed = notificationPreferencesPatchSchema.safeParse(patch);
  if (!parsed.success) return { ok: false, error: "That setting isn't valid." };
  try {
    const preferences = await updateOwnNotificationPreferences(user.id, parsed.data);
    return { ok: true, preferences };
  } catch (error) {
    console.error(
      "[profile] save preferences failed",
      error instanceof Error ? error.message : error,
    );
    return { ok: false, error: "Couldn't save that change. Try again." };
  }
}

export type FeedLinkResult =
  { ok: true; url: string; createdAt: string } | { ok: false; error: string };

/**
 * Creates (or replaces) the calendar feed link and returns its URL ONCE:
 * only a hash is stored, so the page can never show it again. The URL is
 * built from the configured app URL, never from the request's Host header.
 */
export async function createCalendarFeedLink(): Promise<FeedLinkResult> {
  const user = await requireUser();
  try {
    const { token, createdAt } = await rotateOwnIcsToken(user.id);
    return {
      ok: true,
      url: absoluteAppUrl(`/api/calendar/feed/${token}`),
      createdAt: createdAt.toISOString(),
    };
  } catch (error) {
    console.error("[profile] feed link failed", error instanceof Error ? error.message : error);
    return { ok: false, error: "Couldn't create a feed link. Try again." };
  }
}

export async function turnOffCalendarFeed(): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  try {
    await turnOffOwnIcsFeed(user.id);
    return { ok: true };
  } catch (error) {
    console.error("[profile] feed off failed", error instanceof Error ? error.message : error);
    return { ok: false, error: "Couldn't turn the feed off. Try again." };
  }
}
