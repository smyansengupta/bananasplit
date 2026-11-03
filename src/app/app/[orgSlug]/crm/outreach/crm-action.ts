import { ForbiddenError, NotFoundError } from "@/lib/auth/errors";
import { CrmValidationError } from "@/lib/crm/validate";
import { CrmError, requireCrm, type CrmAccess } from "@/server/crm/access";
import { AppError } from "@/server/db/errors";
import { SpaceRefusedError, withOrgAction, type OrgContext } from "@/server/db/context";

/**
 * The outreach actions' wrapper: the same contract as the CRM's own
 * crmAction (../actions.ts): withOrgAction with the `crm` feature and
 * requireCrm, a refusal throws (rolling the action back) and comes back as
 * { ok: false, error } in words. The handler also gets the CRM access.
 */

export type OutreachResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string; fields?: string[] };

export function outreachAction<Args extends unknown[], T extends object>(
  handler: (ctx: OrgContext, access: CrmAccess, ...args: Args) => Promise<T>,
): (organizationId: string, ...args: Args) => Promise<OutreachResult<T>> {
  const inner = withOrgAction(
    async (ctx: OrgContext, ...args: Args) => {
      const access = await requireCrm(ctx);
      return handler(ctx, access, ...args);
    },
    { feature: "crm" },
  );
  return async (organizationId, ...args) => {
    try {
      const result = await inner(organizationId, ...args);
      return { ok: true, ...result } as OutreachResult<T>;
    } catch (error) {
      if (error instanceof CrmError || error instanceof CrmValidationError) {
        return { ok: false, error: error.message, fields: error.fields };
      }
      if (error instanceof SpaceRefusedError) return { ok: false, error: error.message };
      if (error instanceof ForbiddenError) return { ok: false, error: "You can't change that." };
      if (error instanceof NotFoundError) return { ok: false, error: "That isn't here any more." };
      if (error instanceof AppError) return { ok: false, error: error.message };
      console.error("[crm] outreach action failed", error instanceof Error ? error.message : error);
      return { ok: false, error: "That didn't work. Try again." };
    }
  };
}
