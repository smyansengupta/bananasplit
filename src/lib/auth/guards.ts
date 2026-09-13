import { Role } from "@/generated/prisma/client";
import { ForbiddenError, NotFoundError } from "@/lib/auth/errors";
import { requireUser, type SessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

export interface OrgContext {
  user: SessionUser;
  organizationId: string;
  role: Role;
}

/**
 * Org-management rank. TREASURER is deliberately not part of this ladder —
 * it carries finance authority (see requireFinanceAccess) plus ordinary
 * member authority everywhere else, the same as MEMBER.
 */
const ORG_ROLE_RANK: Record<Role, number> = {
  OWNER: 3,
  ADMIN: 2,
  TREASURER: 1,
  MEMBER: 1,
};

/**
 * Verifies the current user belongs to the org. Throws NotFoundError (never
 * ForbiddenError) for a non-member, so a request can't be used to probe
 * whether an organization exists.
 */
export async function requireOrgMembership(organizationId: string): Promise<OrgContext> {
  const user = await requireUser();
  const membership = await prisma.membership.findUnique({
    where: { userId_organizationId: { userId: user.id, organizationId } },
  });
  if (!membership) {
    throw new NotFoundError();
  }
  return { user, organizationId, role: membership.role };
}

/** Gates org-management actions (invite/remove members, edit any task/note/event). */
export async function requireRole(
  organizationId: string,
  minRole: Exclude<Role, "TREASURER">,
): Promise<OrgContext> {
  const ctx = await requireOrgMembership(organizationId);
  if (ORG_ROLE_RANK[ctx.role] < ORG_ROLE_RANK[minRole]) {
    throw new ForbiddenError();
  }
  return ctx;
}

/** Gates finance actions. Sideways from requireRole: OWNER or TREASURER, nothing else. */
export async function requireFinanceAccess(organizationId: string): Promise<OrgContext> {
  const ctx = await requireOrgMembership(organizationId);
  if (ctx.role !== Role.OWNER && ctx.role !== Role.TREASURER) {
    throw new ForbiddenError();
  }
  return ctx;
}
