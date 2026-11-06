import type { Role } from "@/generated/prisma/client";
import { withOrgAction, withSystemOrgTx } from "@/server/db/context";
import { PermanentJobError } from "@/server/jobs/types";

import { requireCrm, type CrmActor } from "./access";

/**
 * The CRM's AI work runs in three steps: read in a short transaction, call
 * the model with none open, write what came back in another short one. A
 * CrmTx is how a feature opens those transactions without caring who it
 * runs for: a signed-in member (memberTx, RLS as them) or a job acting for
 * the member who set it up (jobTx, the service path with their user id,
 * stopped when they've left the organization).
 */

export type CrmTx = <T>(fn: (actor: CrmActor) => Promise<T>) => Promise<T>;

export interface AiWho {
  organizationId: string;
  userId: string;
  tx: CrmTx;
}

/** The signed-in member, under RLS, with the CRM's gate. */
export function memberTx(organizationId: string): CrmTx {
  return <T>(fn: (actor: CrmActor) => Promise<T>) =>
    withOrgAction(
      async (ctx) => {
        await requireCrm(ctx);
        return fn(ctx);
      },
      { feature: "crm" },
    )(organizationId) as Promise<T>;
}

/** A job acting for `userId` (who must still be a member). */
export function jobTx(organizationId: string, userId: string): CrmTx {
  return <T>(fn: (actor: CrmActor) => Promise<T>) =>
    withSystemOrgTx(organizationId, { userId }, async ({ db }) => {
      const m = await db.membership.findUnique({
        where: { userId_organizationId: { userId, organizationId } },
        select: { role: true },
      });
      if (!m) throw new PermanentJobError("the member this AI work is for left the organization");
      return fn({ db, organizationId, userId, role: m.role as Role });
    });
}

export function memberWho(organizationId: string, userId: string): AiWho {
  return { organizationId, userId, tx: memberTx(organizationId) };
}

export function jobWho(organizationId: string, userId: string): AiWho {
  return { organizationId, userId, tx: jobTx(organizationId, userId) };
}
