import { zonedTimeToInstant } from "./dates";

export interface PollWindow {
  timezone: string;
  /** "YYYY-MM-DD" dates, in the poll's timezone. */
  dates: string[];
  dailyStartMinutes: number;
  dailyEndMinutes: number;
  granularityMinutes: number;
}

/**
 * The slots a poll's daily window produces, as instants: each date's
 * [start, end) window in the poll's timezone, cut every granularity minutes.
 * DST days get their real local times (a skipped hour moves forward).
 */
export function pollSlots(input: PollWindow): { startsAt: Date; endsAt: Date }[] {
  const slots: { startsAt: Date; endsAt: Date }[] = [];
  for (const date of [...new Set(input.dates)].sort()) {
    for (
      let cursor = input.dailyStartMinutes;
      cursor + input.granularityMinutes <= input.dailyEndMinutes;
      cursor += input.granularityMinutes
    ) {
      const startsAt = zonedTimeToInstant(
        date,
        input.timezone,
        Math.floor(cursor / 60),
        cursor % 60,
      );
      slots.push({
        startsAt,
        endsAt: new Date(startsAt.getTime() + input.granularityMinutes * 60_000),
      });
    }
  }
  return slots;
}
