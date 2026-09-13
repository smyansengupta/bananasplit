"use server";

import { redirect } from "next/navigation";

import { setActiveOrgCookie } from "@/lib/active-org-cookie";
import { requireUser } from "@/lib/auth/session";
import { acceptInvitation, findInvitationByRawToken } from "@/lib/invitations";

const ACCEPT_ERROR_MESSAGES = {
  already_used: "This invite has already been used.",
  expired: "This invite has expired.",
  email_mismatch: "This invite was sent to a different email address.",
} as const;

export async function acceptInvitationAction(
  rawToken: string,
): Promise<{ error?: string } | undefined> {
  const user = await requireUser();
  const invitation = await findInvitationByRawToken(rawToken);
  if (!invitation) {
    return { error: "This invite link is invalid." };
  }

  const result = await acceptInvitation(invitation, user);
  if (!result.ok) {
    return { error: ACCEPT_ERROR_MESSAGES[result.reason] };
  }

  await setActiveOrgCookie(result.orgId);
  redirect(`/app/${result.orgSlug}`);
}
