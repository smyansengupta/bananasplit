import { GoalCard, type GoalCardData } from "@/components/crm/cards/goal-card";
import { GOAL_METRICS, parsePeriodKey, periodOf, type GoalMetric } from "@/lib/crm/forecast";
import { localDateKey } from "@/lib/tasks/dates";
import { orgTimeZone } from "@/server/crm/forecast";
import { goalActual, goalPeriodKey } from "@/server/crm/goals";
import { withOrgTx } from "@/server/db/context";

import type { OverlayProps } from "./crm-overlays";
import { crmMembers } from "@/app/app/[orgSlug]/crm/shell";

/** A goal's card (?open=goal for a new one, ?open=goal:<id> to change one). */
export async function GoalOverlay({ shell, open }: OverlayProps<"goal">) {
  const orgId = shell.org.id;
  const data = await withOrgTx(orgId, async ({ db }) => {
    const tz = await orgTimeZone(db, orgId);
    const today = localDateKey(new Date(), tz);
    const goal = open.id
      ? await db.crmGoal.findFirst({
          where: { id: open.id, organizationId: orgId },
          select: { id: true, metric: true, ownerId: true, pipelineId: true, periodStart: true, periodEnd: true, target: true },
        })
      : null;
    if (open.id && !goal) return { today, goal: null, missing: true as const };
    const money = shell.pipelines.some((p) => p.hasAmount);
    const metric: GoalMetric =
      goal && (GOAL_METRICS as readonly string[]).includes(goal.metric)
        ? (goal.metric as GoalMetric)
        : money
          ? "amount_won"
          : "items_won";
    const periodKey = goal ? goalPeriodKey(goal.periodStart, goal.periodEnd) : periodOf("quarter", today).key;
    const period = parsePeriodKey(periodKey) ?? periodOf("quarter", today);
    const actual = await goalActual(db, orgId, {
      metric,
      pipelineId: goal?.pipelineId ?? null,
      ownerId: goal?.ownerId ?? null,
      periodStart: new Date(`${period.start}T00:00:00Z`),
      periodEnd: new Date(`${period.end}T00:00:00Z`),
    });
    return {
      today,
      missing: false as const,
      goal: {
        id: goal?.id ?? null,
        metric,
        ownerId: goal?.ownerId ?? null,
        pipelineId: goal?.pipelineId ?? null,
        periodKey,
        target: goal ? (metric === "amount_won" ? goal.target / 100 : goal.target) : null,
        actual,
      },
    };
  });
  const card: GoalCardData | null = data.goal
    ? {
        ...data.goal,
        today: data.today,
        viewerId: shell.user.id,
        members: await crmMembers(orgId),
        canEdit: shell.access.manager,
        personal: shell.access.personal,
      }
    : null;
  return <GoalCard orgId={orgId} data={card} />;
}
