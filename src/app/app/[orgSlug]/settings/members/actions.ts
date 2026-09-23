"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { NotificationType, Role } from "@/generated/prisma/client";
import { ForbiddenError, NotFoundError } from "@/lib/auth/errors";
import { canManageMembers, removalDenial, roleChangeDenial } from "@/lib/auth/member-roles";
import { can, requirePermission } from "@/lib/auth/permissions";
import { generateInvitationToken, invitationExpiry } from "@/lib/invitations";
import { checkRateLimit, rateLimitKey, retryAfterText } from "@/lib/rate-limit";
import { writeOrgAuditLog } from "@/server/audit";
import { tags } from "@/server/cache/tags";
import { invalidate } from "@/server/cache/invalidate";
import { withOrgAction, type OrgContext } from "@/server/db/context";
import { enqueueJob } from "@/server/jobs/enqueue";
import { notifyUser } from "@/server/notifications";
import {
  cleanupAfterDeparture,
  lockOwnersAnd,
  outstandingExpenses,
  outstandingExpensesMessage,
  untieDepartingMember,
} from "@/server/settings/members";

/**
 * Settings > Members: the roster and the invitations, on app_user through
 * withOrgAction (RLS makes Membership and Invitation writes admin-only, and
 * app.membership_guard enforces the OWNER rules again in the database).
 *
 * The app-level rules (src/lib/auth/member-roles.ts) give the message first:
 *   - only an OWNER grants or revokes OWNER, or touches an OWNER's row;
 *   - nobody changes their own role or removes themselves here: leaving and
 *     transferring ownership are their own explicit actions;
 *   - the last OWNER stays. That check and the write share one transaction,
 *     after SELECT ... FOR UPDATE on the org's OWNER rows and the target's.
 * No action here inserts a Membership row: they are created only on the
 * service path, at invite acceptance and at org creation (D6).
 */

export interface ActionResult {
  error?: string;
}

const roleSchema = z.enum([Role.OWNER, Role.ADMIN, Role.TREASURER, Role.MEMBER]);
const idSchema = z.string().min(1).max(100);

const INVITE_RATE_LIMIT = 20;
const INVITE_RATE_WINDOW_SEC = 60 * 60;

const inviteSchema = z.object({
  // Stored as lower(btrim()) so acceptance and the pending-invite lookup
  // match the invitee's account whatever case they type (0A Fix 4(a)).
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")),
  // Never OWNER: ownership is granted to an existing member (RLS agrees).
  role: z.enum([Role.ADMIN, Role.TREASURER, Role.MEMBER]),
});

const titleSchema = z
  .string()
  .trim()
  .max(80, "Titles are at most 80 characters.")
  .transform((t) => (t === "" ? null : t));

async function inviteRateLimited(organizationId: string): Promise<string | null> {
  // Per org, shared across instances (Postgres-backed limiter).
  const limited = await checkRateLimit(
    rateLimitKey("invite", organizationId),
    INVITE_RATE_LIMIT,
    INVITE_RATE_WINDOW_SEC,
  );
  return limited.allowed
    ? null
    : `Too many invites sent recently. Try again ${retryAfterText(limited)}.`;
}

function refreshMembers(ctx: OrgContext) {
  invalidate([tags.members(ctx.organizationId), tags.orgChart(ctx.organizationId)]);
}

// ---------------------------------------------------------------- Invitations

