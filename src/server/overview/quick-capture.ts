import type { CaptureEvent } from "@/lib/overview/capture";
import { localDateKey } from "@/lib/tasks/dates";

/**
 * Quick capture (src/components/overview/quick-capture.tsx): the events
 * coming up that a typed line can name (src/lib/overview/capture.ts), and
 * today in the viewer's zone for its dates. All-day events keep the
 * organization's day, as the calendar shows them. The events are the
 * page's own read of what's coming up (passed in), so no query here.
 */

const AHEAD_DAYS = 60;

export interface QuickCaptureData {
  todayKey: string;
  events: CaptureEvent[];
}

export function loadQuickCapture({
  upcoming,
  now,
  timeZone,
  orgTimeZone,
}: {
  upcoming: readonly { id: string; title: string; startsAt: Date; allDay: boolean }[];
  now: Date;
  timeZone: string;
  orgTimeZone: string;
}): QuickCaptureData {
  const until = new Date(now.getTime() + AHEAD_DAYS * 24 * 60 * 60 * 1000);
  return {
    todayKey: localDateKey(now, timeZone),
    events: upcoming
      .filter((e) => e.startsAt <= until)
      .map((e) => ({
        id: e.id,
        title: e.title,
        dateKey: localDateKey(e.startsAt, e.allDay ? orgTimeZone : timeZone),
      })),
  };
}
