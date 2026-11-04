"use server";

import type { CrmWorkflowStatus } from "@/generated/prisma/client";
import { ForbiddenError, NotFoundError } from "@/lib/auth/errors";
import { requireUser } from "@/lib/auth/session";
import { mapDescribed, type DescribeContext } from "@/lib/crm/describe";
import { STARTER_RULES } from "@/lib/crm/scoring";
import type { WorkflowObject } from "@/lib/crm/workflows";
import { ORG_KEYS_PLACE } from "@/lib/crm/org-keys";
import { CrmValidationError } from "@/lib/crm/validate";
import { checkRateLimit, rateLimitKey, retryAfterText } from "@/lib/rate-limit";
import { AiImportError } from "@/server/ai/generate";
import { CrmError, requireCrm, requireManager } from "@/server/crm/access";
import { crmCredentials, crmGenerate, estimateCallMicros, holdForCall, paidByOf, providerOf, recordAiUsage } from "@/server/crm/ai";
import { describeContext, describeRequest } from "@/server/crm/describe";
import { deleteGoal, saveGoal } from "@/server/crm/goals";
import { deleteScoreRule, saveScoreRule } from "@/server/crm/scoring";
import { dryRunWorkflow, type DryRunResult } from "@/server/crm/workflow-engine";
import { deleteWorkflow, enableRecipe, parseWorkflowInput, saveWorkflow, setWorkflowStatus } from "@/server/crm/workflows";
import { AppError } from "@/server/db/errors";
import { SpaceRefusedError, withOrgAction, withSystemOrgTx, type OrgContext } from "@/server/db/context";
import { enqueueJob } from "@/server/jobs/enqueue";

/**
 * The CRM's automation and numbers actions (Automations, Forecast, goals,
 * scoring). Each runs in one withOrgAction transaction as the member (RLS
 * decides: workflows, rules and goals are owners', admins' and CRM
 * managers' to change) and answers { ok: true, ... } or { ok: false, error }.
 */

export type ActionResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string; noAi?: boolean };

function words(error: unknown): string {
  if (error instanceof CrmError || error instanceof CrmValidationError) return error.message;
  if (error instanceof SpaceRefusedError) return error.message;
  if (error instanceof ForbiddenError) return "You can't change that.";
  if (error instanceof NotFoundError) return "That isn't here any more.";
  if (error instanceof AppError) return error.message;
  if (error instanceof AiImportError) return error.message;
  console.error("[crm] automation action failed", error instanceof Error ? error.message : error);
  return "That didn't work. Try again.";
}

function crmAction<Args extends unknown[], T extends object>(
  handler: (ctx: OrgContext, ...args: Args) => Promise<T>,
): (organizationId: string, ...args: Args) => Promise<ActionResult<T>> {
  const inner = withOrgAction(
    async (ctx: OrgContext, ...args: Args) => {
      await requireCrm(ctx);
      return handler(ctx, ...args);
    },
    { feature: "crm" },
  );
  return async (organizationId, ...args) => {
    try {
      return { ok: true, ...(await inner(organizationId, ...args)) } as ActionResult<T>;
    } catch (error) {
      return { ok: false, error: words(error) };
    }
  };
}

// ---- Workflows ------------------------------------------------------------------------

export const saveWorkflowAction = crmAction(
  async (ctx, input: { id?: string | null; workflow: unknown; status?: CrmWorkflowStatus; described?: string | null }) =>
    saveWorkflow(ctx, input),
);

export const setWorkflowStatusAction = crmAction(async (ctx, id: string, status: "ON" | "OFF") => {
  await setWorkflowStatus(ctx, id, status === "ON" ? "ON" : "OFF");
  return {};
});

export const deleteWorkflowAction = crmAction(async (ctx, id: string) => {
  await deleteWorkflow(ctx, id);
  return {};
});

export const enableRecipeAction = crmAction(async (ctx, recipeId: string) => enableRecipe(ctx, recipeId));

export const dryRunAction = crmAction(
  async (ctx, workflowId: string, pick?: { kind: WorkflowObject; id: string } | null): Promise<{ result: DryRunResult }> => {
    requireManager(await requireCrm(ctx));
    return { result: await dryRunWorkflow(ctx, workflowId, pick ?? null) };
  },
);

/** Checks a draft without saving it (the builder's live check). */
export const checkWorkflowAction = crmAction(async (_ctx, workflow: unknown) => {
  parseWorkflowInput(workflow);
  return {};
});

// ---- Describe it in words ----------------------------------------------------------

