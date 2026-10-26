/**
 * How far something is from `now`, in words: `ago` looks back ("just now",
 * "5 minutes ago", "3 days ago", for Overview's Recently visited and the
 * ⌘K palette's Recent) and `until` looks forward ("starting now", "in 20
 * minutes", "tomorrow", "in 3 days", for the meeting cards). Client-safe.
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

/** "starting now", "in 20 minutes", "tomorrow", "in 3 days". */
export function until(date: Date, now: Date): string {
  const minutes = Math.round((date.getTime() - now.getTime()) / 60_000);
  if (minutes <= 0) return "under way";
  if (minutes < 2) return "starting now";
  if (minutes < 60) return rtf.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours < 24) return rtf.format(hours, "hour");
  return rtf.format(Math.round(hours / 24), "day");
}
