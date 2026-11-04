"use client";

import {
  CalendarDays,
  CircleAlert,
  Inbox,
  SquareCheckBig,
  type IconComponent,
} from "@/components/icons";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Stat, StatStrip } from "@/components/ui/stat";
import type { TodayCell } from "@/lib/overview/today-strip";

import { TickNumber } from "./fresh";

const ICONS: Record<TodayCell["key"], IconComponent> = {
  overdue: CircleAlert,
  waiting: Inbox,
  due: SquareCheckBig,
  events: CalendarDays,
};

/**
 * The Today strip, under the greeting on an organization's Overview: your
 * overdue tasks, what waits on you in the Inbox (the sidebar badge's own
 * number), your tasks due this week and the events in the next two weeks.
 * It's the app's stat strip (no boxes: an icon chip, the number, a plain
 * label and one short chip), each stat opening its list; the longer line
 * behind each ("Khoury check-in, 3 days late") is its tooltip and accessible
 * name. A client component so it can hand icon components to Stat. The
 * Personal home keeps its own strip (OverviewStats).
 */
export function TodayStrip({
  cells,
  scope,
}: {
  cells: readonly TodayCell[];
  /** Whose last-seen numbers these are (the organization's id): a changed one rolls to its new value. */
  scope?: string;
}) {
  return (
    <section aria-label="Today">
      <StatStrip>
        {cells.map((c) => (
          <div key={c.key} className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <Link
              href={c.href}
              title={c.sub}
              aria-label={`${c.value ?? "Unknown"} ${c.label.toLowerCase()}: ${c.sub}`}
              className="focus-glow rounded-tile hover:bg-muted/60 -m-1.5 p-1.5 transition-colors outline-none"
            >
              <Stat
                icon={ICONS[c.key]}
                value={
                  c.value === null ? (
                    "–"
                  ) : scope ? (
                    <TickNumber value={c.value} storageKey={`bs.tick:${scope}:${c.key}`} />
                  ) : (
                    c.value
                  )
                }
                label={c.label}
                chip={c.chip ? <Badge variant={c.chip.tone}>{c.chip.text}</Badge> : undefined}
              />
            </Link>
          </div>
        ))}
      </StatStrip>
    </section>
  );
}