const DESCRIBE_PER_HOUR = 30;

/**
 * The member's sentence, through the organization's model, back as a draft
 * workflow to review. Nothing is saved. With no model connected it says
 * what connecting one adds.
 */
export async function describeWorkflowAction(
  organizationId: string,
  text: string,
): Promise<ActionResult<{ draft: ReturnType<typeof mapDescribed>["draft"]; notes: string[]; model: string }>> {
  const sentence = typeof text === "string" ? text.trim().slice(0, 1000) : "";
  if (sentence.length < 8) return { ok: false, error: "Say a little more: when it happens, and what to do." };
  let context: DescribeContext;
  try {
    context = await withOrgAction(
      async (ctx) => {
        requireManager(await requireCrm(ctx));
        return describeContext(ctx.db, organizationId);
      },
      { feature: "crm" },
    )(organizationId);
  } catch (error) {
    return { ok: false, error: words(error) };
  }
  const user = await requireUser();
  const hit = await checkRateLimit(rateLimitKey("crm-describe", organizationId, user.id), DESCRIBE_PER_HOUR, 60 * 60);
  if (!hit.allowed) return { ok: false, error: `That's a lot of automations described. Try again ${retryAfterText(hit)}.` };
  // The organization's own key only (never Bananasplit's), and the cap on
  // the service path so it counts everyone's spend.
  const creds = await crmCredentials(organizationId);
  if (!creds) {
    return {
      ok: false,
      noAi: true,
      error: `Add your organization's Claude or OpenAI key in ${ORG_KEYS_PLACE}, and this turns a sentence into the steps for you, on your own key. Until then, build it with the steps below.`,
    };
  }
  let result;
  const request = describeRequest(sentence, context);
  let hold = null;
  try {
    // Held against the cap while it runs, like every other paid call.
    hold = await holdForCall(
      organizationId,
      creds,
      estimateCallMicros(creds.model, (request.system?.length ?? 0) + (request.text?.length ?? 0), request.maxOutputTokens ?? 2_000),
    );
    result = await crmGenerate(creds, request);
  } catch (error) {
    await hold?.release();
    return { ok: false, error: words(error) };
  }
  try {
    await withSystemOrgTx(organizationId, ({ db }) =>
      recordAiUsage(db, {
        organizationId,
        userId: user.id,
        feature: "crm.describe-workflow",
        provider: providerOf(creds),
        result,
        paidBy: paidByOf(creds),
      }),
    );
  } catch {
    // The meter is best effort here; the draft is still shown.
  } finally {
    await hold?.release();
  }
  const mapped = mapDescribed(result.data, context);
  return { ok: true, draft: mapped.draft, notes: mapped.notes, model: result.label };
}

// ---- Scoring ------------------------------------------------------------------------

export const saveScoreRuleAction = crmAction(async (ctx, input: { id?: string | null; rule: unknown }) => saveScoreRule(ctx, input));

export const deleteScoreRuleAction = crmAction(async (ctx, id: string) => {
  await deleteScoreRule(ctx, id);
  return {};
});

export const addStarterRulesAction = crmAction(async (ctx, objectKind: "people" | "deals") => {
  const have = await ctx.db.crmScoreRule.findMany({
    where: { organizationId: ctx.organizationId, objectKind },
    select: { label: true },
  });
  let added = 0;
  for (const r of STARTER_RULES.filter((x) => x.objectKind === objectKind)) {
    if (have.some((h) => h.label === r.label)) continue;
    await saveScoreRule(ctx, { rule: r });
    added++;
  }
  await queueScoring(ctx);
  return { added };
});

async function queueScoring(ctx: OrgContext) {
  await enqueueJob(ctx.db, {
    orgId: ctx.organizationId,
    kind: "crm-daily",
    key: `${ctx.organizationId}:scores:${Date.now().toString(36)}`,
    payload: { step: "scores" },
  });
}

/** Recomputes every score now (in the background). */
export const rescoreAction = crmAction(async (ctx) => {
  requireManager(await requireCrm(ctx));
  await queueScoring(ctx);
  return {};
});

// ---- Goals and the forecast ---------------------------------------------------------

export const saveGoalAction = crmAction(
  async (
    ctx,
    input: { id?: string | null; metric: string; periodKey: string; target: number; ownerId?: string | null; pipelineId?: string | null },
  ) => saveGoal(ctx, input),
);

export const deleteGoalAction = crmAction(async (ctx, id: string) => {
  await deleteGoal(ctx, id);
  return {};
});

/** A member marks an item Commit, Best case, Pipeline or Left out. */
