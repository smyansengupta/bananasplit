"use client";

import { Trash2 } from "@/components/icons";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import {
  deleteGoalAction,
  goalActualAction,
  saveGoalAction,
} from "@/app/app/[orgSlug]/crm/goal-actions";
import { AMBIENT_BUTTON } from "@/components/ambient/ambient-button";
import { CrmCard } from "@/components/crm/card/crm-card";
import { useCrmOpen } from "@/components/crm/card/use-crm-open";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { FieldSelect } from "@/components/ui/field-select";
import { Input } from "@/components/ui/input";
import { chipClass } from "@/components/ui/segmented";
import { toast } from "@/components/ui/toaster";
import { parsePeriodKey, type GoalMetric } from "@/lib/crm/forecast";
import {
  GOAL_WHAT,
  GOAL_WHATS,
  goalPeriods,
  goalTitle,
  isMoney,
  paceWords,
  parseTarget,
} from "@/lib/crm/goal-pace";
import { runAction } from "@/lib/run-action";
import { cn } from "@/lib/utils";

/**
 * A goal as a card (?open=goal, ?open=goal:<id>): what it counts, whose,
 * when, the target, and a live line saying where the pace lands by the end
 * (black is so far, grey is the pace). Save keeps it with Undo; "…"
 * deletes it, with Undo too. CRM managers set goals; every other member
 * gets the same card read-only (the facts in words, the pace, and who can
 * change it), and a new goal tells them who sets goals. A Personal space
 * has no Who: every goal is yours.
 */

export interface GoalCardData {
  id: string | null;
  metric: GoalMetric;
  ownerId: string | null;
  pipelineId: string | null;
  periodKey: string;
  /** In the goal's units (dollars for money). */
  target: number | null;
  /** So far, for the starting what, who and when (cents for money). */
  actual: number;
  today: string;
  viewerId: string;
  members: { id: string; name: string }[];
  canEdit: boolean;
  personal?: boolean;
}

const OUTLINE =
  "text-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklab,currentColor_28%,transparent)] hover:bg-muted";

