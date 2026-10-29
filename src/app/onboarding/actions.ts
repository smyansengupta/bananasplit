"use server";

import { redirect } from "next/navigation";

import { FUNNEL_EVENTS } from "@/lib/analytics/events";
import { trackServer } from "@/lib/analytics/server";
import { setActiveOrgCookie } from "@/lib/active-org-cookie";
import { requireUser } from "@/lib/auth/session";
import { safeCallbackUrl } from "@/lib/auth/callback-url";
import { ACCEPT_ERROR_MESSAGES } from "@/lib/invitations";
import { clubRoleHref, orgStepHref, START_HREF } from "@/lib/onboarding/steps";
import { isValidTimeZone } from "@/lib/profile/timezone";
import { getOnboardingProfile, markProfileSetupComplete } from "@/server/onboarding/profile";
import { ensurePersonalSpace } from "@/server/personal/space";
import { updateOwnProfile } from "@/server/profiles/service";
import { acceptInvitation, findPendingInvitationsForMe } from "@/server/settings/invitations";
import { createOrganization, isSlugAvailable } from "@/server/settings/org-creation";

/**
 * Onboarding and /app/new: create an organization, check a URL, or join a
 * pending invitation. Off the legacy role: org creation and invite
 * acceptance run on the service path for the signed-in user
 * (src/server/settings), and every rule is checked there, so calling these
 * actions directly gets the same answers as the pages.
 */

export interface CreateOrgState {
  error?: string;
}

function field(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" ? value : undefined;
}

export async function createOrganizationAction(
  _prevState: CreateOrgState,
  formData: FormData,
): Promise<CreateOrgState> {
  const user = await requireUser();
  const result = await createOrganization(user, {
    name: field(formData, "name") ?? "",
    slug: field(formData, "slug") ?? "",
    timezone: field(formData, "timezone") || "UTC",
    code: field(formData, "code") || undefined,
  });
  if (!result.ok) return { error: result.error };

  await trackServer(FUNNEL_EVENTS.organizationCreated, {
    flow: field(formData, "flow") === "onboarding" ? "onboarding" : "app",
  });
  await setActiveOrgCookie(result.orgId);
  // From onboarding, setting it up continues at Import (ORG_STEPS, the profile
  // last); basics, before it, is only for going back.
  if (field(formData, "flow") === "onboarding") redirect(orgStepHref(result.slug, "import"));
  redirect(`/app/${result.slug}`);
}

export async function checkSlugAvailability(slug: string): Promise<boolean> {
  const user = await requireUser();
  return isSlugAvailable(user.id, slug);
}

export async function joinPendingInvitationAction(
  invitationId: string,
): Promise<{ error?: string }> {
  const user = await requireUser();
  // Only invitations to the caller's own verified address are visible here.
  const pending = await findPendingInvitationsForMe(user.id);
  const match = pending.find((p) => p.id === invitationId);
  if (!match) return { error: "This invite no longer exists." };

  const result = await acceptInvitation(
    {
      id: match.id,
      organizationId: match.organizationId,
      expiresAt: match.expiresAt,
      acceptedAt: null,
    },
    user,
  );
  if (!result.ok) return { error: ACCEPT_ERROR_MESSAGES[result.reason] };

  await setActiveOrgCookie(result.orgId);
  // Then you in the organization: about you, bio, your role, review.
  redirect(clubRoleHref(result.orgSlug));
}

/**
 * Readies a new account (/onboarding posts it once, on arrival): the device's
 * time zone when the account has none yet, onboarded, and its Personal space
 * (with its trial), made in that zone. A POST, so a prefetch or a link
 * preview of /onboarding changes nothing. Then where sign-up started (when
 * safe), else "What brings you here?".
 */
export async function readyAccountAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const profile = await getOnboardingProfile(user.id);
  if (!profile) redirect("/auth/session-ended");
  const timezone = field(formData, "timezone");
  if (!profile.timezone && isValidTimeZone(timezone)) {
    await updateOwnProfile(user.id, { timezone });
  }
  await markProfileSetupComplete(user.id);
  await ensurePersonalSpace(user.id);
  redirect(safeCallbackUrl(field(formData, "after")) ?? START_HREF);
}
