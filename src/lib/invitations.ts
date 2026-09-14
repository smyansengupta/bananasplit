import { createHash, randomBytes } from "node:crypto";

import { NotificationType, type Invitation } from "@/generated/prisma/client";
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

export function findPendingInvitationsForEmail(email: string) {
  return prisma.invitation.findMany({
    where: { email, acceptedAt: null, expiresAt: { gt: new Date() } },
    include: { organization: true },
    orderBy: { createdAt: "desc" },
  });
}

export type AcceptInvitationResult =
  | { ok: true; orgId: string; orgSlug: string }
  | { ok: false; reason: "already_used" | "expired" | "email_mismatch"; invitedEmail?: string };

/**
 * Shared accept logic for both entry points: the emailed /invite/[token]
 * link, and the onboarding page's "Join" button for an already-verified
 * signed-in email. Membership + marking the invite accepted happen in one
 * transaction so a retry can never double-join or silently skip either.
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
  if (invitation.email.toLowerCase() !== user.email.toLowerCase()) {
    return { ok: false, reason: "email_mismatch", invitedEmail: invitation.email };
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
