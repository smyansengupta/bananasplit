import { createHash, randomBytes } from "node:crypto";

import { NotificationType, type Invitation } from "@/generated/prisma/client";
import { getUserIdentity } from "@/lib/auth/email-verification";
import { normalizeEmail, sameEmail } from "@/lib/auth/normalize-email";
import type { SessionUser } from "@/lib/auth/session";
import { notifyUser } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";

export const INVITATION_EXPIRY_DAYS = 7;

export function generateInvitationToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashInvitationToken(token) };
}

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function findInvitationByRawToken(rawToken: string) {
  return prisma.invitation.findUnique({
    where: { token: hashInvitationToken(rawToken) },
    include: { organization: true },
  });
}

/**
 * Pending invitations for an address. Callers pass only a VERIFIED address:
 * listing another person's invitations to someone who merely typed their
 * email at sign-up would tell a squatter which orgs invited them.
 */
export function findPendingInvitationsForEmail(email: string) {
  return prisma.invitation.findMany({
    where: { email: normalizeEmail(email), acceptedAt: null, expiresAt: { gt: new Date() } },
    include: { organization: true },
    orderBy: { createdAt: "desc" },
  });
}

export type AcceptInvitationResult =
  | { ok: true; orgId: string; orgSlug: string }
  | {
      ok: false;
      reason: "already_used" | "expired" | "email_mismatch" | "unverified";
      invitedEmail?: string;
    };

export const ACCEPT_ERROR_MESSAGES: Record<
  Exclude<AcceptInvitationResult, { ok: true }>["reason"],
  string
> = {
  already_used: "This invite has already been used.",
  expired: "This invite has expired.",
  email_mismatch: "This invite was sent to a different email address.",
  unverified: "Verify your email address before accepting this invite.",
};

/**
 * Shared accept logic for both entry points: the emailed /invite/[token]
 * link, and the onboarding page's "Join" button. Membership + marking the
 * invite accepted happen in one transaction so a retry can never
 * double-join or silently skip either.
 *
 * 0A Fix 4 (invite takeover): the invite is accepted only by the account
 * whose STORED email equals the invited address (both normalized) AND has
 * been verified. Before this, anyone could sign up with a password under
 * the invited address and take the seat, since sign-up never checked the
 * address was theirs.
 */
export async function acceptInvitation(
  invitation: Invitation,
  user: SessionUser,
): Promise<AcceptInvitationResult> {
  if (invitation.acceptedAt) {
    return { ok: false, reason: "already_used" };
  }
  if (invitation.expiresAt < new Date()) {
    return { ok: false, reason: "expired" };
  }
  const identity = await getUserIdentity(user.id);
  if (!identity || !sameEmail(invitation.email, identity.email)) {
    return { ok: false, reason: "email_mismatch", invitedEmail: invitation.email };
  }
  if (!identity.emailVerified) {
    return { ok: false, reason: "unverified" };
  }

  await prisma.$transaction([
    prisma.membership.upsert({
      where: {
        userId_organizationId: { userId: user.id, organizationId: invitation.organizationId },
      },
      update: {},
      create: { userId: user.id, organizationId: invitation.organizationId, role: invitation.role },
    }),
    prisma.invitation.update({
      where: { id: invitation.id },
      data: { acceptedAt: new Date() },
    }),
  ]);

  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: invitation.organizationId },
  });

  await notifyUser({
    organizationId: org.id,
    userId: invitation.invitedById,
    type: NotificationType.INVITE_ACCEPTED,
    title: `${user.name ?? user.email} accepted your invite to ${org.name}`,
    linkUrl: `/app/${org.slug}/settings/members`,
  });

  return { ok: true, orgId: org.id, orgSlug: org.slug };
}
