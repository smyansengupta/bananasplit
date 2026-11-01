import Link from "next/link";

import { CountUp } from "@/components/ui/stat";
import type { TodayCell } from "@/lib/overview/today-strip";
import { cn } from "@/lib/utils";

/**
 * The Today strip, under the greeting on an organization's Overview: your
 * overdue tasks, what waits on you in the Inbox (the sidebar badge's own
 * number), your tasks due this week and the events in the next two weeks.
 * Each count is a link with one line saying what's behind it; Overdue is
 * tinted danger while anything is late. Four across, a 2×2 grid on a phone.
 * The Personal home keeps its own stat strip (OverviewStats).
 */
export function TodayStrip({ cells }: { cells: readonly TodayCell[] }) {
  return (
    <section
      aria-label="Today"
      className="bg-card text-card-foreground ring-foreground/6 edge rounded-card p-2 ring-1"
    >
      <div className="grid grid-cols-2 gap-1 lg:grid-cols-4">
        {cells.map((c) => (
          <Link
            key={c.key}
            href={c.href}
            className={cn(
              "focus-glow rounded-block flex min-w-0 flex-col gap-1.5 px-4 py-3.5 transition-colors outline-none sm:px-4.5 sm:py-4",
              c.danger
                ? "bg-tint-danger text-tint-danger-foreground hover:bg-tint-danger/85"
                : "hover:bg-muted/60",
            )}
          >
            <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="numeral text-[28px] leading-none sm:text-[34px]">
                {c.value === null ? "–" : <CountUp value={c.value} />}
              </span>
              <span className="font-bold">{c.label}</span>
            </span>
            <span className={cn("line-clamp-2 text-[13px]", !c.danger && "text-muted-foreground")}>
              {c.sub}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
