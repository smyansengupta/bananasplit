"use server";

import { z } from "zod";

import {
  PositionMatchState,
  Role,
  TransactionKind,
  TransactionStatus,
} from "@/generated/prisma/client";
import { ForbiddenError, NotFoundError } from "@/lib/auth/errors";
import { canManageMembers, removalDenial, roleChangeDenial } from "@/lib/auth/member-roles";
import { withOrgAction, withSystemOrgTx, type OrgContext } from "@/server/db/context";

/**
 * Member management (0A Fix 3 and the removal cleanup).
 *
 * Both actions run on app_user through withOrgAction, so RLS makes Membership
 * writes admin-only and the membership_guard trigger enforces the OWNER rules
 * again in the database. The app-level rules (src/lib/auth/member-roles.ts)
 * give a clear message first:
 *   - only an OWNER grants or revokes OWNER, or touches an OWNER's row;
 *   - nobody changes their own role or removes themselves here;
 *   - the last OWNER stays. That check and the write share one transaction,
 *     after SELECT ... FOR UPDATE on the org's OWNER rows and the target's
 *     row, so two owners demoting each other concurrently cannot both pass.
 */

const roleSchema = z.enum([Role.OWNER, Role.ADMIN, Role.TREASURER, Role.MEMBER]);

interface ActionResult {
  error?: string;
}

interface LockedMember {
  userId: string;
  role: Role;
}

/**
 * Locks, for the rest of the transaction, every OWNER row of the org plus
 * the target's row, and returns them. Under READ COMMITTED a waiter re-checks
 * the WHERE clause against the committed row, so an OWNER demoted by a
 * concurrent transaction drops out of the result.
 */
async function lockOwnersAndTarget(ctx: OrgContext, targetUserId: string) {
  const rows = await ctx.db.$queryRaw<LockedMember[]>`
    SELECT "userId", "role"::text AS "role"
      FROM "Membership"
     WHERE "organizationId" = ${ctx.organizationId}
       AND ("role" = 'OWNER' OR "userId" = ${targetUserId})
       FOR UPDATE`;
  const target = rows.find((row) => row.userId === targetUserId);
  const ownerCount = rows.filter((row) => row.role === Role.OWNER).length;
  return { target, ownerCount };
}

export const changeMemberRole = withOrgAction(
  async (ctx, targetUserId: string, requestedRole: Role): Promise<ActionResult> => {
    if (!canManageMembers(ctx.role)) {
      throw new ForbiddenError("Only owners and admins can manage members.");
    }
    const parsedRole = roleSchema.safeParse(requestedRole);
    if (!parsedRole.success) return { error: "Choose a valid role." };
    const newRole = parsedRole.data;

    if (targetUserId === ctx.userId) {
      return { error: "You can't change your own role." };
    }

    const { target, ownerCount } = await lockOwnersAndTarget(ctx, targetUserId);
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

    if (target.role === Role.OWNER && ownerCount <= 1) {
      return { error: "Cannot demote the last owner." };
    }

    await ctx.db.membership.update({
      where: { userId_organizationId: { userId: targetUserId, organizationId: ctx.organizationId } },
      data: { role: newRole },
    });
    return {};
  },
);

export const removeMember = withOrgAction(
  async (ctx, targetUserId: string): Promise<ActionResult> => {
    if (!canManageMembers(ctx.role)) {
      throw new ForbiddenError("Only owners and admins can manage members.");
    }
    if (targetUserId === ctx.userId) {
      return { error: "You can't remove yourself." };
    }

    const { target, ownerCount } = await lockOwnersAndTarget(ctx, targetUserId);
    if (!target) throw new NotFoundError();

    const denial = removalDenial({
      actorId: ctx.userId,
      actorRole: ctx.role,
      targetId: target.userId,
      targetRole: target.role,
    });
    if (denial) return { error: denial };

    if (target.role === Role.OWNER && ownerCount <= 1) {
      return { error: "Cannot remove the last owner." };
    }

    const outstanding = await ctx.db.transaction.count({
      where: {
        organizationId: ctx.organizationId,
        submittedById: targetUserId,
        kind: TransactionKind.EXPENSE,
        status: { in: [TransactionStatus.SUBMITTED, TransactionStatus.APPROVED] },
        voidedAt: null,
      },
    });
    if (outstanding > 0) {
      return {
        error: `This member has ${outstanding} unreimbursed expense${outstanding === 1 ? "" : "s"}. Settle or void ${outstanding === 1 ? "it" : "them"} before removing.`,
      };
    }

    const where = { organizationId: ctx.organizationId, userId: targetUserId };
    // Everything that ties the person to this org's work goes with the
    // membership, in the same transaction:
    //   - task assignments (their org-shared notes stay, editable by
    //     OWNER/ADMIN as before);
    //   - event invitations, so the org's events leave their ICS feed;
    //   - org chart positions revert to placeholders (the title stays).
    await ctx.db.taskAssignee.deleteMany({ where });
    await ctx.db.eventAttendee.deleteMany({ where });
    await ctx.db.orgChartPosition.updateMany({
      where,
      data: { userId: null, matchState: PositionMatchState.UNMATCHED, matchScore: null },
    });
    await ctx.db.membership.delete({
      where: { userId_organizationId: { userId: targetUserId, organizationId: ctx.organizationId } },
    });

    // Their notifications from this org go too. app_user can only read and
    // mark its OWN notifications, so the delete runs on the service path
    // once the removal has committed (a failure is logged, never surfaced:
    // the removal itself already succeeded).
    const organizationId = ctx.organizationId;
    const actorId = ctx.userId;
    ctx.afterCommit(async () => {
      await withSystemOrgTx(organizationId, { userId: actorId }, async ({ db }) => {
        await db.notification.deleteMany({ where: { organizationId, userId: targetUserId } });
      });
    });

    return {};
  },
);
