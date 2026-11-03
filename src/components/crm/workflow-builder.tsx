"use client";

import { ArrowDown, ArrowUp, Eye, Plus, Sparkles, Trash2, X } from "@/components/icons";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";

import {
  deleteWorkflowAction,
  describeWorkflowAction,
  dryRunAction,
  saveWorkflowAction,
} from "@/app/app/[orgSlug]/crm/automation-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FieldSelect } from "@/components/ui/field-select";
import { Input } from "@/components/ui/input";
import { chipClass } from "@/components/ui/segmented";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { FORECAST_LABELS, STATUS_LABELS } from "@/lib/crm/fields";
import {
  ACTION_INFO,
  ACTION_TYPES,
  OP_LABELS,
  CONDITION_OPS,
  TRIGGER_INFO,
  TRIGGER_TYPES,
  VALUELESS_OPS,
  WORKFLOW_FIELDS,
  triggerObject,
  type ActionType,
  type Condition,
  type RunLogEntry,
  type Trigger,
  type TriggerType,
  type WorkflowAction,
  type WorkflowField,
  type WorkflowObject,
} from "@/lib/crm/workflows";
import { runAction } from "@/lib/run-action";
import { cn } from "@/lib/utils";

/**
 * The workflow builder (docs/features/crm.md, module 6): When, If, Then on
 * one page, in the app's own controls, buttons over drop-downs. Describe it
 * in words fills it in for review; Try it runs it on one record without
 * changing anything; Save keeps it off until it's switched on.
 */

export interface BuilderContext {
  pipelines: { id: string; name: string; itemNoun: string; stages: { id: string; name: string; kind: string }[] }[];
  members: { id: string; name: string }[];
  templates: { id: string; name: string }[];
  sequences: { id: string; name: string }[];
  forms: { id: string; title: string }[];
  events: { id: string; title: string }[];
  relationships: { id: string; label: string }[];
  customFields: Record<WorkflowObject, { key: string; label: string }[]>;
}

export interface BuilderDraft {
  name: string;
  trigger: Trigger;
  conditions: Condition[];
  actions: WorkflowAction[];
}

const OBJECT_LABEL: Record<WorkflowObject, string> = { person: "A person", company: "A company", deal: "An item" };

const label = "text-muted-foreground mb-1.5 block text-[13px] font-medium";

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <Card className="gap-4 p-5 sm:p-6">
      <div>
        <h2 className="heading text-lg">{title}</h2>
        {hint && <p className="text-muted-foreground text-sm">{hint}</p>}
      </div>
      {children}
    </Card>
  );
}

