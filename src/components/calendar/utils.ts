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

export function formatEventTimeRange(startsAt: Date, endsAt: Date, allDay: boolean): string {
  if (allDay) {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(startsAt);
  }
  const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
  const timeFmt = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });
  const sameDay = startsAt.toDateString() === endsAt.toDateString();
  return sameDay
    ? `${dateFmt.format(startsAt)}, ${timeFmt.format(startsAt)} – ${timeFmt.format(endsAt)}`
    : `${dateFmt.format(startsAt)} ${timeFmt.format(startsAt)} – ${dateFmt.format(endsAt)} ${timeFmt.format(endsAt)}`;
}
