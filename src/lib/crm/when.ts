/** "Today", "Yesterday", "In 3 days", "12 days ago", or the date: when something was (or will be). */
export function when(d: Date | null | undefined, now: Date = new Date()): string {
  if (!d) return "Never";
  const days = Math.round((now.getTime() - d.getTime()) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days === -1) return "Tomorrow";
  if (days < 0) return `In ${-days} days`;
  if (days < 45) return `${days} days ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