function Chips<T extends string>({
  options,
  value,
  onPick,
  label: name,
}: {
  options: readonly { value: T; label: string; hint?: string }[];
  value: T | null | undefined;
  onPick: (v: T) => void;
  label: string;
}) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={name}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          title={o.hint}
          onClick={() => onPick(o.value)}
          className={cn(chipClass(value === o.value), "h-9 px-3.5")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function defaultTrigger(type: TriggerType, prev: Trigger): Trigger {
  const object = TRIGGER_INFO[type].objects.includes(prev.params.object ?? "person") ? (prev.params.object ?? "person") : TRIGGER_INFO[type].objects[0]!;
  const params: Trigger["params"] = {};
  if (type !== "stage.changed" && type !== "deal.stuck") params.object = object;
  if (type === "no.activity") params.days = 30;
  if (type === "date.reached") {
    params.field = object === "deal" ? "expectedOn" : "nextFollowUpAt";
    params.offsetDays = 0;
  }
  if (type === "field.changed") params.field = WORKFLOW_FIELDS[object][0]!.key;
  if (prev.params.pipelineId && (type === "stage.changed" || type === "deal.stuck" || object === "deal")) params.pipelineId = prev.params.pipelineId;
  return { type, params };
}

function defaultAction(type: ActionType, ctx: BuilderContext): WorkflowAction {
  switch (type) {
    case "task.create":
      return { type, params: { title: "Follow up with {name}", dueInDays: 3, assignTo: "owner" } };
    case "field.set":
      return { type, params: { field: "nextFollowUpAt", value: "+7d" } };
    case "stage.move":
      return { type, params: { stageId: ctx.pipelines[0]?.stages[0]?.id ?? "" } };
    case "owner.assign":
      return { type, params: { mode: "round_robin", userIds: [] } };
    case "deal.create":
      return { type, params: { pipelineId: ctx.pipelines[0]?.id ?? "" } };
    case "template.send":
      return { type, params: { templateId: ctx.templates[0]?.id ?? "" } };
    case "sequence.enroll":
      return { type, params: { sequenceId: ctx.sequences[0]?.id ?? "" } };
    case "event.invite":
      return { type, params: { eventId: ctx.events[0]?.id ?? "" } };
    case "notify":
      return { type, params: { to: "owner", message: "{name} needs a look." } };
    case "slack.post":
      return { type, params: { url: "", message: "{name}: {link}" } };
    case "discord.post":
      return { type, params: { url: "", message: "{name}: {link}" } };
    case "webhook.call":
      return { type, params: { url: "" } };
    case "finance.create":
      return { type, params: { direction: "IN", description: "{title}", amountFrom: "item" } };
    case "project.start":
      return { type, params: { name: "{title}", tasks: ["Kickoff meeting", "Plan the work"], ownerFrom: "owner", linkFiles: true } };
  }
}

/** Every field the builder offers for an object: built-in first, then custom. */
function fieldsFor(object: WorkflowObject, ctx: BuilderContext): WorkflowField[] {
  return [
    ...WORKFLOW_FIELDS[object],
    ...ctx.customFields[object].map((f) => ({ key: f.key, label: f.label, kind: "text" as const, settable: true })),
  ];
}

function ValueInput({
  field,
  value,
  onChange,
  ctx,
  pipelineId,
}: {
  field: WorkflowField | undefined;
  value: unknown;
  onChange: (v: string | number | boolean | null) => void;
  ctx: BuilderContext;
  pipelineId?: string | null;
}) {
  const v = value === null || value === undefined ? "" : String(value);
  const select = (options: { value: string; label: string }[]) => (
    <FieldSelect value={v} onChange={(e) => onChange(e.target.value)} aria-label="Value">
      <option value="">Pick one</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </FieldSelect>
  );
  switch (field?.kind) {
    case "member":
      return select(ctx.members.map((m) => ({ value: m.id, label: m.name })));
    case "status":
      return select(Object.entries(STATUS_LABELS).map(([k, l]) => ({ value: k, label: l })));
    case "relationship":
      return select(ctx.relationships.map((r) => ({ value: r.id, label: r.label })));
    case "forecast":
      return select(Object.entries(FORECAST_LABELS).map(([k, l]) => ({ value: k, label: l })));
    case "stage": {
      const pipelines = ctx.pipelines.filter((p) => !pipelineId || p.id === pipelineId);
      return select(pipelines.flatMap((p) => p.stages.map((s) => ({ value: s.id, label: pipelines.length > 1 ? `${p.name}: ${s.name}` : s.name }))));
    }
    case "bool":
      return (
        <Chips
          label="Value"
          options={[
            { value: "true", label: "Yes" },
            { value: "false", label: "No" },
          ]}
          value={v === "true" || v === "false" ? (v as "true" | "false") : null}
          onPick={(x) => onChange(x === "true")}
        />
      );
    case "number":
      return <Input type="number" value={v} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} aria-label="Value" className="w-32" />;
    case "date":
      return <Input value={v} onChange={(e) => onChange(e.target.value)} placeholder="+3d, today or 2026-12-01" aria-label="Value" className="w-56" />;
    default:
      return <Input value={v} onChange={(e) => onChange(e.target.value)} aria-label="Value" className="min-w-48 flex-1" />;
  }
}

