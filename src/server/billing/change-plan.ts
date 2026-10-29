import type { Prisma } from "@/generated/prisma/client";
import type { OrgPlan } from "@/generated/prisma/enums";
import { trialDaysLeft } from "@/lib/billing/space";
import { writeOrgAuditLog } from "@/server/audit";

/**
 * Moves a club to another plan, in the caller's transaction, and records it
 * in the audit log. The OWNER check is the caller's (the action) and the
 * database's (app.organization_guard makes Organization.plan OWNER-only).
 *
 * During an organization's trial the pick never cuts it short: it goes in
 * planAfterTrial and starts when the trial ends (src/lib/billing/space.ts),
 * so every new organization gets its full trial of Team Advanced, whichever
 * plan it chose. `scheduled` says so.
 *
 * Billing isn't connected, so the action calls this straight away. When it
 * is, checkout (src/app/checkout) takes payment first and the provider's
 * webhook calls this with the paid plan; a downgrade can still apply here.
 */

export type ChangePlanDb = Pick<Prisma.TransactionClient, "organization" | "$queryRaw">;

export interface ChangePlanResult {
  from: OrgPlan;
  to: OrgPlan;
  changed: boolean;
  /** The pick waits for the trial to end (planAfterTrial); the plan itself is still TRIAL. */
  scheduled: boolean;
}

export async function changeOrgPlan(
  db: ChangePlanDb,
  organizationId: string,
  to: OrgPlan,
  source: "owner" | "billing" = "owner",
  now: Date = new Date(),
): Promise<ChangePlanResult> {
  const before = await db.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { kind: true, plan: true, trialEndsAt: true, planAfterTrial: true },
  });
  if (before.kind === "CLUB" && before.plan === "TRIAL" && trialDaysLeft({ ...before }, now)) {
    if (before.planAfterTrial === to)
      return { from: before.plan, to, changed: false, scheduled: true };
    await db.organization.update({
      where: { id: organizationId },
      data: { planAfterTrial: to },
    });
    await writeOrgAuditLog(db, {
      organizationId,
      action: "org.plan_changed",
      targetType: "Organization",
      targetId: organizationId,
      diff: { from: before.plan, to, source, afterTrial: true },
    });
    return { from: before.plan, to, changed: true, scheduled: true };
  }
  if (before.plan === to) return { from: before.plan, to, changed: false, scheduled: false };
  await db.organization.update({ where: { id: organizationId }, data: { plan: to } });
  await writeOrgAuditLog(db, {
    organizationId,
    action: "org.plan_changed",
    targetType: "Organization",
    targetId: organizationId,
    diff: { from: before.plan, to, source },
  });
  return { from: before.plan, to, changed: true, scheduled: false };
}
