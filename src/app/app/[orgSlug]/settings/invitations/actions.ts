"use server";

import { z } from "zod";

import { Role } from "@/generated/prisma/client";
import { ForbiddenError } from "@/lib/auth/errors";
import { withOrgContext } from "@/lib/auth/with-org-context";
import { generateInvitationToken, INVITATION_EXPIRY_DAYS } from "@/lib/invitations";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, rateLimitKey, retryAfterText } from "@/lib/rate-limit";
import { enqueueJob } from "@/server/jobs/enqueue";

const INVITE_RATE_LIMIT = 20;
const INVITE_RATE_WINDOW_SEC = 60 * 60;

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

    // Per org, shared across instances (Postgres-backed limiter).
    const rateLimit = await checkRateLimit(
      rateLimitKey("invite", ctx.organizationId),
      INVITE_RATE_LIMIT,
      INVITE_RATE_WINDOW_SEC,
    );
    if (!rateLimit.allowed) {
      return { error: `Too many invites sent recently. Try again ${retryAfterText(rateLimit)}.` };
    }

    const parsed = inviteSchema.safeParse(input);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }

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

    // The stored hash is a placeholder until the invite-email job mints the
    // emailed link (only a hash is ever stored, so the link can only be
    // created where it is sent).
    const { tokenHash } = generateInvitationToken();
    const expiresAt = new Date(Date.now() + INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    await prisma.$transaction(async (tx) => {
      const invitation = await tx.invitation.create({
        data: {
          organizationId: ctx.organizationId,
          email: parsed.data.email,
          role: parsed.data.role,
          token: tokenHash,
          expiresAt,
          invitedById: ctx.user.id,
        },
        select: { id: true },
      });
      // Outbox: the email is sent after commit, never for a rolled-back invite.
      await enqueueJob(tx, {
        orgId: ctx.organizationId,
        kind: "invite-email",
        key: invitation.id,
        payload: { invitationId: invitation.id },
      });
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