function TriggerEditor({ trigger, onChange, ctx }: { trigger: Trigger; onChange: (t: Trigger) => void; ctx: BuilderContext }) {
  const object = triggerObject(trigger);
  const p = trigger.params;
  const set = (patch: Partial<Trigger["params"]>) => onChange({ ...trigger, params: { ...p, ...patch } });
  const pipeline = ctx.pipelines.find((x) => x.id === p.pipelineId);
  const objects = TRIGGER_INFO[trigger.type].objects;
  return (
    <div className="space-y-4">
      <Chips
        label="When"
        options={TRIGGER_TYPES.map((t) => ({ value: t, label: TRIGGER_INFO[t].label, hint: TRIGGER_INFO[t].hint }))}
        value={trigger.type}
        onPick={(t) => onChange(defaultTrigger(t, trigger))}
      />
      {objects.length > 1 && (
        <div>
          <span className={label}>About</span>
          <Chips
            label="About"
            options={objects.map((o) => ({ value: o, label: OBJECT_LABEL[o] }))}
            value={object}
            onPick={(o) => onChange(defaultTrigger(trigger.type, { ...trigger, params: { ...p, object: o } }))}
          />
        </div>
      )}
      {object === "deal" && ctx.pipelines.length > 0 && (
        <div>
          <span className={label}>In</span>
          <Chips
            label="Pipeline"
            options={[{ value: "", label: "Any pipeline" }, ...ctx.pipelines.map((x) => ({ value: x.id, label: x.name }))]}
            value={p.pipelineId ?? ""}
            onPick={(id) => set({ pipelineId: id || null, toStageId: null })}
          />
        </div>
      )}
      {trigger.type === "stage.changed" && (
        <div>
          <span className={label}>Into</span>
          <Chips
            label="Into"
            options={[
              { value: "any", label: "Any stage" },
              { value: "WON", label: "Won" },
              { value: "LOST", label: "Lost" },
              ...(pipeline?.stages ?? []).map((s) => ({ value: s.id, label: s.name })),
            ]}
            value={p.toStageId ?? p.toKind ?? "any"}
            onPick={(v) =>
              set(v === "any" ? { toStageId: null, toKind: null } : v === "WON" || v === "LOST" ? { toKind: v, toStageId: null } : { toStageId: v, toKind: null })
            }
          />
          {!pipeline && <p className="text-muted-foreground mt-2 text-xs">Pick a pipeline to choose one of its stages.</p>}
        </div>
      )}
      {trigger.type === "form.submitted" && ctx.forms.length > 0 && (
        <div>
          <span className={label}>Which form</span>
          <Chips
            label="Form"
            options={[{ value: "", label: "Any form" }, ...ctx.forms.map((f) => ({ value: f.id, label: f.title }))]}
            value={p.formId ?? ""}
            onPick={(id) => set({ formId: id || null })}
          />
        </div>
      )}
      {(trigger.type === "field.changed" || trigger.type === "date.reached") && (
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <span className={label}>{trigger.type === "date.reached" ? "The date" : "The field"}</span>
            <FieldSelect value={p.field ?? ""} onChange={(e) => set({ field: e.target.value })} aria-label="Field">
              {fieldsFor(object, ctx)
                .filter((f) => trigger.type !== "date.reached" || f.kind === "date" || f.key.startsWith("custom."))
                .map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
            </FieldSelect>
          </div>
          {trigger.type === "date.reached" && (
            <div>
              <span className={label}>Days before (minus) or after</span>
              <Input type="number" value={p.offsetDays ?? 0} onChange={(e) => set({ offsetDays: Number(e.target.value) || 0 })} className="w-28" />
            </div>
          )}
        </div>
      )}
      {(trigger.type === "no.activity" || trigger.type === "deal.stuck") && (
        <div>
          <span className={label}>{trigger.type === "deal.stuck" ? "Days in one stage (empty: the stage's own limit)" : "Days with no contact"}</span>
          <Input
            type="number"
            value={p.days ?? ""}
            onChange={(e) => set({ days: e.target.value ? Math.max(1, Number(e.target.value)) : undefined })}
            className="w-28"
          />
        </div>
      )}
    </div>
  );
}

function ConditionsEditor({
  conditions,
  onChange,
  object,
  ctx,
  pipelineId,
}: {
  conditions: Condition[];
  onChange: (c: Condition[]) => void;
  object: WorkflowObject;
  ctx: BuilderContext;
  pipelineId?: string | null;
}) {
  const fields = fieldsFor(object, ctx);
  const set = (i: number, patch: Partial<Condition>) => onChange(conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  return (
    <div className="space-y-3">
      {conditions.length === 0 && <p className="text-muted-foreground text-sm">No conditions: it runs every time.</p>}
      {conditions.map((c, i) => {
        const field = fields.find((f) => f.key === c.field);
        return (
          <div key={i} className="bg-muted/40 rounded-tile flex flex-wrap items-center gap-2 p-3">
            <FieldSelect value={c.field} onChange={(e) => set(i, { field: e.target.value, value: null })} aria-label="Field">
              {fields.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </FieldSelect>
            <FieldSelect value={c.op} onChange={(e) => set(i, { op: e.target.value as Condition["op"] })} aria-label="Test">
              {CONDITION_OPS.map((op) => (
                <option key={op} value={op}>
                  {OP_LABELS[op]}
                </option>
              ))}
            </FieldSelect>
            {!VALUELESS_OPS.includes(c.op) && (
              <ValueInput field={field} value={c.value} onChange={(v) => set(i, { value: v })} ctx={ctx} pipelineId={pipelineId} />
            )}
            <Button variant="ghost" size="icon-sm" onClick={() => onChange(conditions.filter((_, j) => j !== i))} aria-label="Remove condition">
              <X className="size-4" />
            </Button>
          </div>
        );
      })}
      <Button variant="outline" size="sm" onClick={() => onChange([...conditions, { field: fields[0]!.key, op: "is", value: null }])}>
        <Plus className="size-4" /> Add a condition
      </Button>
    </div>
  );
}

function MemberChips({ ctx, value, onChange }: { ctx: BuilderContext; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {ctx.members.map((m) => {
        const on = value.includes(m.id);
        return (
          <button
            key={m.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== m.id) : [...value, m.id])}
            className={cn(chipClass(on), "h-8 px-3 text-[13px]")}
          >
            {m.name}
          </button>
        );
      })}
    </div>
  );
}

function ActionEditor({
  action,
  onChange,
  ctx,
  object,
  pipelineId,
}: {
  action: WorkflowAction;
  onChange: (a: WorkflowAction) => void;
  ctx: BuilderContext;
  object: WorkflowObject;
  pipelineId?: string | null;
}) {
  const memberSelect = (value: string | undefined, set: (id: string) => void) => (
    <FieldSelect value={value ?? ""} onChange={(e) => set(e.target.value)} aria-label="Member">
      <option value="">Pick someone</option>
      {ctx.members.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name}
        </option>
      ))}
    </FieldSelect>
  );
  const pick = <T extends { id: string }>(items: T[], value: string, show: (t: T) => string, set: (id: string) => void, none: string) =>
    items.length === 0 ? (
      <p className="text-muted-foreground text-sm">{none}</p>
    ) : (
      <Chips label="Pick" options={items.map((i) => ({ value: i.id, label: show(i) }))} value={value} onPick={set} />
    );
  switch (action.type) {
    case "task.create": {
      const p = action.params;
      return (
        <div className="space-y-3">
          <Input value={p.title} onChange={(e) => onChange({ ...action, params: { ...p, title: e.target.value } })} aria-label="Task title" />
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-muted-foreground text-sm">Due in</span>
            <Input type="number" className="w-20" value={p.dueInDays ?? ""} onChange={(e) => onChange({ ...action, params: { ...p, dueInDays: e.target.value === "" ? undefined : Math.max(0, Number(e.target.value)) } })} aria-label="Due in days" />
            <span className="text-muted-foreground text-sm">days, for</span>
            <Chips
              label="For"
              options={[
                { value: "owner", label: "The owner" },
                { value: "member", label: "Someone" },
                { value: "nobody", label: "Nobody yet" },
              ]}
              value={p.assignTo}
              onPick={(v) => onChange({ ...action, params: { ...p, assignTo: v } })}
            />
            {p.assignTo === "member" && memberSelect(p.userId, (id) => onChange({ ...action, params: { ...p, userId: id || undefined } }))}
          </div>
        </div>
      );
    }
    case "field.set": {
      const p = action.params;
      const fields = fieldsFor(object, ctx).filter((f) => f.settable);
      return (
        <div className="flex flex-wrap items-center gap-2">
          <FieldSelect value={p.field} onChange={(e) => onChange({ ...action, params: { field: e.target.value, value: null } })} aria-label="Field">
            {fields.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </FieldSelect>
          <span className="text-muted-foreground text-sm">to</span>
          <ValueInput field={fields.find((f) => f.key === p.field)} value={p.value} onChange={(v) => onChange({ ...action, params: { ...p, value: v } })} ctx={ctx} pipelineId={pipelineId} />
        </div>
      );
    }
    case "stage.move": {
      const pipelines = ctx.pipelines.filter((x) => !pipelineId || x.id === pipelineId);
      return pick(
        pipelines.flatMap((x) => x.stages.map((s) => ({ id: s.id, name: pipelines.length > 1 ? `${x.name}: ${s.name}` : s.name }))),
        action.params.stageId,
        (s) => s.name,
        (id) => onChange({ ...action, params: { stageId: id } }),
        "Add a pipeline first.",
      );
    }
    case "owner.assign": {
      const p = action.params;
      return (
        <div className="space-y-3">
          <Chips
            label="How"
            options={[
              { value: "round_robin", label: "Take turns" },
              { value: "fewest", label: "Whoever has the fewest" },
              { value: "member", label: "One person" },
            ]}
            value={p.mode}
            onPick={(mode) => onChange({ ...action, params: { ...p, mode } })}
          />
          {p.mode === "member" ? (
            memberSelect(p.userId, (id) => onChange({ ...action, params: { ...p, userId: id || undefined } }))
          ) : (
            <div>
              <span className={label}>Among (none picked: everyone)</span>
              <MemberChips ctx={ctx} value={p.userIds} onChange={(userIds) => onChange({ ...action, params: { ...p, userIds } })} />
            </div>
          )}
        </div>
      );
    }
    case "deal.create":
      return pick(ctx.pipelines, action.params.pipelineId, (x) => x.name, (id) => onChange({ ...action, params: { pipelineId: id } }), "Add a pipeline first.");
    case "template.send":
      return (
        <div className="space-y-2">
          {pick(ctx.templates, action.params.templateId, (x) => x.name, (id) => onChange({ ...action, params: { templateId: id } }), "No email templates yet.")}
          <p className="text-muted-foreground text-xs">The email waits for the owner to look over before it goes. Never to anyone who unsubscribed.</p>
        </div>
      );
    case "sequence.enroll":
      return pick(ctx.sequences, action.params.sequenceId, (x) => x.name, (id) => onChange({ ...action, params: { sequenceId: id } }), "No sequences yet.");
    case "event.invite":
      return pick(ctx.events, action.params.eventId, (x) => x.title, (id) => onChange({ ...action, params: { eventId: id } }), "No upcoming events.");
    case "notify": {
      const p = action.params;
      return (
        <div className="space-y-3">
          <Chips
            label="Tell"
            options={[
              { value: "owner", label: "The owner" },
              { value: "member", label: "Someone" },
              { value: "managers", label: "Admins and CRM managers" },
            ]}
            value={p.to}
            onPick={(to) => onChange({ ...action, params: { ...p, to } })}
          />
          {p.to === "member" && memberSelect(p.userId, (id) => onChange({ ...action, params: { ...p, userId: id || undefined } }))}
          <Input value={p.message} onChange={(e) => onChange({ ...action, params: { ...p, message: e.target.value } })} aria-label="Message" />
        </div>
      );
    }
    case "slack.post":
    case "discord.post": {
      const p = action.params;
      return (
        <div className="space-y-2">
          <Input
            value={p.url}
            onChange={(e) => onChange({ ...action, params: { ...p, url: e.target.value } })}
            placeholder={action.type === "slack.post" ? "https://hooks.slack.com/services/..." : "https://discord.com/api/webhooks/..."}
            aria-label="Webhook address"
          />
          <Input value={p.message} onChange={(e) => onChange({ ...action, params: { ...p, message: e.target.value } })} aria-label="Message" />
        </div>
      );
    }
    case "webhook.call":
      return (
        <div className="space-y-2">
          <Input value={action.params.url} onChange={(e) => onChange({ ...action, params: { url: e.target.value } })} placeholder="https://" aria-label="Webhook address" />
          <p className="text-muted-foreground text-xs">Sends the event, the record&apos;s kind, id, name and link as JSON. https only.</p>
        </div>
      );
    case "finance.create": {
      const p = action.params;
      return (
        <div className="space-y-3">
          <Chips
            label="Direction"
            options={[
              { value: "IN", label: "Money in" },
              { value: "OUT", label: "Money out (a draft)" },
            ]}
            value={p.direction}
            onPick={(direction) => onChange({ ...action, params: { ...p, direction } })}
          />
          <Input value={p.description} onChange={(e) => onChange({ ...action, params: { ...p, description: e.target.value } })} aria-label="Description" />
          <div className="flex flex-wrap items-center gap-3">
            <Chips
              label="Amount"
              options={[
                { value: "item", label: "The item's amount" },
                { value: "fixed", label: "A set amount" },
              ]}
              value={p.amountFrom}
              onPick={(amountFrom) => onChange({ ...action, params: { ...p, amountFrom } })}
            />
            {p.amountFrom === "fixed" && (
              <Input type="number" className="w-32" value={p.amount ?? ""} onChange={(e) => onChange({ ...action, params: { ...p, amount: e.target.value === "" ? undefined : Number(e.target.value) } })} aria-label="Amount in dollars" />
            )}
          </div>
        </div>
      );
    }
    case "project.start": {
      const p = action.params;
      return (
        <div className="space-y-3">
          <Input value={p.name} onChange={(e) => onChange({ ...action, params: { ...p, name: e.target.value } })} aria-label="Project name" />
          <div>
            <span className={label}>Tasks, one a line</span>
            <Textarea
              rows={4}
              value={p.tasks.join("\n")}
              onChange={(e) => onChange({ ...action, params: { ...p, tasks: e.target.value.split("\n").map((t) => t.slice(0, 200)).filter((t, i, all) => t.trim() || i === all.length - 1) } })}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-muted-foreground text-sm">Led by</span>
            <Chips
              label="Led by"
              options={[
                { value: "owner", label: "The owner" },
                { value: "member", label: "Someone" },
              ]}
              value={p.ownerFrom}
              onPick={(ownerFrom) => onChange({ ...action, params: { ...p, ownerFrom } })}
            />
            {p.ownerFrom === "member" && memberSelect(p.userId, (id) => onChange({ ...action, params: { ...p, userId: id || undefined } }))}
            <button type="button" aria-pressed={p.linkFiles} onClick={() => onChange({ ...action, params: { ...p, linkFiles: !p.linkFiles } })} className={cn(chipClass(p.linkFiles), "h-9 px-3.5")}>
              Bring the files
            </button>
          </div>
        </div>
      );
    }
  }
}

