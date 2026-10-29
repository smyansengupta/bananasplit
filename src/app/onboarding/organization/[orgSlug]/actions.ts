"use server";

import { redirect } from "next/navigation";

import { ForbiddenError } from "@/lib/auth/errors";
import { requirePermission } from "@/lib/auth/permissions";
import {
  nextSetupStep,
  setupStepHref,
  type OrgStep,
  type SetupFlow,
  type SetupStep,
} from "@/lib/onboarding/steps";
import { withOrgAction, type OrgContext } from "@/server/db/context";
import { EventValidationError } from "@/server/events/service";
import {
  saveEventTypes,
  saveTaskLabels,
  saveTeamsSetup,
  StepFailure,
  type StepResult,
} from "@/server/onboarding/org-setup";

/**
 * Setting up an organization (ORG_STEPS) for an OWNER/ADMIN of it, and the
 * Personal space's steps that share them (tags, the next-step redirect).
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

export const saveLabelsStepAction = step((ctx, input: unknown) => saveTaskLabels(ctx, input));

export const saveTeamsStepAction = step(async (ctx, input: unknown) =>
  saveTeamsSetup(ctx, input, await orgTimezone(ctx)),
);

/** Event types: the organization's own, named like its tags (OrgSettings.eventTypes). */
export const saveEventTypesStepAction = step((ctx, input: unknown) => saveEventTypes(ctx, input));

/**
 * Emails, for everyone in the organization: the weekly recap by email
 * (OrgSettings.pulseEmail). What each person gets is their own
 * (saveNotificationPreferences).
 */
export const saveOrgEmailsStepAction = step(async (ctx, recapByEmail: unknown) => {
  requirePermission(ctx, "settings.general.write");
  if (typeof recapByEmail !== "boolean") return { ok: false, error: "Pick on or off." };
  await ctx.db.orgSettings.update({
    where: { organizationId: ctx.organizationId },
    data: { pulseEmail: recapByEmail, updatedById: ctx.userId },
    select: { organizationId: true },
  });
  return { ok: true };
});

/**
 * After a step saved (or was skipped): the next step, else where setup ends: the organization's home as its admin, or
 * the Personal space.
 */
export async function goToNextSetupStep(
  flow: SetupFlow,
  orgSlug: string,
  current: SetupStep,
): Promise<void> {
  const next = nextSetupStep(flow, current);
  const slug = /^[a-z0-9-]{1,60}$/.test(orgSlug) ? orgSlug : "";
  if (next) redirect(setupStepHref(flow, slug, next));
  redirect(!slug ? "/app" : flow === "org" ? `/app/${slug}?welcome=1` : `/app/${slug}`);
}

/** goToNextSetupStep for an organization's setup. */
export async function goToNextOrgStep(orgSlug: string, current: OrgStep): Promise<void> {
  await goToNextSetupStep("org", orgSlug, current);
}
