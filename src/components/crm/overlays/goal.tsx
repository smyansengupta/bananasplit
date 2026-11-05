import { GoalCard, type GoalCardData } from "@/components/crm/cards/goal-card";
import { GOAL_METRICS, parsePeriodKey, periodOf, type GoalMetric } from "@/lib/crm/forecast";
import { localDateKey } from "@/lib/tasks/dates";
import { orgTimeZone } from "@/server/crm/forecast";
import { goalActual, goalPeriodKey } from "@/server/crm/goals";
import { withOrgTx } from "@/server/db/context";
import { getOrgMembersForPicker } from "@/server/members";

import type { OverlayProps } from "./crm-overlays";

/** A goal's card (?open=goal:<id>). A new goal (?open=goal) opens from CrmCreateHost. */
export async function GoalOverlay({ shell, open }: OverlayProps<"goal">) {
  const orgId = shell.org.id;
  const id = open.id;
  if (!id) return null;
  const data = await withOrgTx(orgId, async ({ db }) => {
    const tz = await orgTimeZone(db, orgId);
    const today = localDateKey(new Date(), tz);
    const goal = await db.crmGoal.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true, metric: true, ownerId: true, pipelineId: true, periodStart: true, periodEnd: true, target: true },
    });
    if (!goal) return null;
    const metric: GoalMetric = (GOAL_METRICS as readonly string[]).includes(goal.metric)
      ? (goal.metric as GoalMetric)
      : "items_won";
    const periodKey = goalPeriodKey(goal.periodStart, goal.periodEnd);
    const period = parsePeriodKey(periodKey) ?? periodOf("quarter", today);
    const actual = await goalActual(db, orgId, {
      metric,
      pipelineId: goal.pipelineId,
      ownerId: goal.ownerId,
      periodStart: new Date(`${period.start}T00:00:00Z`),
      periodEnd: new Date(`${period.end}T00:00:00Z`),
    });
    return {
      today,
      id: goal.id,
      metric,
      ownerId: goal.ownerId,
      pipelineId: goal.pipelineId,
      periodKey,
      target: metric === "amount_won" ? goal.target / 100 : goal.target,
      actual,
    };
  });
  const card: GoalCardData | null = data
    ? {
        ...data,
        viewerId: shell.user.id,
        members: shell.access.personal ? [] : await getOrgMembersForPicker(orgId),
        canEdit: shell.access.manager,
        personal: shell.access.personal,
      }
    : null;
  return <GoalCard orgId={orgId} data={card} />;
}
