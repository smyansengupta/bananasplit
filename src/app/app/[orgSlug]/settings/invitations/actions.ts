"use server";

import { z } from "zod";

import { Role } from "@/generated/prisma/client";
import { ForbiddenError } from "@/lib/auth/errors";
import { withOrgContext } from "@/lib/auth/with-org-context";
import { sendInvitationEmail } from "@/lib/email";
import { generateInvitationToken, INVITATION_EXPIRY_DAYS } from "@/lib/invitations";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";

const INVITE_RATE_LIMIT = 20;
const INVITE_RATE_WINDOW_MS = 60 * 60 * 1000;

const inviteSchema = z.object({
  // Stored as lower(btrim()) so acceptance and the pending-invite lookup
  // match the invitee's account whatever case they type (0A Fix 4(a)).
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")),
  role: z.enum([Role.ADMIN, Role.TREASURER, Role.MEMBER]),
});

function assertCanManageMembers(role: Role) {
  if (role !== Role.OWNER && role !== Role.ADMIN) {
    throw new ForbiddenError("Only owners and admins can invite members.");
  }
}

export const inviteMember = withOrgContext(
  async (ctx, input: { email: string; role: Role }): Promise<{ error?: string }> => {
    assertCanManageMembers(ctx.role);

    const rateLimit = checkRateLimit(
      `invite:${ctx.organizationId}`,
      INVITE_RATE_LIMIT,
      INVITE_RATE_WINDOW_MS,
    );
    if (!rateLimit.allowed) {
      return { error: "Too many invites sent recently. Try again in a few minutes." };
    }

    const parsed = inviteSchema.safeParse(input);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }

    const org = await prisma.organization.findUniqueOrThrow({ where: { id: ctx.organizationId } });

    const existingMember = await prisma.membership.findFirst({
      where: { organizationId: ctx.organizationId, user: { email: parsed.data.email } },
    });
    if (existingMember) {
      return { error: "This person is already a member." };
    }

    const existingInvite = await prisma.invitation.findFirst({
      where: {
        organizationId: ctx.organizationId,
        email: parsed.data.email,
        acceptedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (existingInvite) {
      return { error: "There's already a pending invite for this email." };
    }

    const { token, tokenHash } = generateInvitationToken();
    const expiresAt = new Date(Date.now() + INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    await prisma.invitation.create({
      data: {
        organizationId: ctx.organizationId,
        email: parsed.data.email,
        role: parsed.data.role,
        token: tokenHash,
        expiresAt,
        invitedById: ctx.user.id,
      },
    });

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    await sendInvitationEmail({
      to: parsed.data.email,
      orgName: org.name,
      inviterName: ctx.user.name ?? ctx.user.email,
      role: parsed.data.role,
      acceptUrl: `${appUrl}/invite/${token}`,
    });

    return {};
  },
);

export const revokeInvitation = withOrgContext(async (ctx, invitationId: string): Promise<void> => {
  assertCanManageMembers(ctx.role);
  await prisma.invitation.deleteMany({
    where: { id: invitationId, organizationId: ctx.organizationId },
  });
});
