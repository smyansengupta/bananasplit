import type { Role } from "@/generated/prisma/client";
import type { OrgContext, SystemContext } from "@/server/db/context";

import type { CrmActor } from "./access";

/**
 * A member to act as inside a service-role transaction (a job: a workflow
 * run, a sequence step): the CRM actor and the member context the Tasks
 * service takes, so a job makes real Tasks the same way a member would, with
 * the member as their maker. Null when they're no longer in the
 * organization. The caller opens the transaction with
 * withSystemOrgTx(orgId, { userId }) so the audit trail names them.
 */
export interface ActingMember {
  actor: CrmActor;
  orgCtx: OrgContext;
}

export async function actAs(sys: SystemContext, organizationId: string, userId: string): Promise<ActingMember | null> {
  const m = await sys.db.membership.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
    select: { role: true, user: { select: { id: true, email: true, name: true } } },
  });
  if (!m) return null;
  return {
    actor: { db: sys.db, organizationId, userId, role: m.role as Role },
    orgCtx: {
      ...sys,
      kind: "system",
      userId,
      organizationId,
      role: m.role as Role,
      user: { id: m.user.id, email: m.user.email ?? "", name: m.user.name },
    },
  };
}
