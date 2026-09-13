"use server";

import { Role, TransactionKind, TransactionStatus } from "@/generated/prisma/client";
import { requireOrgMembership } from "@/lib/auth/guards";
import { ForbiddenError, NotFoundError } from "@/lib/auth/errors";
import { prisma } from "@/lib/prisma";

function assertCanManageMembers(role: Role) {
  if (role !== Role.OWNER && role !== Role.ADMIN) {
    throw new ForbiddenError("Only owners and admins can manage members.");
  }
}

export async function changeMemberRole(
  organizationId: string,
  targetUserId: string,
  newRole: Role,
): Promise<{ error?: string }> {
  const ctx = await requireOrgMembership(organizationId);
  assertCanManageMembers(ctx.role);

  const target = await prisma.membership.findUnique({
    where: { userId_organizationId: { userId: targetUserId, organizationId } },
  });
  if (!target) {
    throw new NotFoundError();
  }

  if (target.role === Role.OWNER && newRole !== Role.OWNER) {
    const ownerCount = await prisma.membership.count({
      where: { organizationId, role: Role.OWNER },
    });
    if (ownerCount <= 1) {
      return { error: "Cannot demote the last owner." };
    }
  }

  await prisma.membership.update({
    where: { userId_organizationId: { userId: targetUserId, organizationId } },
    data: { role: newRole },
  });
  return {};
}

export async function removeMember(
  organizationId: string,
  targetUserId: string,
): Promise<{ error?: string }> {
  const ctx = await requireOrgMembership(organizationId);
  assertCanManageMembers(ctx.role);

  const target = await prisma.membership.findUnique({
    where: { userId_organizationId: { userId: targetUserId, organizationId } },
  });
  if (!target) {
    throw new NotFoundError();
  }

  if (target.role === Role.OWNER) {
    const ownerCount = await prisma.membership.count({
      where: { organizationId, role: Role.OWNER },
    });
    if (ownerCount <= 1) {
      return { error: "Cannot remove the last owner." };
    }
  }

  const outstanding = await prisma.transaction.count({
    where: {
      organizationId,
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

  // Task assignments are unassigned. Their org-shared notes aren't
  // reassigned to a different owner field — there isn't one — they simply
  // remain visible org-wide and editable by any OWNER/ADMIN, same as while
  // the author was still a member.
  await prisma.$transaction([
    prisma.taskAssignee.deleteMany({
      where: { userId: targetUserId, task: { organizationId } },
    }),
    prisma.membership.delete({
      where: { userId_organizationId: { userId: targetUserId, organizationId } },
    }),
  ]);
  return {};
}
