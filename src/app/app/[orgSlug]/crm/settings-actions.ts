"use server";

import { ForbiddenError, NotFoundError } from "@/lib/auth/errors";
import type { SendingPrefs, TrustItem, TrustLevel } from "@/lib/crm/settings-prefs";
import type { OwnerMode } from "@/lib/crm/setup-owners";
import { CrmValidationError } from "@/lib/crm/validate";
import { CrmError, requireCrm } from "@/server/crm/access";
import { fixImportRow, letRowGo } from "@/server/crm/import";
import { saveAutonomy, saveSending } from "@/server/crm/settings";
import { shareOutOwners } from "@/server/crm/setup";
import { AppError } from "@/server/db/errors";
import { SpaceRefusedError, withOrgAction, type OrgContext } from "@/server/db/context";

/**
 * CRM settings' own Server Actions (the sections in
 * src/components/crm/settings/sections): the Sending window and
 * unsubscribe line, how much the CRM may do alone, fixing an import's
 * skipped rows, and setup's "Who looks after them?". Each runs in one
 * withOrgAction transaction as the member (RLS decides) and answers
 * { ok: true, ... } or { ok: false, error }.
 */

type Result<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

function settingsAction<Args extends unknown[], T extends object>(
  handler: (ctx: OrgContext, ...args: Args) => Promise<T>,
): (organizationId: string, ...args: Args) => Promise<Result<T>> {
  const inner = withOrgAction(
    async (ctx: OrgContext, ...args: Args) => {
      await requireCrm(ctx);
      return handler(ctx, ...args);
    },
    { feature: "crm" },
  );
  return async (organizationId, ...args) => {
    try {
      return { ok: true, ...(await inner(organizationId, ...args)) } as Result<T>;
    } catch (error) {
      if (error instanceof CrmError || error instanceof CrmValidationError)
        return { ok: false, error: error.message };
      if (error instanceof SpaceRefusedError) return { ok: false, error: error.message };
      if (error instanceof ForbiddenError) return { ok: false, error: "You can't change that." };
      if (error instanceof NotFoundError) return { ok: false, error: "That isn't here any more." };
      if (error instanceof AppError) return { ok: false, error: error.message };
      console.error("[crm settings] action failed", error instanceof Error ? error.message : error);
      return { ok: false, error: "That didn't work. Try again." };
    }
  };
}

export const saveSendingAction = settingsAction(async (ctx, input: Partial<SendingPrefs>) => ({
  sending: await saveSending(ctx, input),
}));

export const saveAutonomyAction = settingsAction(
  async (ctx, input: Partial<Record<TrustItem, TrustLevel>>) => ({
    autonomy: await saveAutonomy(ctx, input),
  }),
);

export const fixImportRowAction = settingsAction(
  async (ctx, importId: string, row: number, email: string | null) => {
    const outcome = await fixImportRow(ctx, importId, row, { email });
    return { kind: outcome.kind };
  },
);

export const letRowGoAction = settingsAction(async (ctx, importId: string, row: number) => {
  await letRowGo(ctx, importId, row);
  return {};
});

export const shareOutOwnersAction = settingsAction(async (ctx, mode: OwnerMode, since: string) =>
  shareOutOwners(ctx, mode, new Date(since)),
);
