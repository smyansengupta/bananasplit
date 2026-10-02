/**
 * "just now", "5 minutes ago", "2 hours ago", "3 days ago": how long before
 * `now` something happened (Overview's Recently visited, the ⌘K palette's
 * Recent). Client-safe.
 */

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function ago(date: Date, now: Date): string {
  const minutes = Math.round((date.getTime() - now.getTime()) / 60_000);
  if (minutes > -1) return "just now";
  if (minutes > -60) return rtf.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours > -24) return rtf.format(hours, "hour");
  return rtf.format(Math.round(hours / 24), "day");
}
