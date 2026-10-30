import {
  addDaysToKey,
  parseDateKey,
  parseZonedDateTimeLocal,
  zonedDateKey,
  zonedDateTimeLocal,
} from "@/lib/calendar/dates";

/**
 * Repeating meetings (docs/features/meetings.md): a LINKED SERIES. Every
 * week is its own real Event (its own sign-ups, check-ins, notes, call link
 * and reminders), and they share an Event.seriesId. Changing one asks "just
 * this one, or this and the ones after"; a series can be extended or ended.
 * Google Calendar gets each one as an ordinary event, so nothing there has
 * to understand repeat rules.
 */

/** The most weeks one series makes at once (a school year). */
export const MAX_SERIES_WEEKS = 52;

/** Which meetings in a series an edit or a delete applies to. */
export type SeriesScope = "one" | "following";

/**
 * The weekly occurrences of a meeting from its first one up to and
 * including `untilKey` (a YYYY-MM-DD day in `timeZone`), first one
 * included. Each keeps the first one's wall-clock time in the
 * organization's zone, so a 6 PM meeting stays at 6 PM across a daylight
 * saving change. Capped at MAX_SERIES_WEEKS.
 */
export function weeklyOccurrences(
  first: { startsAt: Date; endsAt: Date; allDay: boolean },
  untilKey: string,
  timeZone: string,
  max = MAX_SERIES_WEEKS,
): { startsAt: Date; endsAt: Date }[] {
  if (!parseDateKey(untilKey)) return [{ startsAt: first.startsAt, endsAt: first.endsAt }];
  const out: { startsAt: Date; endsAt: Date }[] = [];
  const startLocal = zonedDateTimeLocal(first.startsAt, timeZone);
  const endLocal = zonedDateTimeLocal(first.endsAt, timeZone);
  const startKey = startLocal.slice(0, 10);
  const endKey = endLocal.slice(0, 10);
  for (let week = 0; week < max; week++) {
    const dayKey = addDaysToKey(startKey, week * 7);
    if (dayKey > untilKey) break;
    const startsAt = parseZonedDateTimeLocal(`${dayKey}${startLocal.slice(10)}`, timeZone);
    const endsAt = parseZonedDateTimeLocal(
      `${addDaysToKey(endKey, week * 7)}${endLocal.slice(10)}`,
      timeZone,
    );
    if (!startsAt || !endsAt) break;
    out.push({ startsAt, endsAt });
  }
  return out.length > 0 ? out : [{ startsAt: first.startsAt, endsAt: first.endsAt }];
}

/** The day key `weeks` weeks after a meeting, in the organization's zone. */
export function weeksAfterKey(date: Date, weeks: number, timeZone: string): string {
  return addDaysToKey(zonedDateKey(date, timeZone), weeks * 7);
}
