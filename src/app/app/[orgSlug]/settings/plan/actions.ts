"use server";

import { FUNNEL_EVENTS } from "@/lib/analytics/events";
import { trackServer } from "@/lib/analytics/server";
import { requirePermission } from "@/lib/auth/permissions";
import { isPlanChoiceFor, PLAN_LIMITS } from "@/lib/billing/features";
import { changeOrgPlan } from "@/server/billing/change-plan";
import { withOrgAction } from "@/server/db/context";
import { crossedWarning, readStorageSpace, warnStorage } from "@/server/storage/quota";

/**
 * Settings › Plan and storage: the OWNER switches the plan. A Personal
 * space moves between Personal Free and Personal Plus; an organization
 * picks Free, Team or Team Advanced, during its trial or after it. Billing isn't connected yet, so the switch
 * takes effect at once (and is audit-logged); once it is, an upgrade goes
 * through checkout instead and this keeps the downgrades. Back to a trial,
 * an organization on a Personal plan or a Personal space on an
 * organization's is never a
 * choice: the database refuses them too (app.organization_space_guard).
 *
 * A downgrade never deletes anything. One that leaves the space over its
 * new storage only stops uploads until it is back under; one that takes it
 * past 80% of the new limit tells the owners and admins, as an upload would.
 */

export interface PlanResult {
  error?: string;
}

export const switchPlan = withOrgAction(async (ctx, plan: unknown): Promise<PlanResult> => {
  requirePermission(ctx, "org.plan.write");
  const space = await readStorageSpace(ctx.db, ctx.organizationId);
  if (!space) return { error: "This space is gone." };
  if (!isPlanChoiceFor(space.kind, plan)) {
    return {
      error:
        space.kind === "PERSONAL"
          ? "Choose Personal Free or Personal Plus."
          : "Choose Free, Team or Team Advanced.",
    };
  }
  const result = await changeOrgPlan(ctx.db, ctx.organizationId, plan);
  if (result.changed) {
    ctx.afterCommit(() => trackServer(FUNNEL_EVENTS.planSelected, { plan, from: result.from }));
  }
  const after = { ...space, plan };
  const usedBytes = Number(space.storageUsedBytes);
  if (
    result.changed &&
    crossedWarning(after, { usedBytes, fromLimit: PLAN_LIMITS[result.from].storageBytes })
  ) {
    await warnStorage(ctx.db, after, usedBytes, `plan:${ctx.organizationId}:${Date.now()}`);
  }
  return {};
});
