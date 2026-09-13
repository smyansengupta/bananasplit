export function initials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/**
 * Due dates are floating calendar dates (no time-of-day, no per-viewer
 * timezone conversion) — always read/write the UTC components so a date
 * never shifts by a day depending on the viewer's local timezone or DST.
 */
export function formatDueDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function isOverdue(dueDate: Date | null, status: string): boolean {
  if (!dueDate || status === "COMPLETED") return false;
  const today = new Date();
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const dueUtc = Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate());
  return dueUtc < todayUtc;
}

/** "YYYY-MM-DD" from a stored due date, for date input values. */
export function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Parses a "YYYY-MM-DD" input value as UTC midnight, matching how due dates are stored. */
export function fromDateInputValue(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}
