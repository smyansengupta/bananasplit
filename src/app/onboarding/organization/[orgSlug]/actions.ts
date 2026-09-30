"use server";

import { redirect } from "next/navigation";

import { ForbiddenError } from "@/lib/auth/errors";
import { requirePermission } from "@/lib/auth/permissions";
import { nextOrgStep, orgStepHref, type OrgStep } from "@/lib/onboarding/steps";
import { withOrgAction, type OrgContext } from "@/server/db/context";
import { EventValidationError } from "@/server/events/service";
import {
  saveDataLabels,
  saveFinanceSetup,
  saveTeamsSetup,
  StepFailure,
  type StepResult,
} from "@/server/onboarding/org-setup";
import { loadSetupState, skipStep } from "@/server/setup/progress";

/**
 * Org setup (onboarding Flow B, B2-B5) for an OWNER/ADMIN of the new org.
 * Each step runs in one withOrgAction transaction as app_user (RLS
 * applies); the services in src/server/onboarding/org-setup.ts check the
 * permissions and validate the input again. A refusal thrown mid-step rolls
 * the whole step back and comes back here as { ok: false, error }.
 */

function step<Args extends unknown[]>(
  handler: (ctx: OrgContext, ...args: Args) => Promise<StepResult>,
): (organizationId: string, ...args: Args) => Promise<StepResult> {
  const inTx = withOrgAction(handler);
  return async (organizationId, ...args) => {
    try {
      return await inTx(organizationId, ...args);
    } catch (error) {
      if (error instanceof StepFailure || error instanceof EventValidationError) {
        return { ok: false, error: error.message };
      }
      if (error instanceof ForbiddenError) {
        return { ok: false, error: "Only the org's owners and admins can do this." };
      }
      throw error;
    }
  };
}

async function orgTimezone(ctx: OrgContext): Promise<string> {
  const org = await ctx.db.organization.findUniqueOrThrow({
    where: { id: ctx.organizationId },
    select: { timezone: true },
  });
  return org.timezone;
}

/** B2 "Skip for now": every connection not made yet is marked skipped. */
export const skipDataStepAction = step(async (ctx) => {
  requirePermission(ctx, "integrations.write");
  const state = await loadSetupState(ctx.db, ctx.organizationId);
  for (const id of state.todo) await skipStep(ctx.db, ctx.organizationId, ctx.userId, id);
  return { ok: true };
});

export const saveLabelsStepAction = step((ctx, input: unknown) => saveDataLabels(ctx, input));

export const saveFinanceStepAction = step(async (ctx, input: unknown) =>
  saveFinanceSetup(ctx, input, await orgTimezone(ctx)),
);

export const saveTeamsStepAction = step(async (ctx, input: unknown) =>
  saveTeamsSetup(ctx, input, await orgTimezone(ctx)),
);

/** After a step saved: the next step, or the org's home as its admin (B5 -> END). */
export async function goToNextOrgStep(orgSlug: string, current: OrgStep): Promise<void> {
  const next = nextOrgStep(current);
  const slug = /^[a-z0-9-]{1,60}$/.test(orgSlug) ? orgSlug : "";
  redirect(!slug ? "/app" : next ? orgStepHref(slug, next) : `/app/${slug}?welcome=1`);
}
