// The enums entry, not the client: this module is also imported by client
// components (to hide controls), and must stay free of server code.
import { Role } from "@/generated/prisma/enums";

import { ForbiddenError } from "./errors";

/**
 * Role-based permissions, the one place the app decides who may do what.
 * Replaces inline `role === OWNER || role === ADMIN` checks.
 *
 * Roles: OWNER, ADMIN, TREASURER and MEMBER. TREASURER is a lateral finance
 * role (finance authority, otherwise a MEMBER). An org-chart position never
 * implies a role. The database enforces the same rules where it matters
 * (RLS policies, membership_guard, organization_guard, transaction_guard);
 * these checks give friendly errors and hide controls.
 */

const ALL: readonly Role[] = [Role.OWNER, Role.ADMIN, Role.TREASURER, Role.MEMBER];
const ADMINS: readonly Role[] = [Role.OWNER, Role.ADMIN];
const OWNER: readonly Role[] = [Role.OWNER];
const FINANCE: readonly Role[] = [Role.OWNER, Role.TREASURER];

export const PERMISSIONS = {
  // Settings > General
  "settings.view": ADMINS,
  "settings.general.write": ADMINS,
  "org.slug.write": OWNER,
  "org.logo.write": ADMINS,
  // Members and roles
  "members.view": ALL,
  "members.invite": ADMINS,
  "members.remove": ADMINS,
  "members.changeRole": ADMINS,
  /** Grant or revoke OWNER, or act on an OWNER's membership. */
  "members.grantOwner": OWNER,
  "members.transferOwnership": OWNER,
  "members.setTitle": ADMINS,
  /** Any member may leave (the last OWNER must transfer ownership first). */
  "members.leave": ALL,
  /** Admins always see member emails; members only when Privacy allows. */
  "members.viewEmails": ADMINS,
  // Integrations and secrets (D5): ADMIN+ set, replace and test; OWNER removes.
  "integrations.view": ADMINS,
  "integrations.write": ADMINS,
  "integrations.remove": OWNER,
  // Privacy, theme, labels
  "privacy.write": ADMINS,
  /**
   * Who may see individual votes. OWNER-only (also in the database): an
   * ADMIN who could set OWNER_AND_ADMINS would grant themselves the votes.
   */
  "privacy.ballots": OWNER,
  /** Turning off the platform mail fallback by hand (connecting a sender clears it too). */
  "mail.fallback.write": OWNER,
  "theme.write": ADMINS,
  "labels.write": ADMINS,
  // Danger zone
  "org.export": OWNER,
  "org.export.download": OWNER,
  "org.delete": OWNER,
  "workspace.bootstrap": OWNER,
  // Calendar and sessions: the event service is ADMIN+.
  "events.write": ADMINS,
  // Org chart
  "orgchart.view": ALL,
  "orgchart.write": ADMINS,
  // Databases and reports
  "databases.view": ALL,
  "databases.write": ADMINS,
  "databases.export": ALL,
  "reports.view": ALL,
  // Tasks
  "tasks.manageAll": ADMINS,
  // Finance
  "finance.manage": FINANCE,
  "finance.submit": ALL,
  // Operations
  "jobs.view": ADMINS,
  "audit.view": ADMINS,
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

/** Anything that carries the caller's role in the org (OrgContext and friends). */
export interface RoleHolder {
  role: Role | null | undefined;
}

/** True when `ctx.role` holds `permission`. A missing role holds nothing. */
export function can(ctx: RoleHolder, permission: Permission): boolean {
  const role = ctx.role;
  if (!role) return false;
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

/** Throws ForbiddenError unless `ctx.role` holds `permission`. */
export function requirePermission(ctx: RoleHolder, permission: Permission): void {
  if (!can(ctx, permission)) {
    throw new ForbiddenError("You don't have permission to do that.");
  }
}

/** The roles an actor may put in the role dropdown (ADMINs never see OWNER). */
export function assignableRoles(actorRole: Role | null | undefined): Role[] {
  if (actorRole === Role.OWNER) return [Role.OWNER, Role.ADMIN, Role.TREASURER, Role.MEMBER];
  if (actorRole === Role.ADMIN) return [Role.ADMIN, Role.TREASURER, Role.MEMBER];
  return [];
}

/**
 * Whether `actorRole` may change a membership from `fromRole` to `toRole`.
 * Only an OWNER grants or revokes OWNER (or touches an OWNER's row), only
 * OWNER/ADMIN change roles at all, and nobody changes their own role
 * (pass `isSelf`). The last-owner rule is enforced by the database.
 */
export function canChangeRole(
  actorRole: Role | null | undefined,
  fromRole: Role,
  toRole: Role,
  isSelf = false,
): boolean {
  if (isSelf || !actorRole) return false;
  if (!can({ role: actorRole }, "members.changeRole")) return false;
  if (fromRole === Role.OWNER || toRole === Role.OWNER) {
    return can({ role: actorRole }, "members.grantOwner");
  }
  return true;
}

/** Whether `actorRole` may remove a member whose role is `targetRole`. */
export function canRemoveMember(
  actorRole: Role | null | undefined,
  targetRole: Role,
  isSelf = false,
): boolean {
  if (isSelf) return true; // leaving; the database keeps the last OWNER
  if (!can({ role: actorRole }, "members.remove")) return false;
  return targetRole !== Role.OWNER || can({ role: actorRole }, "members.grantOwner");
}
