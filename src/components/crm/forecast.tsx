"use client";

import { ChartLine, CircleCheck, Flag, Plus, Target, Trash2, Trophy } from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  deleteGoalAction,
  saveForecastCallAction,
  saveGoalAction,
  setForecastCategoryAction,
} from "@/app/app/[orgSlug]/crm/automation-actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FieldSelect } from "@/components/ui/field-select";
import { Input } from "@/components/ui/input";
import { chipClass, segmentedItem, segmentedTrack } from "@/components/ui/segmented";
import { Stat, StatStrip } from "@/components/ui/stat";
import { toast } from "@/components/ui/toaster";
import { GOAL_LABELS, GOAL_METRICS, type Category, type GoalMetric } from "@/lib/crm/forecast";
import { runAction } from "@/lib/run-action";
import { cn } from "@/lib/utils";

/**
 * The Forecast tab's interactive parts: members mark their items Commit,
 * Best case, Pipeline or Left out; managers put their own call over the
 * roll-up and set goals.
 */

const CATEGORIES: { value: Category; label: string }[] = [
  { value: "COMMIT", label: "Commit" },
  { value: "BEST_CASE", label: "Best case" },
  { value: "PIPELINE", label: "Pipeline" },
  { value: "OMITTED", label: "Left out" },
];

function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const act = (call: () => Promise<{ ok: boolean; error?: string }>, done?: string) =>
    start(async () => {
      const r = await runAction(call);
      if (!r) return;
      if (!r.ok) {
        toast({ title: r.error ?? "That didn't work.", tone: "error" });
        return;
      }
      if (done) toast({ title: done });
      router.refresh();
    });
  return { pending, act };
}

export interface ForecastItemRow {
  id: string;
  title: string;
  href: string;
  stage: string;
  amount: string | null;
  expected: string | null;
  owner: string | null;
  category: Category;
  canEdit: boolean;
}

