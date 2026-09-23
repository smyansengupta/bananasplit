import { Role } from "@/generated/prisma/enums";
import { assignableRoles as permittedRoles, can } from "@/lib/auth/permissions";

/**
 * Who may change whose permission role (0A Fix 3). Pure rules, shared by the
 * member actions (the authority) and the members page (which only hides what
 * the server would refuse anyway). The role sets come from PERMISSIONS in
 * ./permissions.ts (members.changeRole, members.remove, members.grantOwner);
 * this module adds the member-admin messages and the no-self-service rule.
 * The database enforces the OWNER rules a second time in the
 * membership_guard trigger for app_user and app_service.
 *
 * - Only OWNER and ADMIN manage members.
 * - Only an OWNER grants or revokes OWNER, or acts on an OWNER's row at all
 *   (an ADMIN can neither demote nor remove an OWNER).
 * - Nobody changes their own role or removes themselves here: leaving and
 *   ownership transfer are separate, explicit flows.
 * - The last OWNER can never be demoted or removed (checked by the caller
 *   inside the locking transaction, since it depends on other rows).
 */

export const ALL_ROLES: readonly Role[] = [Role.OWNER, Role.ADMIN, Role.TREASURER, Role.MEMBER];

export function canManageMembers(role: Role | null | undefined): boolean {
  return can({ role }, "members.changeRole") && can({ role }, "members.remove");
}

function canTouchOwner(role: Role | null | undefined): boolean {
  return can({ role }, "members.grantOwner");
}

/** The roles `actorRole` may hand out (the members page dropdown). */
export function assignableRoles(actorRole: Role | null | undefined): Role[] {
  return permittedRoles(actorRole);
}

/** Whether `actorRole` may act on (change or remove) a member holding `targetRole`. */
export function canActOnMember(
  actorRole: Role | null | undefined,
  targetRole: Role,
): boolean {
  if (!canManageMembers(actorRole)) return false;
  if (targetRole === Role.OWNER) return canTouchOwner(actorRole);
  return true;
}

interface MemberChange {
  actorId: string;
  actorRole: Role | null | undefined;
  targetId: string;
  targetRole: Role;
}

/** Why a role change is refused, or null when the rules allow it. */
export function roleChangeDenial(change: MemberChange & { newRole: Role }): string | null {
  if (!canManageMembers(change.actorRole)) {
    return "Only owners and admins can manage members.";
  }
  if (change.actorId === change.targetId) {
    return "You can't change your own role.";
  }
  if (change.targetRole === Role.OWNER && !canTouchOwner(change.actorRole)) {
    return "Only an owner can change another owner's role.";
  }
  if (change.newRole === Role.OWNER && !canTouchOwner(change.actorRole)) {
    return "Only an owner can make someone an owner.";
  }
  return null;
}

/** Why a removal is refused, or null when the rules allow it. */
export function removalDenial(change: MemberChange): string | null {
  if (!canManageMembers(change.actorRole)) {
    return "Only owners and admins can manage members.";
  }
  if (change.actorId === change.targetId) {
    return "You can't remove yourself.";
  }
  if (change.targetRole === Role.OWNER && !canTouchOwner(change.actorRole)) {
    return "Only an owner can remove another owner.";
  }
  return null;
}