export const inviteMember = withOrgAction(
  async (ctx, input: { email: string; role: Role }): Promise<ActionResult> => {
    requirePermission(ctx, "members.invite");
    const parsed = inviteSchema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    const { email, role } = parsed.data;

    const limited = await inviteRateLimited(ctx.organizationId);
    if (limited) return { error: limited };

    const existingMember = await ctx.db.membership.findFirst({
      where: { organizationId: ctx.organizationId, user: { email } },
      select: { id: true },
    });
    if (existingMember) return { error: "This person is already a member." };

    const existingInvite = await ctx.db.invitation.findFirst({
      where: {
        organizationId: ctx.organizationId,
        email,
        acceptedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
    if (existingInvite)
      return { error: "There's already a pending invite for this email. Resend it instead." };

    // The stored hash is a placeholder until the invite-email job mints the
    // emailed link (only a hash is ever stored, so the link exists only
    // where it is sent).
    const { tokenHash } = generateInvitationToken();
    const invitation = await ctx.db.invitation.create({
      data: {
        organizationId: ctx.organizationId,
        email,
        role,
        token: tokenHash,
        expiresAt: invitationExpiry(),
        invitedById: ctx.userId,
      },
      select: { id: true },
    });
    // Outbox: sent after commit, never for a rolled-back invite.
    await enqueueJob(ctx.db, {
      orgId: ctx.organizationId,
      kind: "invite-email",
      key: invitation.id,
      payload: { invitationId: invitation.id },
    });
    await writeOrgAuditLog(ctx.db, {
      organizationId: ctx.organizationId,
      action: "invitation.created",
      targetType: "Invitation",
      targetId: invitation.id,
      diff: { role },
    });
    return {};
  },
);

/** Sends a fresh link (the old one stops working) and restarts the 7-day expiry. */
export const resendInvitation = withOrgAction(
  async (ctx, invitationId: string): Promise<ActionResult> => {
    requirePermission(ctx, "members.invite");
    const id = idSchema.parse(invitationId);
    const limited = await inviteRateLimited(ctx.organizationId);
    if (limited) return { error: limited };

    const invite = await ctx.db.invitation.findFirst({
      where: { id, organizationId: ctx.organizationId },
      select: { id: true, acceptedAt: true },
    });
    if (!invite) throw new NotFoundError();
    if (invite.acceptedAt) return { error: "This invite was already accepted." };

    await ctx.db.invitation.update({ where: { id }, data: { expiresAt: invitationExpiry() } });
    await enqueueJob(ctx.db, {
      orgId: ctx.organizationId,
      kind: "invite-email",
      key: id,
      payload: { invitationId: id },
    });
    await writeOrgAuditLog(ctx.db, {
      organizationId: ctx.organizationId,
      action: "invitation.resent",
      targetType: "Invitation",
      targetId: id,
    });
    return {};
  },
);

export const revokeInvitation = withOrgAction(
  async (ctx, invitationId: string): Promise<ActionResult> => {
    requirePermission(ctx, "members.invite");
    const id = idSchema.parse(invitationId);
    const { count } = await ctx.db.invitation.deleteMany({
      where: { id, organizationId: ctx.organizationId, acceptedAt: null },
    });
    if (count > 0) {
      await writeOrgAuditLog(ctx.db, {
        organizationId: ctx.organizationId,
        action: "invitation.revoked",
        targetType: "Invitation",
        targetId: id,
      });
    }
    return {};
  },
);

// ---------------------------------------------------------------- Members

export const changeMemberRole = withOrgAction(
  async (ctx, targetUserId: string, requestedRole: Role): Promise<ActionResult> => {
    if (!canManageMembers(ctx.role)) {
      throw new ForbiddenError("Only owners and admins can manage members.");
    }
    const parsedRole = roleSchema.safeParse(requestedRole);
    if (!parsedRole.success) return { error: "Choose a valid role." };
    const newRole = parsedRole.data;

    if (targetUserId === ctx.userId) return { error: "You can't change your own role." };

    const locked = await lockOwnersAnd(ctx, [targetUserId]);
    const target = locked.find(targetUserId);
    if (!target) throw new NotFoundError();

    const denial = roleChangeDenial({
      actorId: ctx.userId,
      actorRole: ctx.role,
      targetId: target.userId,
      targetRole: target.role,
      newRole,
    });
    if (denial) return { error: denial };
    if (target.role === newRole) return {};
    if (target.role === Role.OWNER && locked.ownerCount <= 1) {
      return { error: "Cannot demote the last owner." };
    }

    await ctx.db.membership.update({
      where: {
        userId_organizationId: { userId: targetUserId, organizationId: ctx.organizationId },
      },
      data: { role: newRole },
    });
    await writeOrgAuditLog(ctx.db, {
      organizationId: ctx.organizationId,
      action: "member.role_changed",
      targetType: "User",
      targetId: targetUserId,
      diff: { from: target.role, to: newRole },
    });
    refreshMembers(ctx);
    return {};
  },
);

/** The per-org title ("VP Ops & Programs"), separate from the role and the chart position. */
export const setMemberTitle = withOrgAction(
  async (ctx, targetUserId: string, title: string): Promise<ActionResult> => {
    requirePermission(ctx, "members.setTitle");
    const parsed = titleSchema.safeParse(title);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid title" };

    const target = await ctx.db.membership.findUnique({
      where: {
        userId_organizationId: { userId: targetUserId, organizationId: ctx.organizationId },
      },
      select: { role: true, title: true },
    });
    if (!target) throw new NotFoundError();
    // An ADMIN edits their own title and non-owners' titles; only an OWNER
    // edits an OWNER's row (same rule as role changes).
    if (
      target.role === Role.OWNER &&
      targetUserId !== ctx.userId &&
      !can(ctx, "members.grantOwner")
    ) {
      return { error: "Only an owner can change another owner's title." };
    }
    if (target.title === parsed.data) return {};

    await ctx.db.membership.update({
      where: {
        userId_organizationId: { userId: targetUserId, organizationId: ctx.organizationId },
      },
      data: { title: parsed.data },
    });
    await writeOrgAuditLog(ctx.db, {
      organizationId: ctx.organizationId,
      action: "member.title_changed",
      targetType: "User",
      targetId: targetUserId,
      diff: { from: target.title, to: parsed.data },
    });
    refreshMembers(ctx);
    return {};
  },
);

export const removeMember = withOrgAction(
  async (ctx, targetUserId: string): Promise<ActionResult> => {
    if (!canManageMembers(ctx.role)) {
      throw new ForbiddenError("Only owners and admins can manage members.");
    }
    if (targetUserId === ctx.userId) {
      return { error: "You can't remove yourself. Use Leave organization instead." };
    }

    const locked = await lockOwnersAnd(ctx, [targetUserId]);
    const target = locked.find(targetUserId);
    if (!target) throw new NotFoundError();

    const denial = removalDenial({
      actorId: ctx.userId,
      actorRole: ctx.role,
      targetId: target.userId,
      targetRole: target.role,
    });
    if (denial) return { error: denial };
    if (target.role === Role.OWNER && locked.ownerCount <= 1) {
      return { error: "Cannot remove the last owner." };
    }

    const outstanding = await outstandingExpenses(ctx.db, ctx.organizationId, targetUserId);
    if (outstanding > 0) return { error: outstandingExpensesMessage(outstanding, false) };

    await untieDepartingMember(ctx.db, ctx.organizationId, targetUserId);
    await writeOrgAuditLog(ctx.db, {
      organizationId: ctx.organizationId,
      action: "member.removed",
      targetType: "User",
      targetId: targetUserId,
      diff: { role: target.role },
    });
    await ctx.db.membership.delete({
      where: {
        userId_organizationId: { userId: targetUserId, organizationId: ctx.organizationId },
      },
    });

    // Their notifications from this org go too, on the service path once
    // the removal has committed (a failure is logged, never surfaced: the
    // removal itself already succeeded).
    const { organizationId, userId: actorId } = ctx;
    ctx.afterCommit(() => cleanupAfterDeparture(organizationId, targetUserId, actorId));
    refreshMembers(ctx);
    return {};
  },
);

/**
 * Makes `targetUserId` an OWNER and the caller an ADMIN, in one transaction
 * (two Membership updates; membership_guard sees an OWNER granting, then an
 * OWNER stepping down while another OWNER exists).
 */
export const transferOwnership = withOrgAction(
  async (ctx, targetUserId: string): Promise<ActionResult> => {
    requirePermission(ctx, "members.transferOwnership");
    if (targetUserId === ctx.userId) return { error: "Choose another member." };

    const locked = await lockOwnersAnd(ctx, [targetUserId, ctx.userId]);
    const target = locked.find(targetUserId);
    if (!target) throw new NotFoundError();
    const self = locked.find(ctx.userId);
    if (self?.role !== Role.OWNER)
      throw new ForbiddenError("Only an owner can transfer ownership.");

    if (target.role !== Role.OWNER) {
      await ctx.db.membership.update({
        where: {
          userId_organizationId: { userId: targetUserId, organizationId: ctx.organizationId },
        },
        data: { role: Role.OWNER },
      });
    }
    await ctx.db.membership.update({
      where: { userId_organizationId: { userId: ctx.userId, organizationId: ctx.organizationId } },
      data: { role: Role.ADMIN },
    });
    await writeOrgAuditLog(ctx.db, {
      organizationId: ctx.organizationId,
      action: "member.ownership_transferred",
      targetType: "User",
      targetId: targetUserId,
      diff: { from: ctx.userId, previousRole: target.role },
    });
    const org = await ctx.db.organization.findUnique({
      where: { id: ctx.organizationId },
      select: { name: true, slug: true },
    });
    await notifyUser(ctx.db, ctx.organizationId, targetUserId, {
      type: NotificationType.SECURITY_ALERT,
      title: `You're now an owner of ${org?.name ?? "the organization"}`,
      body: `${ctx.user.name ?? ctx.user.email} transferred ownership to you. They are an admin now.`,
      linkUrl: org ? `/app/${org.slug}/settings/members` : null,
      actorId: ctx.userId,
    });
    refreshMembers(ctx);
    return {};
  },
);

/**
 * Leaves the org (deletes the caller's own Membership row). The last OWNER
 * must transfer ownership first. Redirects to /app on success.
 */
export const leaveOrg = withOrgAction(async (ctx): Promise<ActionResult> => {
  requirePermission(ctx, "members.leave");
  const locked = await lockOwnersAnd(ctx, [ctx.userId]);
  const self = locked.find(ctx.userId);
  if (!self) throw new NotFoundError();
  if (self.role === Role.OWNER && locked.ownerCount <= 1) {
    return {
      error:
        "You're the only owner. Transfer ownership to another member (or delete the organization) before leaving.",
    };
  }
  const outstanding = await outstandingExpenses(ctx.db, ctx.organizationId, ctx.userId);
  if (outstanding > 0) return { error: outstandingExpensesMessage(outstanding, true) };

  await untieDepartingMember(ctx.db, ctx.organizationId, ctx.userId);
  // Written before the delete: once the row is gone the caller is no longer
  // a member and app.write_org_audit refuses them.
  await writeOrgAuditLog(ctx.db, {
    organizationId: ctx.organizationId,
    action: "member.left",
    targetType: "User",
    targetId: ctx.userId,
    diff: { role: self.role },
  });
  await ctx.db.membership.delete({
    where: { userId_organizationId: { userId: ctx.userId, organizationId: ctx.organizationId } },
  });
  const { organizationId, userId } = ctx;
  ctx.afterCommit(() => cleanupAfterDeparture(organizationId, userId, userId));
  refreshMembers(ctx);
  redirect("/app");
});