export function RunLog({ log }: { log: RunLogEntry[] }) {
  return (
    <ol className="space-y-1.5">
      {log.map((e, i) => (
        <li key={i} className="flex items-start gap-2 text-sm">
          <span
            className={cn(
              "mt-1.5 size-2 shrink-0 rounded-full",
              e.queued ? "bg-muted-foreground" : e.ok ? "bg-[var(--chart-2)]" : e.detail.startsWith("Failed") ? "bg-block-alert" : "bg-muted-strong",
            )}
            aria-hidden="true"
          />
          <span>
            <b className="font-medium">{e.action in ACTION_INFO ? ACTION_INFO[e.action as ActionType].label : e.action === "conditions" ? "Conditions" : "When"}</b>
            <span className="text-muted-foreground">: {e.detail}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

export function WorkflowBuilder({
  orgId,
  orgSlug,
  workflowId,
  initial,
  status,
  ctx,
  describeFirst,
}: {
  orgId: string;
  orgSlug: string;
  workflowId: string | null;
  initial: BuilderDraft;
  status: "DRAFT" | "ON" | "OFF";
  ctx: BuilderContext;
  describeFirst?: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<BuilderDraft>(initial);
  const [described, setDescribed] = useState<string>("");
  const [notes, setNotes] = useState<string[]>([]);
  const [noAi, setNoAi] = useState<string | null>(null);
  const [dry, setDry] = useState<{ target: string | null; log: RunLogEntry[] } | null>(null);
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const object = triggerObject(draft.trigger);
  const pipelineId = draft.trigger.params.pipelineId ?? null;
  const base = `/app/${orgSlug}/crm/automations`;

  const save = (next?: "ON" | "OFF") =>
    start(async () => {
      const r = await runAction(() =>
        saveWorkflowAction(orgId, { id: workflowId, workflow: draft, status: next, described: described || null }),
      );
      if (!r) return;
      if (!r.ok) {
        toast({ title: r.error, tone: "error" });
        return;
      }
      toast({ title: next === "ON" ? "Saved and switched on" : "Saved" });
      if (!workflowId) router.replace(`${base}/${r.id}`);
      else router.refresh();
    });

  const tryIt = () =>
    start(async () => {
      if (!workflowId) {
        toast({ title: "Save it first, then try it." });
        return;
      }
      const saved = await runAction(() => saveWorkflowAction(orgId, { id: workflowId, workflow: draft }));
      if (!saved || !saved.ok) {
        if (saved && !saved.ok) toast({ title: saved.error, tone: "error" });
        return;
      }
      const r = await runAction(() => dryRunAction(orgId, workflowId));
      if (!r) return;
      if (!r.ok) {
        toast({ title: r.error, tone: "error" });
        return;
      }
      setDry({ target: r.result.target?.name ?? null, log: r.result.log });
      router.refresh();
    });

  const describe = () =>
    start(async () => {
      setNoAi(null);
      const r = await runAction(() => describeWorkflowAction(orgId, described));
      if (!r) return;
      if (!r.ok) {
        if (r.noAi) setNoAi(r.error);
        else toast({ title: r.error, tone: "error" });
        return;
      }
      setDraft(r.draft);
      setNotes(r.notes);
      toast({ title: `Filled in by ${r.model}. Look it over, then save.` });
    });

  const remove = () =>
    start(async () => {
      if (!workflowId) return;
      const r = await runAction(() => deleteWorkflowAction(orgId, workflowId));
      if (!r) return;
      if (!r.ok) {
        toast({ title: r.error, tone: "error" });
        return;
      }
      toast({ title: "Deleted" });
      router.replace(base);
    });

  const setAction = (i: number, a: WorkflowAction) => setDraft({ ...draft, actions: draft.actions.map((x, j) => (j === i ? a : x)) });
  const move = (i: number, d: -1 | 1) => {
    const next = [...draft.actions];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x!);
    setDraft({ ...draft, actions: next });
  };

  return (
    <div className="space-y-4">
      <Card className="gap-3 p-5 sm:p-6">
        <div className="flex items-center gap-2">
          <Sparkles className="text-muted-foreground size-4" aria-hidden="true" />
          <h2 className="heading text-lg">Describe it in words</h2>
        </div>
        <Textarea
          rows={2}
          autoFocus={describeFirst}
          value={described}
          onChange={(e) => setDescribed(e.target.value)}
          placeholder="When someone fills in the volunteer form, add them to Volunteers, assign whoever has the fewest, and remind them in two days"
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={describe} disabled={pending || described.trim().length < 8}>
            <Sparkles className="size-4" /> Turn into steps
          </Button>
          <span className="text-muted-foreground text-xs">Uses your organization&apos;s AI connection. You review every step before it&apos;s on.</span>
        </div>
        {noAi && <p className="bg-muted/50 rounded-tile p-3 text-sm">{noAi}</p>}
        {notes.length > 0 && (
          <ul className="bg-muted/50 rounded-tile list-disc space-y-1 p-3 ps-7 text-sm">
            {notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="gap-3 p-5 sm:p-6">
        <label className={label} htmlFor="wf-name">
          Name
        </label>
        <Input id="wf-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Welcome new volunteers" />
      </Card>

      <Section title="When" hint="What sets it off.">
        <TriggerEditor trigger={draft.trigger} onChange={(trigger) => setDraft({ ...draft, trigger })} ctx={ctx} />
      </Section>

      <Section title="If" hint="Only when all of these hold. Custom fields too.">
        <ConditionsEditor conditions={draft.conditions} onChange={(conditions) => setDraft({ ...draft, conditions })} object={object} ctx={ctx} pipelineId={pipelineId} />
      </Section>

      <Section title="Then" hint="In this order. Use {name}, {title}, {stage}, {company}, {owner}, {amount} or {link} in any text.">
        <ol className="space-y-3">
          {draft.actions.map((a, i) => (
            <li key={i} className="bg-muted/40 rounded-tile space-y-3 p-4">
              <div className="flex items-center gap-2">
                <span className="bg-foreground text-background grid size-6 place-items-center rounded-full text-xs font-semibold tabular-nums">{i + 1}</span>
                <b className="flex-1">{ACTION_INFO[a.type].label}</b>
                <Button variant="ghost" size="icon-sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                  <ArrowUp className="size-4" />
                </Button>
                <Button variant="ghost" size="icon-sm" disabled={i === draft.actions.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
                  <ArrowDown className="size-4" />
                </Button>
                <Button variant="ghost" size="icon-sm" onClick={() => setDraft({ ...draft, actions: draft.actions.filter((_, j) => j !== i) })} aria-label="Remove step">
                  <Trash2 className="size-4" />
                </Button>
              </div>
              <ActionEditor action={a} onChange={(x) => setAction(i, x)} ctx={ctx} object={object} pipelineId={pipelineId} />
            </li>
          ))}
        </ol>
        {adding ? (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              {ACTION_TYPES.filter((t) => (t !== "stage.move" || object === "deal") && (t !== "deal.create" || object !== "deal")).map((t) => (
                <button
                  key={t}
                  type="button"
                  title={ACTION_INFO[t].hint}
                  onClick={() => {
                    setDraft({ ...draft, actions: [...draft.actions, defaultAction(t, ctx)] });
                    setAdding(false);
                  }}
                  className={cn(chipClass(false), "h-9 px-3.5")}
                >
                  {ACTION_INFO[t].label}
                </button>
              ))}
            </div>
            <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)} className="self-start">
            <Plus className="size-4" /> Add a step
          </Button>
        )}
      </Section>

      {dry && (
        <Card className="gap-3 p-5 sm:p-6">
          <h2 className="heading text-lg">Tried on {dry.target ?? "nothing yet"}</h2>
          {dry.target ? <RunLog log={dry.log} /> : <p className="text-muted-foreground text-sm">There&apos;s nothing for it to run on yet.</p>}
          <p className="text-muted-foreground text-xs">Nothing was changed. The try is kept in the run history.</p>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="create" onClick={() => save("ON")} disabled={pending}>
          {status === "ON" ? "Save" : "Save and switch on"}
        </Button>
        {status !== "ON" && (
          <Button variant="outline" onClick={() => save()} disabled={pending}>
            Save, keep it off
          </Button>
        )}
        <Button variant="outline" onClick={tryIt} disabled={pending || !workflowId} title={workflowId ? "Runs it on one record without changing anything" : "Save it first"}>
          <Eye className="size-4" /> Try it
        </Button>
        {status === "ON" && <Badge variant="secondary">On</Badge>}
        <span className="flex-1" />
        {workflowId && (
          <Button variant="ghost" onClick={remove} disabled={pending}>
            <Trash2 className="size-4" /> Delete
          </Button>
        )}
      </div>
    </div>
  );
}
