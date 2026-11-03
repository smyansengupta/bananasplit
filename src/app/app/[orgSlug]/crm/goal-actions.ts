"use server";

import { GOAL_METRICS, parsePeriodKey, type GoalMetric } from "@/lib/crm/forecast";
import { CrmError, requireMember } from "@/server/crm/access";
import { deleteGoal, goalActual, goalPeriodKey, saveGoal } from "@/server/crm/goals";

import { crmAction } from "./run";

/**
 * The goal card's actions (docs/features/crm.md, "Redesign"): what a goal
 * has reached so far for any what, who and when (the live pace line),
 * Save, and delete. Save and delete answer what's needed to undo them.
 */

export interface GoalInput {
  id?: string | null;
  metric: string;
  ownerId: string | null;
  periodKey: string;
  /** In the goal's units: dollars for money. */
  target: number;
  name?: string | null;
}

/** What it has reached so far (cents for money). */
export const goalActualAction = crmAction(
  async (ctx, _a, input: { metric: string; ownerId: string | null; pipelineId?: string | null; periodKey: string }) => {
    if (!(GOAL_METRICS as readonly string[]).includes(input.metric)) throw new CrmError("Pick what the goal counts.");
    const period = parsePeriodKey(input.periodKey);
    if (!period) throw new CrmError("Pick a quarter or a year.");
    if (input.ownerId) await requireMember(ctx.db, ctx.organizationId, input.ownerId);
    const actual = await goalActual(ctx.db, ctx.organizationId, {
      metric: input.metric as GoalMetric,
      pipelineId: input.pipelineId ?? null,
      ownerId: input.ownerId,
      periodStart: new Date(`${period.start}T00:00:00Z`),
      periodEnd: new Date(`${period.end}T00:00:00Z`),
    });
    return { actual };
  },
);

export const saveGoalAction = crmAction(
  async (ctx, _a, input: GoalInput) => {
    // What it was, so Undo can put it back.
    const before = input.id
      ? await ctx.db.crmGoal.findFirst({
          where: { id: input.id, organizationId: ctx.organizationId },
          select: { name: true, metric: true, ownerId: true, pipelineId: true, periodStart: true, periodEnd: true, target: true },
        })
      : null;
    const saved = await saveGoal(ctx, {
      id: input.id ?? null,
      metric: input.metric,
      periodKey: input.periodKey,
      target: input.target,
      ownerId: input.ownerId,
      pipelineId: before?.pipelineId ?? null,
      name: input.name ?? null,
    });
    return {
      id: saved.id,
      before: before
        ? {
            id: input.id!,
            metric: before.metric,
            ownerId: before.ownerId,
            name: before.name,
            periodKey: goalPeriodKey(before.periodStart, before.periodEnd),
            target: before.metric === "amount_won" ? before.target / 100 : before.target,
          }
        : null,
    };
  },
  { manager: true },
);

export const deleteGoalAction = crmAction(
  async (ctx, _a, id: string) => {
    await deleteGoal(ctx, id);
    return {};
  },
  { manager: true },
);
