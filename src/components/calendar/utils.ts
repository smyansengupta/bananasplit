import { allDaySpan } from "@/lib/calendar/dates";

/** "YYYY-MM-DDTHH:mm" in the viewer's local time, for datetime-local inputs. */
export function toDateTimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** "YYYY-MM-DD" in the viewer's local time, for all-day date inputs. */
export function toDateInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function formatEventTimeRange(
  startsAt: Date,
  endsAt: Date,
  allDay: boolean,
  timeZone?: string,
): string {
  if (allDay) {
    // Whole days in the org timezone, printed as dates (no clock shift).
    const span = allDaySpan(
      startsAt,
      endsAt,
      timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
    const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" });
    const first = fmt.format(new Date(`${span.start}T00:00:00Z`));
    if (span.lastDay === span.start) return `${first} (all day)`;
    return `${first} – ${fmt.format(new Date(`${span.lastDay}T00:00:00Z`))} (all day)`;
  }
  const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
  const timeFmt = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });
  const sameDay = startsAt.toDateString() === endsAt.toDateString();
  return sameDay
    ? `${dateFmt.format(startsAt)}, ${timeFmt.format(startsAt)} – ${timeFmt.format(endsAt)}`
    : `${dateFmt.format(startsAt)} ${timeFmt.format(startsAt)} – ${dateFmt.format(endsAt)} ${timeFmt.format(endsAt)}`;
}
