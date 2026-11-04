"use client";

import { AlarmClock, Briefcase, HandCoins, Handshake, Hourglass, Mic, Package, PiggyBank, Plus, Sparkles, Trash2, UserPlus, Zap, type IconComponent } from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  addStarterRulesAction,
  deleteScoreRuleAction,
  enableRecipeAction,
  rescoreAction,
  saveScoreRuleAction,
  setWorkflowStatusAction,
} from "@/app/app/[orgSlug]/crm/automation-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FieldSelect } from "@/components/ui/field-select";
import { Input } from "@/components/ui/input";
import { chipClass } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toaster";
import { crmAutomationHref } from "@/lib/crm/href";
import { BEHAVIOURS, BEHAVIOUR_LABELS, type RuleCondition, type ScoreObject } from "@/lib/crm/scoring";
import { CONDITION_OPS, OP_LABELS, VALUELESS_OPS, WORKFLOW_FIELDS } from "@/lib/crm/workflows";
import { runAction } from "@/lib/run-action";
import { cn } from "@/lib/utils";

/**
 * CRM settings > Automations and sending's lists: the organization's workflows
 * (switched on and off right on the row), the ready-made recipes (one
 * click), and the score rules with the learned model's state.
 */

export interface WorkflowRow {
  id: string;
  name: string;
  status: "DRAFT" | "ON" | "OFF";
  summary: string;
  runCount: number;
  lastRun: string | null;
  failedRecently: number;
}

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : null;

function useAct(orgId: string) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const act = <T extends { ok: boolean; error?: string }>(call: () => Promise<T>, done?: string | ((r: T) => string | null)) =>
    start(async () => {
      const r = await runAction(call);
      if (!r) return;
      if (!r.ok) {
        toast({ title: r.error ?? "That didn't work.", tone: "error" });
        return;
      }
      const msg = typeof done === "function" ? done(r) : done;
      if (msg) toast({ title: msg });
      router.refresh();
    });
  return { pending, act, orgId };
}

/**
 * The running list in CRM settings, inside its card: each
 * automation's name and what it does, a failed count when there is one,
 * and its switch on the right (off stops it right away).
 */
export function WorkflowList({ orgId, orgSlug, rows }: { orgId: string; orgSlug: string; rows: WorkflowRow[] }) {
  const { pending, act } = useAct(orgId);
  if (rows.length === 0) {
    return <p className="text-muted-foreground py-2 text-sm">None yet. Describe one above, or start from a recipe.</p>;
  }
  return (
    <ul className="divide-border divide-y">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center gap-3 py-3">
          <Link href={crmAutomationHref(orgSlug, r.id)} scroll={false} className="group min-w-0 flex-[1_1_16rem]">
            <b className="block text-[15px] font-semibold group-hover:underline">{r.name}</b>
            <span className="text-muted-foreground block text-sm">
              {/[.!?]$/.test(r.summary.trim()) ? r.summary : `${r.summary.trim()}.`}
              {r.runCount > 0 && r.lastRun ? ` Last ran ${when(r.lastRun)}.` : ""}
            </span>
          </Link>
          {r.failedRecently > 0 && <Badge variant="destructive">{r.failedRecently} failed this week</Badge>}
          {r.status === "DRAFT" && <Badge variant="secondary">Draft</Badge>}
          <Switch
            checked={r.status === "ON"}
            disabled={pending}
            aria-label={r.status === "ON" ? `Switch off ${r.name}` : `Switch on ${r.name}`}
            onCheckedChange={(on) => act(() => setWorkflowStatusAction(orgId, r.id, on ? "ON" : "OFF"), on ? "Switched on" : "Switched off")}
          />
        </li>
      ))}
    </ul>
  );
}

export interface RecipeCard {
  id: string;
  title: string;
  description: string;
  icon: string;
  missing: string | null;
  workflowId: string | null;
  status: "DRAFT" | "ON" | "OFF" | null;
}

const RECIPE_ICONS: Record<string, IconComponent> = { AlarmClock, Briefcase, HandCoins, Handshake, Hourglass, Mic, Package, PiggyBank, UserPlus };

