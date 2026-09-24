import { NotificationType, type Role } from "@/generated/prisma/client";
import { getUserIdentity } from "@/lib/auth/email-verification";
import { sameEmail } from "@/lib/auth/normalize-email";
import type { SessionUser } from "@/lib/auth/session";
import {
  hashInvitationToken,
  type AcceptInvitationResult,
  type InvitationForJoin,
} from "@/lib/invitations";
import { writeOrgAuditLog } from "@/server/audit";
import { tags } from "@/server/cache/tags";
import { invalidate } from "@/server/cache/invalidate";
import { withSystemOrgTx, withUserTx } from "@/server/db/context";
import { notifyUser } from "@/server/notifications";

/**
 * Joining an org by invitation, off the legacy role (Phase 1 / 0C PR 1).
 *
 * The joining user is not a member yet, so none of the tenant policies let
 * them read the invitation. The two enumerated no-context lookups are
 * SECURITY DEFINER functions from 0B:
 *   - app.invitation_by_token_hash(hash): the emailed link (app_service);
 *   - app.pending_invitations_for_me(): the onboarding Join card (app_user),
 *     which matches only the caller's VERIFIED stored email.
 * Acceptance then runs on the service path for the joining user,
 * withSystemOrgTx(orgId, { userId }): the only way a Membership row is ever
 * created (D6: app_service may insert a Membership only for app.user_id()).
 */

interface InvitationRow {
  id: string;
  organizationId: string;
  email: string;
  role: Role;
  expiresAt: Date;
  acceptedAt: Date | null;
  invitedById: string;
  orgName: string;
  orgSlug: string;
}

/** The invitation behind an emailed link, or null for an unknown token. */
export async function findInvitationByRawToken(
  rawToken: string,
): Promise<InvitationForJoin | null> {
  if (!rawToken || rawToken.length > 200) return null;
  const hash = hashInvitationToken(rawToken);
  const rows = await withSystemOrgTx(
    null,
    ({ db }) =>
      db.$queryRaw<InvitationRow[]>`
      SELECT "id", "organizationId", "email", "role", "expiresAt", "acceptedAt", "invitedById",
             "orgName", "orgSlug"
        FROM app.invitation_by_token_hash(${hash})`,
  );
  return rows[0] ?? null;
}

interface PendingRow {
  id: string;
  organizationId: string;
  role: Role;
  expiresAt: Date;
  orgName: string;
  orgSlug: string;
}

export interface PendingInvitation {
  id: string;
  organizationId: string;
  role: Role;
  expiresAt: Date;
  orgName: string;
}

/** Pending invitations to the caller's verified address (onboarding Join). */
export async function findPendingInvitationsForMe(userId: string): Promise<PendingInvitation[]> {
  const rows = await withUserTx(
    userId,
    ({ db }) =>
      db.$queryRaw<PendingRow[]>`
      SELECT "id", "organizationId", "role", "expiresAt", "orgName", "orgSlug"
        FROM app.pending_invitations_for_me()`,
  );
  return rows
    .map((r) => ({
      id: r.id,
      organizationId: r.organizationId,
      role: r.role,
      expiresAt: r.expiresAt,
      orgName: r.orgName,
    }))
    .sort((a, b) => a.orgName.localeCompare(b.orgName));
}

/**
 * Accepts `invitation` for `user`. The invite is taken only by the account
 * whose STORED email equals the invited address (both normalized) and has
 * been verified (0A Fix 4). The membership insert, the acceptedAt mark, the
 * audit row and the inviter's notification share one service transaction,
 * which re-reads the invitation under a row lock, so a double click or two
 * tabs can never double-join or skip either write.
 */
export async function acceptInvitation(
  invitation: Pick<InvitationForJoin, "id" | "organizationId" | "expiresAt" | "acceptedAt"> & {
    /** The invited address, when the caller has it (the emailed link); the locked row decides. */
    email?: string;
  },
  user: SessionUser,
): Promise<AcceptInvitationResult> {
  if (invitation.acceptedAt) return { ok: false, reason: "already_used" };
  if (invitation.expiresAt < new Date()) return { ok: false, reason: "expired" };

  const identity = await getUserIdentity(user.id);
  if (
    !identity ||
    (invitation.email !== undefined && !sameEmail(invitation.email, identity.email))
  ) {
    return { ok: false, reason: "email_mismatch", invitedEmail: invitation.email };
  }
  if (!identity.emailVerified) return { ok: false, reason: "unverified" };

  const orgId = invitation.organizationId;
  const result = await withSystemOrgTx(orgId, { userId: user.id }, async ({ db }) => {
    const locked = await db.$queryRaw<
      {
        id: string;
        email: string;
        role: Role;
        expiresAt: Date;
        acceptedAt: Date | null;
        invitedById: string;
      }[]
    >`
      SELECT "id", "email", "role", "expiresAt", "acceptedAt", "invitedById"
        FROM "Invitation" WHERE "id" = ${invitation.id} AND "organizationId" = ${orgId}
         FOR UPDATE`;
    const row = locked[0];
    if (!row) return { ok: false as const, reason: "already_used" as const };
    if (row.acceptedAt) return { ok: false as const, reason: "already_used" as const };
    if (row.expiresAt < new Date()) return { ok: false as const, reason: "expired" as const };
    if (!sameEmail(row.email, identity.email)) {
      return { ok: false as const, reason: "email_mismatch" as const, invitedEmail: row.email };
    }

    const org = await db.organization.findUnique({
      where: { id: orgId },
      select: { name: true, slug: true, deletedAt: true },
    });
    if (!org || org.deletedAt) return { ok: false as const, reason: "org_inactive" as const };

    const existing = await db.membership.findUnique({
      where: { userId_organizationId: { userId: user.id, organizationId: orgId } },
      select: { id: true },
    });
    if (!existing) {
      await db.membership.create({
        data: { userId: user.id, organizationId: orgId, role: row.role },
      });
    }
    await db.invitation.update({ where: { id: row.id }, data: { acceptedAt: new Date() } });
    await writeOrgAuditLog(db, {
      organizationId: orgId,
      action: "invitation.accepted",
      targetType: "Invitation",
      targetId: row.id,
      diff: { role: row.role, alreadyMember: Boolean(existing) },
    });

    const inviterIsMember = await db.membership.findUnique({
      where: { userId_organizationId: { userId: row.invitedById, organizationId: orgId } },
      select: { id: true },
    });
    if (inviterIsMember && row.invitedById !== user.id) {
      await notifyUser(db, orgId, row.invitedById, {
        type: NotificationType.INVITE_ACCEPTED,
        title: `${user.name ?? identity.email} accepted your invite to ${org.name}`,
        linkUrl: `/app/${org.slug}/settings/members`,
        actorId: user.id,
      });
    }
    return { ok: true as const, orgId, orgSlug: org.slug };
  });
  if (result.ok) invalidate([tags.members(orgId)]);
  return result;
}
