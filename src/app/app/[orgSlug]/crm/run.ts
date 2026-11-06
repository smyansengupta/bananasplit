import type { z } from "zod";

import { ForbiddenError, NotFoundError } from "@/lib/auth/errors";
import { CrmValidationError } from "@/lib/crm/validate";
import { CrmError, requireCrm, requireManager, type CrmAccess } from "@/server/crm/access";
import { AppError } from "@/server/db/errors";
import { SpaceRefusedError, withOrgAction, type OrgContext } from "@/server/db/context";

/**
 * Phase 5's action wrapper, the same contract as crmAction in ./actions.ts
 * (that file is "use server", so it can't export its helper): one
 * withOrgAction transaction as the member with the `crm` feature, the
 * add-on checked, a refusal thrown so the whole action rolls back, and the
 * result as { ok: true, ... } or { ok: false, error }.
 *
 * `crmGate` is the same check on its own, for actions that call a provider
 * (Telnyx, Twilio) between short transactions: never with one open.
 */

/**
 * An action's input, checked against its schema; anything else is refused
 * in plain words (a CrmError) instead of reaching the database.
 */
export function checkInput<S extends z.ZodType>(schema: S, value: unknown, message = "That didn't look right. Reload and try again."): z.infer<S> {
  const r = schema.safeParse(value);
  if (!r.success) throw new CrmError(message);
  return r.data;
}

export type CrmResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string; fields?: string[] };

export function toResult(error: unknown): { ok: false; error: string; fields?: string[] } {
  if (error instanceof CrmError || error instanceof CrmValidationError) {
    return { ok: false, error: error.message, fields: error.fields };
  }
  if (error instanceof SpaceRefusedError) return { ok: false, error: error.message };
  if (error instanceof ForbiddenError) return { ok: false, error: "You can't change that." };
  if (error instanceof NotFoundError) return { ok: false, error: "That isn't here any more." };
  if (error instanceof AppError) return { ok: false, error: error.message };
  console.error("[crm] action failed", error instanceof Error ? error.message : error);
  return { ok: false, error: "That didn't work. Try again." };
}

export function crmAction<Args extends unknown[], T extends object>(
  handler: (ctx: OrgContext, access: CrmAccess, ...args: Args) => Promise<T>,
  options: { admin?: boolean; manager?: boolean } = {},
): (organizationId: string, ...args: Args) => Promise<CrmResult<T>> {
  const inner = withOrgAction(
    async (ctx: OrgContext, ...args: Args) => {
      const access = await requireCrm(ctx);
      if (options.manager) requireManager(access);
      if (options.admin && !access.admin) throw new CrmError("Only owners and admins can change this.");
      return handler(ctx, access, ...args);
    },
    { feature: "crm" },
  );
  return async (organizationId, ...args) => {
    try {
      const result = await inner(organizationId, ...args);
      return { ok: true, ...result } as CrmResult<T>;
    } catch (error) {
      return toResult(error);
    }
  };
}

/** The member's check alone (its transaction commits before any network call). */
export const crmGate = withOrgAction(
  async (ctx: OrgContext) => {
    const access = await requireCrm(ctx);
    return { userId: ctx.userId, role: ctx.role, admin: access.admin, name: ctx.user.name ?? null };
  },
  { feature: "crm" },
);
