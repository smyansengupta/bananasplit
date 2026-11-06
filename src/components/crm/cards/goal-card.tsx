"use client";

import { Trash2 } from "@/components/icons";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import {
  deleteGoalAction,
  goalActualAction,
  saveGoalAction,
} from "@/app/app/[orgSlug]/crm/goal-actions";
import { CrmFormCard } from "@/components/crm/card/crm-form-card";
import { GoalGauge } from "@/components/crm/today/goal-gauge";
import { MemberOwnerField } from "@/components/tasks/task-fields";
import { Button } from "@/components/ui/button";
import {
  FormDialogBody,
  FormDialogFoot,
  FormDialogHead,
  FormField,
  FormRow,
} from "@/components/ui/form-dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/toaster";
import { attainment, parsePeriodKey, type GoalMetric } from "@/lib/crm/forecast";
import {
  formatGoal,
  GOAL_WHAT,
  GOAL_WHATS,
  goalPeriods,
  goalStanding,
  goalTitle,
  isMoney,
  paceWords,
  parseTarget,
  standingWords,
} from "@/lib/crm/goal-pace";
import { runAction } from "@/lib/run-action";
import { cn } from "@/lib/utils";
import type { OrgMemberOption } from "@/server/members";

/**
 * A goal, in New person's window: its fields in pairs (what it counts and
 * the target, who and when), then its score: the ring, the number so far,
 * and a live line saying where the pace lands by the end. A goal hit says
 * so. A new goal (?open=goal) opens at once from what the page holds
 * (CrmCreateHost) and reads what it's reached in the background. Save and
 * Delete close it with Undo in the toast. CRM managers set goals; every
 * other member sees the same window read-only, and a new goal tells them
 * who sets goals. A Personal space has no Who: every goal is yours.
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
  members: OrgMemberOption[];
  canEdit: boolean;
  personal?: boolean;
}

export function GoalCard({ orgId, data }: { orgId: string; data: GoalCardData | null }) {
  if (!data) {
    return (
      <Notice title="This goal isn't here any more" line="Someone may have deleted it." />
    );
  }
  if (!data.canEdit && !data.id) {
    return (
      <Notice
        title="CRM managers set goals"
        line="Ask an owner, an admin or a CRM manager to set one. Today shows every goal's score."
      />
    );
  }
  return (
    <CrmFormCard>{(shut) => <GoalForm orgId={orgId} data={data} shut={shut} />}</CrmFormCard>
  );
}

function Notice({ title, line }: { title: string; line: string }) {
  return (
    <CrmFormCard>
      {(shut) => (
        <>
          <FormDialogHead title={title} description={line} className="pb-5" />
          <FormDialogFoot>
            <Button type="button" onClick={shut}>
              Done
            </Button>
          </FormDialogFoot>
        </>
      )}
    </CrmFormCard>
  );
}

function GoalForm({
  orgId,
  data,
  shut,
}: {
  orgId: string;
  data: GoalCardData;
  shut: () => void;
}) {
  const router = useRouter();
  const ids = useId();
  const [id] = useState(data.id);
  const [metric, setMetric] = useState<GoalMetric>(data.metric);
  const [owner, setOwner] = useState<string | null>(data.ownerId);
  const [periodKey, setPeriodKey] = useState(data.periodKey);
  const [text, setText] = useState(data.target ? fmtTarget(data.metric, data.target) : "");
  const [actual, setActual] = useState(data.actual);
  const [busy, setBusy] = useState(false);
  const asked = useRef(0);
  // A saved goal comes with what it's reached; a new one reads it after opening.
  const known = useRef(Boolean(data.id));

  // What, who or when changed: read what it's reached so far for that.
  useEffect(() => {
    if (known.current) {
      known.current = false;
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
  }, [orgId, data.pipelineId, metric, owner, periodKey]);

  const periods = goalPeriods(data.today, current(data.periodKey));
  const chosen = periods.find((p) => p.key === periodKey) ?? periods[0]!;
  const target = parseTarget(text);
  const targetIn = target === null ? 0 : isMoney(metric) ? Math.round(target * 100) : target;
  const who =
    owner === null
      ? null
      : {
          me: owner === data.viewerId,
          name: data.members.find((m) => m.id === owner)?.name ?? "A member",
        };
  const title = goalTitle(metric, who, chosen.label);
  const edit = data.canEdit;
  const isNew = !id;
  const field = (name: string) => `${ids}-${name}`;

  const input = (n: number) => ({
    metric,
    ownerId: owner,
    periodKey,
    target: n,
    name: GOAL_WHAT[metric].label,
  });

  /** Saves it, says so with Undo, and closes. */
  const save = async () => {
    if (target === null) {
      toast({ title: "Give it a target above zero.", tone: "error" });
      return;
    }
    setBusy(true);
    const r = await runAction(() => saveGoalAction(orgId, { ...input(target), id }));
    setBusy(false);
    if (!r) return;
    if (!r.ok) {
      toast({ title: r.error, tone: "error" });
      return;
    }
    const madeId = r.id;
    const before = r.before;
    toast({
      title: isNew ? `${title}: set. Today shows its score.` : "Saved. Today shows the new target.",
      action: {
        label: "Undo",
        run: async () => {
          const u = before
            ? await runAction(() => saveGoalAction(orgId, { ...before, id: madeId }))
            : await runAction(() => deleteGoalAction(orgId, madeId));
          if (u && !u.ok) toast({ title: u.error, tone: "error" });
          router.refresh();
        },
      },
    });
    shut();
    router.refresh();
  };

  const remove = async () => {
    if (!id) return;
    const keep = input(target ?? 0);
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
    shut();
    router.refresh();
  };

  const score = (
    <GoalScore
      metric={metric}
      actual={actual}
      target={targetIn}
      period={chosen.period}
      today={data.today}
    />
  );

  if (!edit) {
    return (
      <>
        <FormDialogHead
          title={title}
          description="Only CRM managers change goals. Ask one to change this."
        />
        <FormDialogBody>
          <FormRow>
            <ReadField label="What" value={GOAL_WHAT[metric].label} />
            <ReadField
              label="Target"
              value={target === null ? "Not set" : fmtTarget(metric, target)}
              hint={GOAL_WHAT[metric].unit}
            />
          </FormRow>
          <FormRow>
            {!data.personal && (
              <ReadField label="Who" value={who ? (who.me ? "You" : who.name) : "Whole team"} />
            )}
            <ReadField label="When" value={chosen.label} />
          </FormRow>
          {score}
        </FormDialogBody>
        <FormDialogFoot>
          <Button type="button" onClick={shut}>
            Done
          </Button>
        </FormDialogFoot>
      </>
    );
  }

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <FormDialogHead
        title={isNew ? "New goal" : title}
        description="What it counts, whose, when, and its target. Today shows its score."
      />
      <FormDialogBody>
        <FormRow>
          <FormField label="What" htmlFor={field("what")}>
            <Select
              value={metric}
              onValueChange={(v) => {
                const m = v as GoalMetric;
                setMetric(m);
                // Money and counts read differently: "$5,000" or "5000".
                if (target !== null) setText(fmtTarget(m, target));
              }}
            >
              <SelectTrigger id={field("what")} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GOAL_WHATS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {GOAL_WHAT[m].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Target" htmlFor={field("target")}>
            <Input
              id={field("target")}
              autoFocus
              inputMode="decimal"
              value={text}
              placeholder={isMoney(metric) ? "$25,000" : "10"}
              onChange={(e) => setText(e.target.value)}
              onBlur={() => target !== null && setText(fmtTarget(metric, target))}
            />
          </FormField>
        </FormRow>
        <FormRow>
          {!data.personal && (
            <FormField label="Who" htmlFor={field("who")}>
              <MemberOwnerField
                id={field("who")}
                label="Who"
                value={owner}
                onChange={setOwner}
                members={data.members}
                none={{ well: "Whole team", option: "Whole team" }}
                hint={(m) =>
                  m.id === data.viewerId || m.title ? (
                    <small className="text-muted-foreground ms-auto max-w-28 shrink-0 truncate text-xs font-normal">
                      {m.id === data.viewerId ? "You" : m.title}
                    </small>
                  ) : null
                }
              />
            </FormField>
          )}
          <FormField label="When" htmlFor={field("when")}>
            <Select value={periodKey} onValueChange={setPeriodKey}>
              <SelectTrigger id={field("when")} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {periods.map((p) => (
                  <SelectItem key={p.key} value={p.key}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        </FormRow>
        {score}
      </FormDialogBody>
      <FormDialogFoot>
        {id && (
          <Button
            type="button"
            variant="ghost"
            className="sm:me-auto"
            onClick={() => void remove()}
          >
            <Trash2 aria-hidden="true" />
            Delete goal
          </Button>
        )}
        <Button type="button" variant="outline" onClick={shut}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || target === null}>
          {isNew ? (busy ? "Creating…" : "Create goal") : busy ? "Saving…" : "Save goal"}
        </Button>
      </FormDialogFoot>
    </form>
  );
}

/** A field that can't be changed here: the same box, to read. */
function ReadField({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const id = useId();
  return (
    <FormField label={label} htmlFor={id} hint={hint}>
      <Input id={id} readOnly value={value} />
    </FormField>
  );
}

/** The goal's score: the ring, the number so far, and where the pace lands. */
function GoalScore({
  metric,
  actual,
  target,
  period,
  today,
}: {
  metric: GoalMetric;
  actual: number;
  /** Cents for money; 0 when there's no target yet. */
  target: number;
  period: { start: string; end: string };
  today: string;
}) {
  const a = attainment(actual, target, period, today);
  const words = paceWords(metric, actual, target, period, today);
  const won = target > 0 && goalStanding(a) === "won";
  return (
    <div
      className={cn(
        "flex items-center gap-4 rounded-2xl px-4 py-3.5",
        won ? "bg-tint-success" : "bg-muted",
      )}
    >
      <GoalGauge
        share={a.share}
        pace={a.pace}
        onTrack={a.onTrack || target === 0}
        size={104}
        label={target > 0 ? `${formatGoal(metric, actual)} of ${formatGoal(metric, target)}` : "No target yet"}
      />
      <div className="min-w-0 flex-1">
        <b className="numeral block truncate text-[28px]">{formatGoal(metric, actual)}</b>
        <b className="mt-1.5 block text-sm">
          {target > 0 ? (won ? standingWords(metric, a) : words.pace) : "Give it a target to see the pace."}
        </b>
        <span className="text-muted-foreground block text-sm">{target > 0 ? words.sub : null}</span>
      </div>
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
