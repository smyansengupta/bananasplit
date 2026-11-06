"use server";

import { POWER_HOUR_KEY, powerHourSnoozeUntil } from "@/lib/crm/power-hour";
import { effectiveTimezone } from "@/lib/tasks/dates";

import { crmAction } from "./run";

/**
 * Today's own actions (docs/features/crm.md, "Redesign"). Power hour's
 * snooze is the member's own InboxItemState row (POWER_HOUR_KEY), like a
 * queue row's snooze: until 2 PM, or the next morning, where they are.
 */

export const snoozePowerHourAction = crmAction(async (ctx) => {
  const { db, organizationId, userId } = ctx;
  const me = await db.user.findUnique({ where: { id: userId }, select: { timezone: true } });
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { timezone: true },
  });
  const until = powerHourSnoozeUntil(new Date(), effectiveTimezone(me, org));
  await db.inboxItemState.upsert({
    where: { userId_organizationId_itemKey: { userId, organizationId, itemKey: POWER_HOUR_KEY } },
    create: { userId, organizationId, itemKey: POWER_HOUR_KEY, snoozedUntil: until },
    update: { snoozedUntil: until, updatedAt: new Date() },
    select: { itemKey: true },
  });
  return { until: until.toISOString() };
});

export const unsnoozePowerHourAction = crmAction(async (ctx) => {
  const { db, organizationId, userId } = ctx;
  await db.inboxItemState.updateMany({
    where: { userId, organizationId, itemKey: POWER_HOUR_KEY },
    data: { snoozedUntil: null, updatedAt: new Date() },
  });
  return {};
});
