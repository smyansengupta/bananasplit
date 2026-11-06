"use client";

import { CircleCheck, Plus, Target } from "@/components/icons";
import Link from "next/link";

import { useCrmOpen } from "@/components/crm/card/use-crm-open";
import { IconChip } from "@/components/ui/stat";
import { formatMoney } from "@/lib/crm/fields";
import type { GoalMetric } from "@/lib/crm/forecast";
import { goalStanding, standingWords } from "@/lib/crm/goal-pace";
import { cn } from "@/lib/utils";

import { GoalGauge } from "./goal-gauge";

/**
 * Goals on Today's right, as a score: each goal a ring with the big number
 * and where it stands against the pace, and a goal hit fills in green with
 * its check. A click on one opens its card (?open=goal:<id>): to change it
 * for whoever sets goals, read-only for everyone else. Hovering the block
 * shows a round + in its corner for a new goal (always there when there
 * are none yet, for whoever may set them).
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
  /** Where it should be by now, 0 to 1. */
  pace: number;
  onTrack: boolean;
}

export function TodayGoals({ goals, canEdit }: { goals: TodayGoal[]; canEdit: boolean }) {
  const { hrefFor } = useCrmOpen();
  if (goals.length === 0 && !canEdit) return null;
  const hit = goals.filter((g) => g.share >= 1).length;
  return (
    <section className="group/goals bg-card ring-foreground/6 relative space-y-3 rounded-[22px] p-5 ring-1">
      <div className="flex items-center gap-2">
        <h2 className="heading min-w-0 flex-1 text-base">Goals this quarter</h2>
        {hit > 0 && (
          <span className="text-muted-foreground text-sm tabular-nums">
            {hit} of {goals.length} hit
          </span>
        )}
        {canEdit && goals.length > 0 && (
          <Link
            href={hrefFor("goal")}
            scroll={false}
            aria-label="Add a goal"
            title="Add a goal"
            className={cn(
              "bg-muted hover:bg-foreground/10 focus-glow grid size-7 place-items-center rounded-full transition-opacity outline-none",
              "opacity-0 group-focus-within/goals:opacity-100 group-hover/goals:opacity-100",
            )}
          >
            <Plus className="size-3.5" aria-hidden="true" />
          </Link>
        )}
      </div>
      {goals.length === 0 && (
        <Link
          href={hrefFor("goal")}
          scroll={false}
          className="hover:bg-muted/60 focus-glow -mx-2 flex items-center gap-3 rounded-2xl p-2 outline-none"
        >
          <IconChip icon={Target} />
          <span className="min-w-0 flex-1 text-sm">Set a goal and watch it fill up here.</span>
        </Link>
      )}
      {goals.map((g) => (
        <GoalRow key={g.id} goal={g} href={hrefFor({ kind: "goal", id: g.id })} canEdit={canEdit} />
      ))}
    </section>
  );
}

function GoalRow({ goal: g, href, canEdit }: { goal: TodayGoal; href: string; canEdit: boolean }) {
  const fmt = (n: number) => (g.metric === "amount_won" ? formatMoney(n) : n.toLocaleString("en-US"));
  const won = goalStanding(g) === "won";
  return (
    <Link
      href={href}
      scroll={false}
      title={canEdit ? "Change this goal" : "See this goal"}
      className={cn(
        "focus-glow -mx-2 flex items-center gap-3.5 rounded-2xl p-2 outline-none",
        won ? "bg-tint-success" : "hover:bg-muted/60",
      )}
    >
      <GoalGauge
        share={g.share}
        pace={g.pace}
        onTrack={g.onTrack}
        size={76}
        label={`${fmt(g.actual)} of ${fmt(g.target)}`}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">
          {g.name || g.metricLabel}
          {g.who && <span className="font-normal opacity-70">, {g.who}</span>}
        </span>
        <span className="mt-1 flex items-baseline gap-1.5">
          <b className="numeral min-w-0 truncate text-[24px]">{fmt(g.actual)}</b>
          <span className="shrink-0 text-xs opacity-70">of {fmt(g.target)}</span>
        </span>
        <span
          className={cn(
            "mt-1 flex items-center gap-1 text-xs",
            won ? "text-tint-success-foreground font-semibold" : "text-muted-foreground",
          )}
        >
          {won && <CircleCheck className="size-3.5 shrink-0" aria-hidden="true" />}
          <span className="truncate">{standingWords(g.metric, g)}</span>
        </span>
      </span>
    </Link>
  );
}
