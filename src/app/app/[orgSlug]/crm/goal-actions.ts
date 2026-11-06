"use server";

import { GOAL_METRICS, parsePeriodKey, type GoalMetric } from "@/lib/crm/forecast";
import { CrmError, requireMember } from "@/server/crm/access";
import { deleteGoal, goalActual, goalPeriodKey, saveGoal } from "@/server/crm/goals";

import { z } from "zod";

import { checkInput, crmAction } from "./run";

const Id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const Period = z.string().max(20);
const Goal = z.object({
  id: Id.nullish(),
  metric: z.enum(GOAL_METRICS),
  ownerId: Id.nullable(),
  periodKey: Period,
  target: z.number().finite().min(0).max(1_000_000_000),
  name: z.string().trim().max(120).nullish(),
});
const Actual = z.object({
  metric: z.enum(GOAL_METRICS),
  ownerId: Id.nullable(),
  pipelineId: Id.nullish(),
  periodKey: Period,
});

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
  async (ctx, _a, raw: { metric: string; ownerId: string | null; pipelineId?: string | null; periodKey: string }) => {
    const input = checkInput(Actual, raw, "Pick what the goal counts, who and when.");
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
  async (ctx, _a, raw: GoalInput) => {
    const input = checkInput(Goal, raw, "Check the goal: what it counts, who, when and a number.");
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
    await deleteGoal(ctx, checkInput(Id, id));
    return {};
  },
  { manager: true },
);
