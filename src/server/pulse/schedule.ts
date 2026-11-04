import type { Prisma } from "@/generated/prisma/client";
import { spaceIncludes } from "@/lib/billing/space";
import { safeTimeZone } from "@/lib/calendar/dates";
import { addDaysToKey, localDateKey, weekdayOfKey, zonedInstant } from "@/lib/tasks/dates";
import { withSystemOrgTx } from "@/server/db/context";
import { enqueueJob } from "@/server/jobs/enqueue";
import { nextOccurrence, type TriggerMode } from "@/server/tasks/schedule";

import { compilePulseData } from "./generate";

/**
 * When the weekly pulse goes out, called per org by /api/cron/task-digest
 * beside the task jobs (the same hourly and daily triggers; see
 * src/server/tasks/schedule.ts). It only enqueues and drafts; the
 * weekly-pulse job compiles, stores, sends and notifies.
 *
 * - The send: on OrgSettings.pulseDay at pulseHourLocal in the club's own
 *   zone (Organization.timezone, DST-aware through zonedInstant), a
 *   weekly-pulse:{weekStart} job (once=true), the week being the seven days
 *   ending that day.
 * - The draft: in the DRAFT_LEAD_HOURS before the send, the issue is
 *   written with sentAt NULL, so an admin can add a note (PulseIssue.note)
 *   before it goes out. The job recompiles it at send time and keeps the note.
 *
 * Clubs only (a Personal space has no audience), and only on plans with
 * the Overview, where the pulse lives.
 */

export const DRAFT_LEAD_HOURS = 48;
const HOUR_MS = 60 * 60 * 1000;

/** The first day of the pulse week that ends on the send day `sendKey`. */
export function pulseWeekStartOf(sendKey: string): string {
  return addDaysToKey(sendKey, -6);
}

/**
 * The pulse week ending on `pulseDay` that holds `dateKey` (as
 * updateWeekStartOfKey: a Friday club's weeks run Saturday to Friday).
 */
export function pulseWeekStartHolding(dateKey: string, pulseDay: number): string {
  const startDay = (pulseDay + 1) % 7;
  return addDaysToKey(dateKey, -((weekdayOfKey(dateKey) - startDay + 7) % 7));
}

/**
 * The send this trigger should enqueue (nextOccurrence on the pulse day),
 * with its week; null when nothing is due from this trigger.
 */
export function pulseSendFor(
  now: Date,
  tz: string,
  pulseDay: number,
  hour: number,
  mode: TriggerMode,
): { sendKey: string; weekStart: string; runAt: Date } | null {
  const at = nextOccurrence(now, tz, hour, mode, (d) => weekdayOfKey(d) === pulseDay);
  if (!at) return null;
  return { sendKey: at.dateKey, weekStart: pulseWeekStartOf(at.dateKey), runAt: at.runAt };
}

/** The next send at or after `now` (this week's, if it hasn't gone yet). */
export function upcomingPulseSend(
  now: Date,
  tz: string,
  pulseDay: number,
  hour: number,
): { sendKey: string; weekStart: string; at: Date } {
  const today = localDateKey(now, tz);
  for (let i = 0; i <= 7; i++) {
    const key = addDaysToKey(today, i);
    if (weekdayOfKey(key) !== pulseDay) continue;
    const at = zonedInstant(key, hour, tz);
    if (at.getTime() >= now.getTime())
      return { sendKey: key, weekStart: pulseWeekStartOf(key), at };
  }
  // Unreachable: the pulse day comes around within eight days.
  const key = addDaysToKey(today, 7);
  return { sendKey: key, weekStart: pulseWeekStartOf(key), at: zonedInstant(key, hour, tz) };
}

/** The most recent send before `now` (the week the latest issue covers). */
export function previousPulseSend(
  now: Date,
  tz: string,
  pulseDay: number,
  hour: number,
): { sendKey: string; weekStart: string; at: Date } {
  const next = upcomingPulseSend(now, tz, pulseDay, hour);
  const key = addDaysToKey(next.sendKey, -7);
  return { sendKey: key, weekStart: pulseWeekStartOf(key), at: zonedInstant(key, hour, tz) };
}

export interface PulseScheduleSummary {
  pulses: number;
  drafts: number;
}

export async function schedulePulse(
  organizationId: string,
  now: Date,
  mode: TriggerMode,
): Promise<PulseScheduleSummary> {
  return withSystemOrgTx(organizationId, async ({ db }) => {
    const org = await db.organization.findUnique({
      where: { id: organizationId },
      select: {
        kind: true,
        plan: true,
        trialEndsAt: true,
        planAfterTrial: true,
        timezone: true,
        deletedAt: true,
        settings: { select: { pulseEnabled: true, pulseDay: true, pulseHourLocal: true } },
      },
    });
    const settings = org?.settings;
    if (!org || org.deletedAt || org.kind !== "CLUB" || !settings?.pulseEnabled) {
      return { pulses: 0, drafts: 0 };
    }
    if (!spaceIncludes(org, "overview", now)) return { pulses: 0, drafts: 0 };
    const tz = safeTimeZone(org.timezone);

    let pulses = 0;
    const send = pulseSendFor(now, tz, settings.pulseDay, settings.pulseHourLocal, mode);
    if (send) {
      const id = await enqueueJob(db, {
        orgId: organizationId,
        kind: "weekly-pulse",
        key: send.weekStart,
        payload: { weekStart: send.weekStart },
        runAt: send.runAt,
        once: true,
        noKick: true,
      });
      if (id) pulses += 1;
    }

    // The draft, so an admin can add a note before it sends.
    let drafts = 0;
    const upcoming = upcomingPulseSend(now, tz, settings.pulseDay, settings.pulseHourLocal);
    if (upcoming.at.getTime() - now.getTime() <= DRAFT_LEAD_HOURS * HOUR_MS) {
      const weekStart = new Date(`${upcoming.weekStart}T00:00:00.000Z`);
      const existing = await db.pulseIssue.findUnique({
        where: { organizationId_weekStart: { organizationId, weekStart } },
        select: { id: true },
      });
      if (!existing) {
        const data = await compilePulseData(
          db,
          organizationId,
          { from: upcoming.weekStart, to: upcoming.sendKey },
          tz,
          now,
        );
        await db.pulseIssue.create({
          data: { organizationId, weekStart, data: data as unknown as Prisma.InputJsonValue },
          select: { id: true },
        });
        drafts += 1;
      }
    }
    return { pulses, drafts };
  });
}