export function ForecastItems({ orgId, rows }: { orgId: string; rows: ForecastItemRow[] }) {
  const { pending, act } = useAct();
  const [local, setLocal] = useState<Record<string, Category>>({});
  if (rows.length === 0) return <p className="text-muted-foreground text-sm">No open items expected in this period.</p>;
  return (
    <ul className="divide-y">
      {rows.map((r) => {
        const value = local[r.id] ?? r.category;
        return (
          <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
            <Link href={r.href} className="min-w-0 flex-1">
              <span className="block truncate font-medium">{r.title}</span>
              <span className="text-muted-foreground block text-xs">
                {[r.stage, r.amount, r.expected ? `expected ${r.expected}` : "no expected date", r.owner].filter(Boolean).join(", ")}
              </span>
            </Link>
            <span className={cn(segmentedTrack, "h-9")} role="group" aria-label={`Forecast for ${r.title}`}>
              {CATEGORIES.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  disabled={!r.canEdit || pending}
                  aria-pressed={value === c.value}
                  onClick={() => {
                    setLocal({ ...local, [r.id]: c.value });
                    act(() => setForecastCategoryAction(orgId, r.id, c.value));
                  }}
                  className={cn(segmentedItem(value === c.value), "h-7 px-2.5 text-xs")}
                >
                  {c.label}
                </button>
              ))}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function ForecastCall({
  orgId,
  pipelineId,
  periodKey,
  hasAmount,
  current,
}: {
  orgId: string;
  pipelineId: string;
  periodKey: string;
  hasAmount: boolean;
  current: { amount: number; count: number; note: string | null; at: string } | null;
}) {
  const { pending, act } = useAct();
  const [amount, setAmount] = useState(current ? String(current.amount / 100) : "");
  const [count, setCount] = useState(current ? String(current.count) : "");
  const [note, setNote] = useState(current?.note ?? "");
  return (
    <div className="flex flex-wrap items-end gap-2">
      {hasAmount && (
        <label className="space-y-1">
          <span className="text-muted-foreground block text-xs">Amount ($)</span>
          <Input type="number" className="w-36" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
      )}
      <label className="space-y-1">
        <span className="text-muted-foreground block text-xs">Items</span>
        <Input type="number" className="w-24" value={count} onChange={(e) => setCount(e.target.value)} />
      </label>
      <label className="min-w-48 flex-1 space-y-1">
        <span className="text-muted-foreground block text-xs">Why (optional)</span>
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Two pledges are certain to slip" />
      </label>
      <Button
        disabled={pending}
        onClick={() =>
          act(
            () => saveForecastCallAction(orgId, { pipelineId, periodKey, amount: Number(amount) || 0, count: Number(count) || 0, note }),
            "Your call is in",
          )
        }
      >
        Save my call
      </Button>
    </div>
  );
}

export interface GoalRow {
  id: string;
  label: string;
  metric: GoalMetric;
  period: string;
  actual: string;
  target: string;
  share: number;
  pace: number;
  onTrack: boolean;
}

export function GoalList({
  orgId,
  goals,
  manager,
  members,
  pipelineId,
  periods,
}: {
  orgId: string;
  goals: GoalRow[];
  manager: boolean;
  members: { id: string; name: string }[];
  pipelineId: string | null;
  periods: { key: string; label: string }[];
}) {
  const { pending, act } = useAct();
  const [adding, setAdding] = useState(false);
  const [metric, setMetric] = useState<GoalMetric>("amount_won");
  const [owner, setOwner] = useState("");
  const [period, setPeriod] = useState(periods[0]?.key ?? "");
  const [target, setTarget] = useState("");
  return (
    <div className="space-y-3">
      {goals.length === 0 && !adding && <p className="text-muted-foreground text-sm">No goals for these dates yet.</p>}
      <ul className="space-y-3">
        {goals.map((g) => (
          <li key={g.id} className="space-y-1.5">
            <div className="flex flex-wrap items-baseline gap-2 text-sm">
              <b className="font-medium">{g.label}</b>
              <span className="text-muted-foreground text-xs">{g.period}</span>
              <span className="ms-auto font-semibold tabular-nums">
                {g.actual} <span className="text-muted-foreground font-normal">of {g.target}</span>
              </span>
              {manager && (
                <Button variant="ghost" size="icon-sm" disabled={pending} onClick={() => act(() => deleteGoalAction(orgId, g.id), "Goal removed")} aria-label={`Remove ${g.label}`}>
                  <Trash2 className="size-4" />
                </Button>
              )}
            </div>
            <div className="bg-muted relative h-2.5 overflow-hidden rounded-full" aria-hidden="true">
              <div className="h-full rounded-full" style={{ width: `${Math.min(100, g.share * 100)}%`, background: g.onTrack ? "var(--chart-2)" : "var(--chart-4)" }} />
              <span className="bg-foreground/50 absolute top-0 h-full w-0.5" style={{ left: `${Math.min(100, g.pace * 100)}%` }} />
            </div>
            <p className="text-muted-foreground text-xs">
              {g.share >= 1 ? "Reached." : g.onTrack ? "On track." : "Behind pace."} {Math.round(g.share * 100)}% there, {Math.round(g.pace * 100)}% of the way through.
            </p>
          </li>
        ))}
      </ul>
      {manager &&
        (adding ? (
          <div className="bg-muted/40 rounded-tile space-y-3 p-4">
            <div className="flex flex-wrap gap-2">
              {GOAL_METRICS.map((m) => (
                <button key={m} type="button" aria-pressed={metric === m} onClick={() => setMetric(m)} className={cn(chipClass(metric === m), "h-9 px-3.5")}>
                  {GOAL_LABELS[m]}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="space-y-1">
                <span className="text-muted-foreground block text-xs">For</span>
                <FieldSelect value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="For">
                  <option value="">The whole team</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </FieldSelect>
              </label>
              <div className="space-y-1">
                <span className="text-muted-foreground block text-xs">Period</span>
                <div className="flex flex-wrap gap-2">
                  {periods.map((p) => (
                    <button key={p.key} type="button" aria-pressed={period === p.key} onClick={() => setPeriod(p.key)} className={cn(chipClass(period === p.key), "h-9 px-3.5")}>
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              <label className="space-y-1">
                <span className="text-muted-foreground block text-xs">Target{metric === "amount_won" ? " ($)" : ""}</span>
                <Input type="number" className="w-32" value={target} onChange={(e) => setTarget(e.target.value)} />
              </label>
              <Button
                disabled={pending}
                onClick={() =>
                  act(
                    () =>
                      saveGoalAction(orgId, {
                        metric,
                        periodKey: period,
                        target: Number(target),
                        ownerId: owner || null,
                        pipelineId: metric === "amount_won" || metric === "items_won" ? pipelineId : null,
                      }),
                    "Goal set",
                  )
                }
              >
                Set the goal
              </Button>
              <Button variant="ghost" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            <Plus className="size-4" /> Add a goal
          </Button>
        ))}
    </div>
  );
}

/** How the forecast moved: one line per number over the weekly snapshots. */
export function SnapshotChart({
  points,
  money,
}: {
  points: { at: string; won: number; weighted: number; commit: number; bestCase: number }[];
  money: boolean;
}) {
  if (points.length < 2) {
    return <p className="text-muted-foreground text-sm">A snapshot is taken every week. The line shows once there are two.</p>;
  }
  const series = [
    { key: "bestCase", label: "Best case", color: "var(--chart-3)" },
    { key: "weighted", label: "Weighted", color: "var(--chart-1)" },
    { key: "commit", label: "Commit", color: "var(--chart-4)" },
    { key: "won", label: "Won", color: "var(--chart-2)" },
  ] as const;
  const max = Math.max(1, ...points.flatMap((p) => series.map((s) => p[s.key])));
  const w = 600;
  const h = 160;
  const step = w / (points.length - 1);
  const fmt = (v: number) =>
    money ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(v / 100) : String(Math.round(v * 10) / 10);
  return (
    <Card className="gap-3 p-0 shadow-none ring-0">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-40 w-full" preserveAspectRatio="none" role="img" aria-label="How the forecast moved, week by week">
        {series.map((s) => (
          <polyline
            key={s.key}
            fill="none"
            stroke={s.color}
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            points={points.map((p, i) => `${(i * step).toFixed(1)},${(h - (p[s.key] / max) * (h - 8) - 4).toFixed(1)}`).join(" ")}
          />
        ))}
      </svg>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full" style={{ background: s.color }} aria-hidden="true" />
            {s.label} {fmt(points[points.length - 1]![s.key])}
          </span>
        ))}
      </div>
    </Card>
  );
}

const STAT_ICONS = { won: Trophy, commit: CircleCheck, best: Flag, weighted: ChartLine, trend: Target } as const;

/** The forecast's numbers, as the stat strip. */
export function ForecastStats({ stats }: { stats: { key: keyof typeof STAT_ICONS; value: string; label: string }[] }) {
  return (
    <StatStrip>
      {stats.map((s) => (
        <Stat key={s.key} icon={STAT_ICONS[s.key]} value={s.value} label={s.label} />
      ))}
    </StatStrip>
  );
}
