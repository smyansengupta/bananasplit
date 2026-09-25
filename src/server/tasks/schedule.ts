import { parseNotificationPrefs } from "@/lib/notification-prefs";
import {
  addDaysToKey,
  effectiveTimezone,
  localDateKey,
  localHour,
  weekStartKey,
  weekdayOfKey,
  zonedInstant,
} from "@/lib/tasks/dates";
import { withSystemOrgTx } from "@/server/db/context";
import { enqueueJob } from "@/server/jobs/enqueue";

import { expectedPosters } from "./weekly";

/**
 * Scheduling for the daily digest and the Sunday-update reminder, called
 * per org by /api/cron/task-digest. It only enqueues (once=true keys); the
 * jobs do the work.
 *
 * Two trigger modes, both idempotent, so they can run side by side:
 *
 * - hourly (Vercel Pro cron, or the GitHub Actions pinger on Hobby): enqueue
 *   a digest for each opted-in member whose local hour equals their
 *   digest.hourLocal, due now; and on Sunday at 18:00 local, a reminder to
 *   each lead who hasn't posted.
 * - daily (the Hobby daily-cron fallback): enqueue the NEXT occurrence of
 *   each within the coming 24 hours, with runAt at that local time, so the
 *   job drain sends it on time even when nothing calls this hourly.
 *
 * Keys: task-digest:{userId}:{localDate} and
 * weekly-update-reminder:{userId}:{weekStart}.
 */

export type TriggerMode = "hourly" | "daily";

export const WEEKLY_REMINDER_HOUR_LOCAL = 18;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * When to send an event that happens at `hour` local time on the days
 * accepted by `onDay`, given `now` and the trigger mode. Returns the local
 * date and the run time, or null when nothing is due from this trigger.
 */
export function nextOccurrence(
  now: Date,
  tz: string,
  hour: number,
  mode: TriggerMode,
  onDay: (dateKey: string) => boolean = () => true,
): { dateKey: string; runAt: Date } | null {
  const today = localDateKey(now, tz);
  if (mode === "hourly") {
    if (localHour(now, tz) !== hour || !onDay(today)) return null;
    return { dateKey: today, runAt: now };
  }
  // Daily: the first occurrence from the start of the current hour through the next 24 hours.
  const hourStart = new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS);
  for (const dateKey of [addDaysToKey(today, -1), today, addDaysToKey(today, 1)]) {
    if (!onDay(dateKey)) continue;
    const at = zonedInstant(dateKey, hour, tz);
    if (at.getTime() >= hourStart.getTime() && at.getTime() < now.getTime() + DAY_MS) {
      return { dateKey, runAt: at.getTime() < now.getTime() ? now : at };
    }
  }
  return null;
}

export interface ScheduleSummary {
  digests: number;
  weeklyReminders: number;
}

export async function scheduleOrgTaskJobs(
  organizationId: string,
  now: Date,
  mode: TriggerMode,
): Promise<ScheduleSummary> {
  return withSystemOrgTx(organizationId, async ({ db }) => {
    const org = await db.organization.findUnique({
      where: { id: organizationId },
      select: { timezone: true, deletedAt: true },
    });
    if (!org || org.deletedAt) return { digests: 0, weeklyReminders: 0 };

    const members = await db.membership.findMany({
      where: { organizationId },
      select: { userId: true, user: { select: { timezone: true, emailPreferences: true } } },
    });

    let digests = 0;
    for (const m of members) {
      const prefs = parseNotificationPrefs(m.user.emailPreferences);
      if (!prefs.digest.enabled) continue;
      const tz = effectiveTimezone(m.user, org);
      const at = nextOccurrence(now, tz, prefs.digest.hourLocal, mode);
      if (!at) continue;
      const id = await enqueueJob(db, {
        orgId: organizationId,
        kind: "task-digest",
        key: `${m.userId}:${at.dateKey}`,
        payload: { userId: m.userId, localDate: at.dateKey },
        runAt: at.runAt,
        once: true,
        noKick: true,
      });
      if (id) digests += 1;
    }

    let weeklyReminders = 0;
    const leads = await expectedPosters(db, organizationId);
    const tzOf = new Map(members.map((m) => [m.userId, effectiveTimezone(m.user, org)]));
    for (const lead of leads) {
      const tz = tzOf.get(lead.userId) ?? effectiveTimezone(null, org);
      const at = nextOccurrence(
        now,
        tz,
        WEEKLY_REMINDER_HOUR_LOCAL,
        mode,
        (d) => weekdayOfKey(d) === 0,
      );
      if (!at) continue;
      const weekStart = weekStartKey(new Date(at.runAt.getTime()), tz);
      const posted = await db.weeklyUpdate.findFirst({
        where: {
          organizationId,
          userId: lead.userId,
          weekStart: new Date(`${weekStart}T00:00:00.000Z`),
          postedAt: { not: null },
        },
        select: { id: true },
      });
      if (posted) continue;
      const id = await enqueueJob(db, {
        orgId: organizationId,
        kind: "weekly-update-reminder",
        key: `${lead.userId}:${weekStart}`,
        payload: { userId: lead.userId, weekStart },
        runAt: at.runAt,
        once: true,
        noKick: true,
      });
      if (id) weeklyReminders += 1;
    }
    return { digests, weeklyReminders };
  });
}
