"use server";

import { redirect } from "next/navigation";

import { FUNNEL_EVENTS } from "@/lib/analytics/events";
import { trackServer } from "@/lib/analytics/server";
import { setActiveOrgCookie } from "@/lib/active-org-cookie";
import { requireUser } from "@/lib/auth/session";
import { ACCEPT_ERROR_MESSAGES } from "@/lib/invitations";
import { clubRoleHref, ORG_STEPS, orgStepHref } from "@/lib/onboarding/steps";
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
  // From onboarding, org setup continues with the first of ORG_STEPS.
  if (field(formData, "flow") === "onboarding") redirect(orgStepHref(result.slug, ORG_STEPS[0]));
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
  // Then the one small club step: "Your role in <club>".
  redirect(clubRoleHref(result.orgSlug));
}