export function GoalCard({ orgId, data }: { orgId: string; data: GoalCardData | null }) {
  const router = useRouter();
  const { close } = useCrmOpen();
  const [id, setId] = useState(data?.id ?? null);
  const [metric, setMetric] = useState<GoalMetric>(data?.metric ?? "items_won");
  const [owner, setOwner] = useState<string | null>(data?.ownerId ?? null);
  const [periodKey, setPeriodKey] = useState(data?.periodKey ?? "");
  const [text, setText] = useState(data?.target ? fmtTarget(data.metric, data.target) : "");
  const [actual, setActual] = useState(data?.actual ?? 0);
  const [saved, setSaved] = useState<null | (() => Promise<void>)>(null);
  const [busy, setBusy] = useState(false);
  const asked = useRef(0);
  const first = useRef(true);

  // What, who or when changed: read what it's reached so far for that.
  useEffect(() => {
    if (!data) return;
    if (first.current) {
      first.current = false;
      return;
    }
    const n = ++asked.current;
    void goalActualAction(orgId, {
      metric,
      ownerId: owner,
      pipelineId: data.pipelineId,
      periodKey,
    }).then((r) => {
      if (n === asked.current && r.ok) setActual(r.actual);
    });
  }, [orgId, data, metric, owner, periodKey]);

  if (!data) {
    return (
      <CrmCard title="Not here">
        <EmptyState
          title="This goal isn't here any more"
          description="Someone may have deleted it."
        />
      </CrmCard>
    );
  }

  const periods = goalPeriods(data.today, current(data.periodKey));
  const chosen = periods.find((p) => p.key === periodKey) ?? periods[0]!;
  const target = parseTarget(text);
  const targetIn = target === null ? 0 : isMoney(metric) ? Math.round(target * 100) : target;
  const words = paceWords(metric, actual, targetIn, chosen.period, data.today);
  const who =
    owner === null
      ? null
      : {
          me: owner === data.viewerId,
          name: data.members.find((m) => m.id === owner)?.name ?? "A member",
        };
  const title = goalTitle(metric, who, chosen.label);
  const others = data.members.filter((m) => m.id !== data.viewerId);
  const edit = data.canEdit;

  if (!edit && !data.id) {
    return (
      <CrmCard title="New goal">
        <EmptyState
          title="CRM managers set goals"
          description="Ask an owner, an admin or a CRM manager to set one. Today shows every goal's score."
        />
      </CrmCard>
    );
  }
  const change =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setSaved(null);
    };

  const save = async () => {
    if (target === null) {
      toast({ title: "Give it a target above zero.", tone: "error" });
      return;
    }
    setBusy(true);
    const r = await runAction(() =>
      saveGoalAction(orgId, {
        id,
        metric,
        ownerId: owner,
        periodKey,
        target,
        name: GOAL_WHAT[metric].label,
      }),
    );
    setBusy(false);
    if (!r) return;
    if (!r.ok) {
      toast({ title: r.error, tone: "error" });
      return;
    }
    const madeId = r.id;
    const before = r.before;
    setId(madeId);
    setSaved(() => async () => {
      const u = before
        ? await runAction(() => saveGoalAction(orgId, { ...before, id: madeId }))
        : await runAction(() => deleteGoalAction(orgId, madeId));
      if (u && !u.ok) toast({ title: u.error, tone: "error" });
      if (!before) setId(null);
      setSaved(null);
      router.refresh();
    });
    router.refresh();
  };

  const remove = async () => {
    if (!id) return;
    const keep = {
      metric,
      ownerId: owner,
      periodKey,
      target: target ?? 0,
      name: GOAL_WHAT[metric].label,
    };
    const r = await runAction(() => deleteGoalAction(orgId, id));
    if (r && !r.ok) {
      toast({ title: r.error, tone: "error" });
      return;
    }
    toast({
      title: "Goal deleted.",
      action: {
        label: "Undo",
        run: async () => {
          await runAction(() => saveGoalAction(orgId, keep));
          router.refresh();
        },
      },
    });
    close();
    router.refresh();
  };

  return (
    <CrmCard
      title={title}
      description="A goal: what it counts, whose, when, and its target"
      menu={
        edit && id ? (
          <DropdownMenuItem onSelect={() => void remove()}>
            <Trash2 className="size-4" aria-hidden="true" />
            Delete the goal
          </DropdownMenuItem>
        ) : undefined
      }
      foot={
        <div className="flex flex-nowrap items-center gap-2">
          <span className="text-muted-foreground min-w-0 flex-1 truncate text-sm">
            {!edit
              ? "Only CRM managers change goals. Ask one to change this."
              : saved
                ? "Saved. Today shows the new target."
                : "Black is so far, grey is where the pace lands."}
          </span>
          {saved && (
            <button
              type="button"
              className={cn(AMBIENT_BUTTON, OUTLINE)}
              onClick={() => void saved()}
            >
              Undo
            </button>
          )}
          {edit && (
            <Button onClick={() => void save()} disabled={busy || target === null}>
              Save
            </Button>
          )}
        </div>
      }
    >
      {!edit ? (
        <div className="space-y-5">
          <dl className="grid grid-cols-[4rem_minmax(0,1fr)] gap-x-2 gap-y-3 text-[15px]">
            <dt className="text-muted-foreground text-sm leading-6">What</dt>
            <dd className="font-semibold">{GOAL_WHAT[metric].label}</dd>
            {!data.personal && (
              <>
                <dt className="text-muted-foreground text-sm leading-6">Who</dt>
                <dd className="font-semibold">
                  {who ? (who.me ? "You" : who.name) : "Whole team"}
                </dd>
              </>
            )}
            <dt className="text-muted-foreground text-sm leading-6">When</dt>
            <dd className="font-semibold">{chosen.label}</dd>
            <dt className="text-muted-foreground text-sm leading-6">Target</dt>
            <dd className="font-semibold tabular-nums">
              {target === null ? "Not set" : fmtTarget(metric, target)}{" "}
              <span className="text-muted-foreground text-sm font-normal">
                {GOAL_WHAT[metric].unit}
              </span>
            </dd>
          </dl>
          <Pace words={words} />
        </div>
      ) : (
        <div className="space-y-5">
          <Row label="What">
            {GOAL_WHATS.map((m) => (
              <Chip
                key={m}
                on={metric === m}
                disabled={!edit}
                onClick={() => {
                  change(setMetric)(m);
                  // Money and counts read differently: "$5,000" or "5000".
                  if (target !== null) setText(fmtTarget(m, target));
                }}
              >
                {GOAL_WHAT[m].label}
              </Chip>
            ))}
          </Row>
          {!data.personal && (
            <Row label="Who">
              <Chip on={owner === null} disabled={!edit} onClick={() => change(setOwner)(null)}>
                Whole team
              </Chip>
              <Chip
                on={owner === data.viewerId}
                disabled={!edit}
                onClick={() => change(setOwner)(data.viewerId)}
              >
                Me
              </Chip>
              {others.length > 0 && (
                <FieldSelect
                  aria-label="Someone else"
                  disabled={!edit}
                  value={owner && owner !== data.viewerId ? owner : ""}
                  onChange={(e) => change(setOwner)(e.target.value || null)}
                  className="h-10 w-48 rounded-full"
                >
                  <option value="">Someone else</option>
                  {others.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </FieldSelect>
              )}
            </Row>
          )}
          <Row label="When">
            {periods.map((p) => (
              <Chip
                key={p.key}
                on={periodKey === p.key}
                disabled={!edit}
                onClick={() => change(setPeriodKey)(p.key)}
              >
                {p.label}
              </Chip>
            ))}
          </Row>
          <Row label="Target">
            <Input
              aria-label="Target"
              inputMode="decimal"
              value={text}
              disabled={!edit}
              placeholder={isMoney(metric) ? "$25,000" : "10"}
              onChange={(e) => change(setText)(e.target.value)}
              onBlur={() => target !== null && setText(fmtTarget(metric, target))}
              className="h-10 w-40 text-[15px] font-semibold tabular-nums"
            />
            <span className="text-muted-foreground text-sm">{GOAL_WHAT[metric].unit}</span>
          </Row>
          <Pace words={words} />
        </div>
      )}
    </CrmCard>
  );
}