export function RecipeGrid({ orgId, orgSlug, recipes }: { orgId: string; orgSlug: string; recipes: RecipeCard[] }) {
  const { pending, act } = useAct(orgId);
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {recipes.map((r) => {
        const Icon = RECIPE_ICONS[r.icon] ?? Zap;
        const on = r.status === "ON";
        return (
          <Card key={r.id} className={cn("gap-3 p-5", r.missing && "opacity-70")}>
            <div className="flex items-start gap-3">
              <span className="bg-muted grid size-9 shrink-0 place-items-center rounded-full">
                <Icon className="size-4" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold">{r.title}</h3>
                <p className="text-muted-foreground text-sm">{r.description}</p>
              </div>
            </div>
            <div className="mt-auto flex flex-wrap items-center gap-2">
              {r.missing ? (
                <span className="text-muted-foreground text-xs">Needs {r.missing}.</span>
              ) : on ? (
                <>
                  <Badge variant="success">On</Badge>
                  <Button variant="ghost" size="sm" asChild>
                    <Link href={crmAutomationHref(orgSlug, r.workflowId)} scroll={false}>Edit</Link>
                  </Button>
                  <Button variant="ghost" size="sm" disabled={pending} onClick={() => act(() => setWorkflowStatusAction(orgId, r.workflowId!, "OFF"), "Switched off")}>
                    Switch off
                  </Button>
                </>
              ) : (
                <>
                  <Button size="sm" disabled={pending} onClick={() => act(() => enableRecipeAction(orgId, r.id), "Switched on")}>
                    Switch on
                  </Button>
                  {r.workflowId && (
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={crmAutomationHref(orgSlug, r.workflowId)} scroll={false}>Edit</Link>
                    </Button>
                  )}
                </>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

export interface RuleRow {
  id: string;
  objectKind: ScoreObject;
  label: string;
  condition: RuleCondition;
  points: number;
  active: boolean;
}

export interface ModelInfo {
  trained: boolean;
  trainedAt: string | null;
  n: number;
  accuracy: number | null;
  closed: number;
  needs: number;
  top: { label: string; direction: "up" | "down" }[];
}

function describeRule(c: RuleCondition, fieldLabel: (k: string) => string): string {
  if ("activity" in c) return `${BEHAVIOUR_LABELS[c.activity]} within ${c.withinDays} days${c.atLeast && c.atLeast > 1 ? `, ${c.atLeast} times or more` : ""}`;
  return `${fieldLabel(c.field)} ${OP_LABELS[c.op]}${VALUELESS_OPS.includes(c.op) ? "" : ` ${String(c.value ?? "")}`}`;
}

function RuleForm({ orgId, objectKind, onDone }: { orgId: string; objectKind: ScoreObject; onDone: () => void }) {
  const { pending, act } = useAct(orgId);
  const object = objectKind === "people" ? "person" : "deal";
  const fields = WORKFLOW_FIELDS[object];
  const [kind, setKind] = useState<"behaviour" | "field">("behaviour");
  const [activity, setActivity] = useState<(typeof BEHAVIOURS)[number]>("replied");
  const [days, setDays] = useState(30);
  const [field, setField] = useState(fields[0]!.key);
  const [op, setOp] = useState<(typeof CONDITION_OPS)[number]>("not_empty");
  const [value, setValue] = useState("");
  const [points, setPoints] = useState(10);
  const [labelText, setLabel] = useState("");
  const condition: RuleCondition =
    kind === "behaviour" ? { activity, withinDays: days } : { field, op, ...(VALUELESS_OPS.includes(op) ? {} : { value }) };
  const fieldLabel = (k: string) => fields.find((f) => f.key === k)?.label ?? k;
  return (
    <div className="bg-muted/40 rounded-tile space-y-3 p-4">
      <div className="flex flex-wrap gap-2">
        {(["behaviour", "field"] as const).map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className={cn(chipClass(kind === k), "h-9 px-3.5")}>
            {k === "behaviour" ? "Something they did" : "A field"}
          </button>
        ))}
      </div>
      {kind === "behaviour" ? (
        <div className="flex flex-wrap items-center gap-2">
          <FieldSelect value={activity} onChange={(e) => setActivity(e.target.value as typeof activity)} aria-label="What they did">
            {BEHAVIOURS.map((b) => (
              <option key={b} value={b}>
                {BEHAVIOUR_LABELS[b]}
              </option>
            ))}
          </FieldSelect>
          <span className="text-muted-foreground text-sm">within</span>
          <Input type="number" className="w-20" value={days} onChange={(e) => setDays(Math.max(1, Number(e.target.value) || 1))} aria-label="Days" />
          <span className="text-muted-foreground text-sm">days</span>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <FieldSelect value={field} onChange={(e) => setField(e.target.value)} aria-label="Field">
            {fields.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </FieldSelect>
          <FieldSelect value={op} onChange={(e) => setOp(e.target.value as typeof op)} aria-label="Test">
            {CONDITION_OPS.map((o) => (
              <option key={o} value={o}>
                {OP_LABELS[o]}
              </option>
            ))}
          </FieldSelect>
          {!VALUELESS_OPS.includes(op) && <Input value={value} onChange={(e) => setValue(e.target.value)} className="w-48" aria-label="Value" />}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground text-sm">Points</span>
        <Input type="number" className="w-24" value={points} onChange={(e) => setPoints(Number(e.target.value) || 0)} aria-label="Points" />
        <Input value={labelText} onChange={(e) => setLabel(e.target.value)} placeholder={describeRule(condition, fieldLabel)} className="min-w-56 flex-1" aria-label="Name" />
        <Button
          disabled={pending}
          onClick={() =>
            act(
              () =>
                saveScoreRuleAction(orgId, {
                  rule: { objectKind, label: labelText.trim() || describeRule(condition, fieldLabel), condition, points, active: true },
                }),
              (r) => {
                onDone();
                return r.ok ? "Rule added. Scores update tonight, or press Recompute now." : null;
              },
            )
          }
        >
          Add rule
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function ScoringPanel({ orgId, rules, model }: { orgId: string; rules: RuleRow[]; model: ModelInfo }) {
  const { pending, act } = useAct(orgId);
  const [adding, setAdding] = useState<ScoreObject | null>(null);
  return (
    <div className="space-y-4">
      {(["people", "deals"] as const).map((kind) => {
        const list = rules.filter((r) => r.objectKind === kind);
        const object = kind === "people" ? "person" : "deal";
        const fieldLabel = (k: string) => WORKFLOW_FIELDS[object].find((f) => f.key === k)?.label ?? k;
        return (
          <Card key={kind} className="gap-3 p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="heading flex-1 text-lg">{kind === "people" ? "People's scores" : "Items' scores"}</h2>
              {list.length === 0 && (
                <Button variant="outline" size="sm" disabled={pending} onClick={() => act(() => addStarterRulesAction(orgId, kind), (r) => ("added" in r ? `Added ${(r as { added: number }).added} rules` : null))}>
                  <Sparkles className="size-4" /> Add the starter rules
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => setAdding(kind)}>
                <Plus className="size-4" /> Add a rule
              </Button>
            </div>
            <p className="text-muted-foreground text-sm">
              Points add up to a score from 0 to 100, recomputed every night. Sort People{kind === "deals" ? " and pipelines" : ""} by Score.
              {kind === "deals" && model.trained && " Open deals use the learned model instead."}
            </p>
            {adding === kind && <RuleForm orgId={orgId} objectKind={kind} onDone={() => setAdding(null)} />}
            {list.length > 0 && (
              <ul className="divide-y">
                {list.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 py-2.5">
                    <span className={cn("w-12 text-right font-semibold tabular-nums", r.points < 0 && "text-tint-danger-foreground")}>
                      {r.points > 0 ? `+${r.points}` : r.points}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{r.label}</span>
                      <span className="text-muted-foreground block text-xs">{describeRule(r.condition, fieldLabel)}</span>
                    </span>
                    <Button variant="ghost" size="icon-sm" disabled={pending} onClick={() => act(() => deleteScoreRuleAction(orgId, r.id), "Rule removed")} aria-label={`Remove ${r.label}`}>
                      <Trash2 className="size-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        );
      })}
      <Card className="gap-3 p-5 sm:p-6">
        <h2 className="heading text-lg">Learned from your own deals</h2>
        {model.trained ? (
          <>
            <p className="text-sm">
              Trained on {model.n.toLocaleString("en-US")} closed deals{model.trainedAt ? `, ${when(model.trainedAt)}` : ""}.
              {model.accuracy !== null && ` Right ${Math.round(model.accuracy * 100)}% of the time on deals it hadn't seen.`}
            </p>
            {model.top.length > 0 && (
              <p className="text-muted-foreground text-sm">
                What matters most: {model.top.map((t) => `${t.label} (${t.direction === "up" ? "helps" : "hurts"})`).join(", ")}.
              </p>
            )}
          </>
        ) : (
          <p className="text-muted-foreground text-sm">
            Once {model.needs} deals have closed as won or lost ({model.closed} so far), a model learns what your wins have in common, every night, and scores each open deal by its chance, with the reasons beside it.
          </p>
        )}
        <Button variant="outline" size="sm" className="self-start" disabled={pending} onClick={() => act(() => rescoreAction(orgId), "Recomputing every score now")}>
          Recompute now
        </Button>
      </Card>
    </div>
  );
}
