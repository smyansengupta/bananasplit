"use server";

import { appUrl } from "@/lib/app-url";
import { ForbiddenError, NotFoundError } from "@/lib/auth/errors";
import type { SendingPrefs, TrustItem, TrustLevel } from "@/lib/crm/settings-prefs";
import type { OwnerMode } from "@/lib/crm/setup-owners";
import { CrmValidationError } from "@/lib/crm/validate";
import { BookingLinkError, ensurePersonalLink, updateLink } from "@/server/booking/links";
import { CrmError, requireCrm } from "@/server/crm/access";
import { fixImportRow, letRowGo } from "@/server/crm/import";
import { ensureMemberSettings } from "@/server/crm/outreach/member";
import { saveAutonomy, saveSending } from "@/server/crm/settings";
import { shareOutOwners } from "@/server/crm/setup";
import {
  hideCrmStarted,
  restoreCrmStarted,
  setCrmStepSkipped,
  type CrmStartedSnapshot,
} from "@/server/crm/started";
import { AppError } from "@/server/db/errors";
import { SpaceRefusedError, withOrgAction, type OrgContext } from "@/server/db/context";

/**
 * CRM settings' own Server Actions (the sections in
 * src/components/crm/settings/sections): the Sending window and
 * unsubscribe line, how much the CRM may do alone, fixing an import's
 * skipped rows, and "Get your CRM started" (who looks after them, checking
 * a step off, Hide, your booking link and logging address). Each runs in one
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

// ---- Get your CRM started ------------------------------------------------------------

export const setCrmStepSkippedAction = settingsAction(
  async (ctx, step: unknown, skipped: unknown) => {
    await setCrmStepSkipped(ctx, await requireCrm(ctx), step, skipped);
    return {};
  },
);

export const hideCrmStartedAction = settingsAction(async (ctx) => ({
  previous: await hideCrmStarted(ctx, await requireCrm(ctx)),
}));

export const restoreCrmStartedAction = settingsAction(
  async (ctx, previous: CrmStartedSnapshot) => {
    await restoreCrmStarted(ctx, await requireCrm(ctx), previous);
    return {};
  },
);

/** Your own booking link, made if it isn't there yet and switched on. */
export const turnOnBookingAction = settingsAction(async (ctx) => {
  try {
    const link = await ensurePersonalLink(ctx);
    await updateLink(ctx, link.id, { active: true });
    return { url: appUrl(`/book/${link.slug}`) };
  } catch (error) {
    if (error instanceof BookingLinkError) throw new CrmError(error.message);
    throw error;
  }
});

/** Your logging address, made the first time you ask for it. */
export const myLoggingAddressAction = settingsAction(async (ctx) => ({
  address: (await ensureMemberSettings(ctx.db, ctx.organizationId, ctx.userId)).bccAddress,
}));