/** Where the pace lands: black is so far, grey is the pace by the end. */
function Pace({ words }: { words: ReturnType<typeof paceWords> }) {
  return (
    <div className="bg-muted space-y-2.5 rounded-2xl px-4 py-3.5">
      <b className="block text-[15px]">{words.pace}</b>
      <div className="bg-card relative h-2.5 overflow-hidden rounded-full" aria-hidden="true">
        <div
          className="bg-muted-foreground/40 absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${Math.round(words.paceShare * 100)}%` }}
        />
        <div
          className="bg-foreground absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${Math.round(words.soFarShare * 100)}%` }}
        />
      </div>
      <span className="text-muted-foreground block text-sm">{words.sub}</span>
    </div>
  );
}

function fmtTarget(metric: GoalMetric, n: number): string {
  return isMoney(metric) ? `$${n.toLocaleString("en-US")}` : String(n);
}

function current(key: string) {
  const p = parsePeriodKey(key);
  return p ? { key: p.key, label: p.label, start: p.start, end: p.end } : null;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-muted-foreground w-16 shrink-0 text-sm">{label}</span>
      {children}
    </div>
  );
}

function Chip({
  on,
  disabled,
  onClick,
  children,
}: {
  on: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={cn(chipClass(on), "disabled:opacity-60")}
    >
      {children}
    </button>
  );
}
