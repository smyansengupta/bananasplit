import Link from "next/link";
import type { CSSProperties } from "react";

import { cn } from "@/lib/utils";
import type { Deadlines as DeadlinesData, DeadlineTone } from "@/lib/overview/deadlines-text";

import { Insight } from "./connections";
import { StartItButton } from "./home-act";

/**
 * Deadlines (one column): the hard dates of the next three weeks from
 * every source, soonest first, each with a date tag, its title and where
 * it comes from, and a warning for one that's close and not started. The
 * tag warms as the day nears: grey, a banana tint this week, solid banana
 * within two days, and brick for the warning.
 * Data from loadDeadlines.
 */

const TONE: Record<DeadlineTone, string> = {
  close: "bg-(--attention) text-[oklch(from_var(--attention)_clamp(0,(0.62_-_l)*1000,1)_0_0)]",
  soon: "bg-[color-mix(in_oklab,var(--k)_18%,var(--card))] text-[color-mix(in_oklab,var(--k)_72%,var(--foreground))]",
  later: "bg-muted text-muted-foreground",
  warn: "bg-tint-danger text-tint-danger-foreground",
};

export function Deadlines({ data, orgId }: { data: DeadlinesData; orgId?: string }) {
  if (data.rows.length === 0) {
    return <p className="text-muted-foreground text-sm">Nothing due in the next three weeks.</p>;
  }
  return (
    <div className="space-y-4">
      <ul className="divide-border divide-y">
        {data.rows.map((row) => (
          <li key={row.key} className="flex items-center gap-3">
            <Link
              href={row.href}
              className="group/deadline flex min-w-0 flex-1 items-start gap-3 py-3"
            >
              <span
                style={{ "--k": "var(--attention)" } as CSSProperties}
                className={cn(
                  "mt-px inline-flex h-6 min-w-11 shrink-0 items-center justify-center rounded-full px-2 text-[12px] font-semibold whitespace-nowrap tabular-nums",
                  TONE[row.tone],
                )}
              >
                {row.tag}
              </span>
              <span className="min-w-0">
                <span className="block text-[14px] leading-snug font-semibold break-words group-hover/deadline:underline">
                  {row.title}
                </span>
                <span className="text-muted-foreground mt-0.5 block text-[12.5px]">
                  {row.source}
                </span>
              </span>
            </Link>
            {/* Ambient: due within two days and nobody has started it. */}
            {orgId && row.kind === "task" && row.notStarted && row.tone === "close" && (
              <StartItButton
                orgId={orgId}
                taskId={row.key.slice("task:".length)}
                title={row.title}
              />
            )}
          </li>
        ))}
      </ul>
      {data.insight && <Insight tone="warn">{data.insight}</Insight>}
    </div>
  );
}
