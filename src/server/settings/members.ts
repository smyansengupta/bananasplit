import {
  OrgChartVersionStatus,
  PositionMatchState,
  Role,
  TaskStatus,
  TransactionKind,
  TransactionStatus,
} from "@/generated/prisma/client";
import { tags } from "@/server/cache/tags";
import { invalidate } from "@/server/cache/invalidate";
import { withSystemOrgTx, type OrgContext, type TxClient } from "@/server/db/context";

/**
 * Member lifecycle helpers shared by the Settings > Members actions
 * (remove, change role, transfer ownership, leave).
 *
 * The OWNER rules live in three places on purpose: src/lib/auth/member-roles
 * gives the friendly message, these helpers take the row locks the last-owner
 * check needs, and app.membership_guard enforces the same rules again in the
 * database for app_user and app_service.
 */

export interface LockedMember {
  userId: string;
  role: Role;
}

/**
 * Locks, for the rest of the transaction, every OWNER row of the org plus
 * `userIds`' rows, and returns them. Under READ COMMITTED a waiter re-checks
 * the WHERE clause against the committed row, so an OWNER demoted by a
 * concurrent transaction drops out of the result: two owners demoting each
 * other at once cannot both pass the last-owner check.
 */
export async function lockOwnersAnd(
  ctx: Pick<OrgContext, "db" | "organizationId">,
  userIds: readonly string[],
): Promise<{
  rows: LockedMember[];
  ownerCount: number;
  find: (id: string) => LockedMember | undefined;
}> {
  const ids = [...new Set(userIds)];
  const rows = await ctx.db.$queryRaw<LockedMember[]>`
    SELECT "userId", "role"::text AS "role"
      FROM "Membership"
     WHERE "organizationId" = ${ctx.organizationId}
       AND ("role" = 'OWNER' OR "userId" = ANY(${ids}::text[]))
       FOR UPDATE`;
  return {
    rows,
    ownerCount: rows.filter((row) => row.role === Role.OWNER).length,
    find: (id) => rows.find((row) => row.userId === id),
  };
}

/** Open expense claims that must be settled before a member leaves or is removed. */
export async function outstandingExpenses(
  db: TxClient,
  organizationId: string,
  userId: string,
): Promise<number> {
  return db.transaction.count({
    where: {
      organizationId,
      submittedById: userId,
      kind: TransactionKind.EXPENSE,
      status: { in: [TransactionStatus.SUBMITTED, TransactionStatus.APPROVED] },
      voidedAt: null,
    },
  });
}

export function outstandingExpensesMessage(n: number, self: boolean): string {
  const noun = `unreimbursed expense${n === 1 ? "" : "s"}`;
  const it = n === 1 ? "it" : "them";
  return self
    ? `You have ${n} ${noun}. Settle or void ${it} before leaving.`
    : `This member has ${n} ${noun}. Settle or void ${it} before removing.`;
}

/**
 * Unties a departing member (removed, or leaving) from the org's work, in
 * the caller's transaction, BEFORE the Membership row goes:
 *   - task assignments and event invitations (so the org's events leave
 *     their ICS feed);
 *   - ownership of open tasks (they become unowned and anyone can claim
 *     them; completed tasks keep their owner as history) and intake triage;
 *   - org chart positions revert to placeholders (the title stays), and the
 *     member drops out of draft match suggestions.
 * Their notes, comments and past events stay, authored by a former member.
 *
 * Runs on app_user: an ADMIN's removal can do all of it. A MEMBER who
 * leaves cannot update org chart rows (admin-only RLS), so
 * cleanupAfterDeparture repeats the org-chart step on the service path.
 */
export async function untieDepartingMember(
  db: TxClient,
  organizationId: string,
  userId: string,
): Promise<void> {
  const where = { organizationId, userId };
  await db.taskAssignee.deleteMany({ where });
  await db.eventAttendee.deleteMany({ where });
  await db.task.updateMany({
    where: {
      organizationId,
      ownerId: userId,
      status: { not: TaskStatus.COMPLETED },
      deletedAt: null,
    },
    data: { ownerId: null, ownerRelation: null, ownerFlagged: false, ownerAssignedById: null },
  });
  await db.project.updateMany({
    where: { organizationId, triageUserId: userId },
    data: { triageUserId: null },
  });
  await untieOrgChart(db, organizationId, userId);
}

async function untieOrgChart(db: TxClient, organizationId: string, userId: string): Promise<void> {
  await db.orgChartPosition.updateMany({
    where: { organizationId, userId },
    data: { userId: null, matchState: PositionMatchState.UNMATCHED, matchScore: null },
  });
  await db.$executeRaw`
    UPDATE "OrgChartPosition" p
       SET "suggestedUserIds" = array_remove(p."suggestedUserIds", ${userId}::text)
      FROM "OrgChartVersion" v
     WHERE v."id" = p."versionId"
       AND v."status" = ${OrgChartVersionStatus.DRAFT}::"OrgChartVersionStatus"
       AND p."organizationId" = ${organizationId}
       AND ${userId}::text = ANY (p."suggestedUserIds")`;
}

/**
 * The service-path half of a departure, after the Membership delete has
 * committed: the member's notifications from this org (app_user can only
 * read and mark its OWN notifications) and the org-chart step (for a member
 * who left on their own, whose RLS cannot touch the chart). Idempotent.
 * `actorId` is recorded as app.user_id().
 */
export async function cleanupAfterDeparture(
  organizationId: string,
  userId: string,
  actorId: string,
): Promise<void> {
  await withSystemOrgTx(organizationId, { userId: actorId }, async ({ db }) => {
    await db.notification.deleteMany({ where: { organizationId, userId } });
    await untieOrgChart(db, organizationId, userId);
  });
  invalidate([tags.orgChart(organizationId), tags.members(organizationId)]);
}
