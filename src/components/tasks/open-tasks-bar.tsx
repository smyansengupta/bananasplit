import Link from "next/link";

import { MixBar, type MixSegment } from "@/components/ui/meters";
import { cn } from "@/lib/utils";
import type { TaskStats } from "@/server/tasks/queries";

/**
 * The bar's split of the workspace's stat strip numbers (getTaskStats): what
 * is overdue, due this week, open for later, and done this week. Tasks and
 * the Overview both draw it from this, so the two bars always match.
 */
export function taskStatsSegments(stats: TaskStats): MixSegment[] {
  const later = Math.max(0, stats.open - stats.overdue - stats.dueThisWeek);
  return [
    { label: "Overdue", value: stats.overdue, color: "var(--destructive)" },
    { label: "Due this week", value: stats.dueThisWeek, color: "var(--chart-1)" },
    { label: "Later", value: later, hatch: true },
    { label: "Done this week", value: stats.doneThisWeek, color: "var(--success)" },
  ];
}

/**
 * A phone's one-row look at open tasks (Tasks, and the same on the
 * Overview): how many are open, and one bar, to scale, of how they split
 * (the colours; the bar's label reads them out). With `href` the row is a
 * link.
 */
export function OpenTasksBar({
  open,
  segments,
  href,
  className,
}: {
  open: number;
  segments: readonly MixSegment[];
  href?: string;
  className?: string;
}) {
  const label = segments.map((s) => `${s.value} ${s.label.toLowerCase()}`).join(", ");
  const body = (
    <>
      <p className="flex shrink-0 items-baseline gap-1.5">
        <b className="numeral text-xl">{open}</b>
        <span className="text-muted-foreground text-sm">open</span>
      </p>
      <MixBar
        height={12}
        legend={false}
        className="min-w-0 flex-1"
        label={label}
        segments={segments}
      />
    </>
  );
  const frame = cn(
    "bg-card edge rounded-card flex items-center gap-3 px-4 py-3",
    href && "focus-glow outline-none active:scale-[0.99]",
    className,
  );
  return href ? (
    <Link href={href} aria-label={`${open} open tasks: ${label}`} className={frame}>
      {body}
    </Link>
  ) : (
    <section aria-label="Where the tasks stand" className={frame}>
      {body}
    </section>
  );
}
