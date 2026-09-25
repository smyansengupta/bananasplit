import { Prisma, Role, TaskVisibility } from "@/generated/prisma/client";
import type { TxClient } from "@/server/db/context";

/**
 * The task-visibility predicate as a Prisma `where`, for the paths RLS does
 * NOT cover.
 *
 * On the request path (`withOrgAction` / `withOrgTx`, role app_user) the
 * database already applies it: a private task simply is not there. Nothing
 * in src/server/tasks/queries.ts needs this.
 *
 * The service path (`withSystemOrgTx`, role app_service) deliberately sees
 * the whole org — that is how jobs, digests and reminders work — so anything
 * there that builds text for a PERSON has to filter in code. Two places do:
 *
 *   * the daily digest's "blocked" section, which reaches past the reader's
 *     own tasks into their reports' (src/server/tasks/digest.ts);
 *   * nothing else today. Reminders and the rest of the digest are scoped to
 *     tasks the reader owns or is on, which are in the audience by
 *     construction.
 *
 * The Sunday update is a third case and a different one: there the reader is
 * allowed to see the task, but the POST publishes its title to the whole
 * org, so private items are dropped at that boundary instead
 * (src/server/tasks/weekly.ts).
 */

export function visibleTaskWhere(userId: string, isAdmin: boolean): Prisma.TaskWhereInput {
  if (isAdmin) return {};
  return {
    OR: [
      { visibility: TaskVisibility.ORG },
      { ownerId: userId },
      { createdById: userId },
      { assignees: { some: { userId } } },
    ],
  };
}

/** OWNER/ADMIN of the org: the standing audience of every private task. */
export async function orgAdminIds(db: TxClient, organizationId: string): Promise<string[]> {
  const rows = await db.membership.findMany({
    where: { organizationId, role: { in: [Role.OWNER, Role.ADMIN] } },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

export async function isOrgAdmin(
  db: TxClient,
  organizationId: string,
  userId: string,
): Promise<boolean> {
  const m = await db.membership.findFirst({
    where: { organizationId, userId, role: { in: [Role.OWNER, Role.ADMIN] } },
    select: { id: true },
  });
  return m !== null;
}
