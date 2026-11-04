"use client";

import { Plus } from "@/components/icons";
import Link from "next/link";

import { useCrmOpen } from "@/components/crm/card/use-crm-open";
import { formatMoney } from "@/lib/crm/fields";
import type { GoalMetric } from "@/lib/crm/forecast";
import { cn } from "@/lib/utils";

/**
 * Goals on Today's right: each goal's progress, and a click on one opens
 * its card (?open=goal:<id>): to change it for whoever sets goals,
 * read-only for everyone else. Hovering the block shows a round
 * + in its corner for a new goal (always there when there are none yet, for
 * whoever may set them).
 */

export interface TodayGoal {
  id: string;
  name: string;
  metric: GoalMetric;
  metricLabel: string;
  who: string | null;
  actual: number;
  target: number;
  share: number;
  onTrack: boolean;
}

export function TodayGoals({ goals, canEdit }: { goals: TodayGoal[]; canEdit: boolean }) {
  const { hrefFor } = useCrmOpen();
  if (goals.length === 0 && !canEdit) return null;
  return (
    <section className="group/goals bg-card ring-foreground/6 relative space-y-4 rounded-[22px] p-5 ring-1">
      <div className="flex items-center gap-2">
        <h2 className="heading min-w-0 flex-1 text-base">Goals this quarter</h2>
        {canEdit && (
          <Link
            href={hrefFor("goal")}
            scroll={false}
            aria-label="Add a goal"
            title="Add a goal"
            className={cn(
              "bg-muted hover:bg-foreground/10 focus-glow grid size-7 place-items-center rounded-full transition-opacity outline-none",
              goals.length > 0 &&
                "opacity-0 group-focus-within/goals:opacity-100 group-hover/goals:opacity-100",
            )}
          >
            <Plus className="size-3.5" aria-hidden="true" />
          </Link>
        )}
      </div>
      {goals.length === 0 && (
        <p className="text-muted-foreground text-sm">No goals yet. Set one and Today keeps the score.</p>
      )}
      {goals.map((g) => {
        const fmt = (n: number) => (g.metric === "amount_won" ? formatMoney(n) : n.toLocaleString("en-US"));
        return (
          <Link
            key={g.id}
            href={hrefFor({ kind: "goal", id: g.id })}
            scroll={false}
            title={canEdit ? "Change this goal" : "See this goal"}
            className="hover:bg-muted/60 focus-glow -mx-2 block space-y-1.5 rounded-xl px-2 py-1 outline-none"
          >
            <div className="flex items-baseline gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate font-semibold">
                {g.name || g.metricLabel}
                {g.who && <span className="text-muted-foreground font-normal">, {g.who}</span>}
              </span>
              <span className="text-muted-foreground shrink-0 tabular-nums">
                {fmt(g.actual)} of {fmt(g.target)}
              </span>
            </div>
            <div className="bg-muted h-1.5 overflow-hidden rounded-full">
              <div
                className={g.onTrack ? "bg-foreground h-full rounded-full" : "h-full rounded-full bg-(--attention)"}
                style={{ width: `${Math.min(100, Math.round(g.share * 100))}%` }}
              />
            </div>
          </Link>
        );
      })}
    </section>
  );
}
