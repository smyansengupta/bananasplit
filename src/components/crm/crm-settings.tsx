"use client";

import { ArrowDown, ArrowUp, Plus, Trash2, X } from "@/components/icons";
import { useRouter } from "next/navigation";
import { useCallback, useState, type ReactNode } from "react";

import {
  addFieldAction,
  archivePipelineAction,
  createPipelineAction,
  deleteFieldAction,
  saveRelationshipTypesAction,
  saveStagesAction,
  setAccessAction,
  setManagersAction,
  setRequiredAction,
  updateFieldAction,
  updatePipelineAction,
} from "@/app/app/[orgSlug]/crm/actions";
import { relationDatabasesAction, searchRelationTargetsAction } from "@/app/app/[orgSlug]/databases/custom-actions";
import {
  FieldOptionsEditor,
  needsOptions,
  optionsReady,
  startingOptions,
  choicesFromText,
} from "@/components/databases/custom/field-options";
import { RelationProvider, type RelationDatabases, type RelationSearch } from "@/components/databases/custom/relation-cell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { chipClass, Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toaster";
import { FIELD_TYPE_META, FIELD_TYPES, type FieldDef, type FieldOptions, type FieldType } from "@/lib/databases/fields";
import { PIPELINE_TEMPLATES, SETUP_KIND_INFO, type SetupKind } from "@/lib/crm/templates";
import { cn } from "@/lib/utils";

/**
 * CRM settings (owners, admins and CRM managers): who sees what, the CRM
 * managers, relationship types, each pipeline with its stages, and the
 * custom fields of People, Companies and each pipeline. Buttons over
 * menus; each part saves on its own.
 */

type Result = { ok: true } | { ok: false; error: string };

function useRun() {
  const router = useRouter();
  return useCallback(
    async (p: Promise<Result>, done?: string) => {
      const r = await p.catch(() => null);
      if (!r || !r.ok) {
        toast({ title: r && !r.ok ? r.error : "That didn't save.", tone: "error" });
        return false;
      }
      if (done) toast({ title: done });
      router.refresh();
      return true;
    },
    [router],
  );
}

function Panel({ title, lead, children }: { title: string; lead?: string; children: ReactNode }) {
  return (
    <Card className="gap-4 p-6">
      <div className="space-y-1">
        <h2 className="display-title text-[20px]">{title}</h2>
        {lead && <p className="text-muted-foreground text-sm">{lead}</p>}
      </div>
      {children}
    </Card>
  );
}

export interface StageRow {
  id?: string;
  name: string;
  kind: "OPEN" | "WON" | "LOST";
  probability: number | null;
  stuckAfterDays: number | null;
  requiredFields: string[];
}

export interface PipelineRow {
  id: string;
  name: string;
  itemNoun: string;
  itemNounPlural: string;
  hasAmount: boolean;
  wonLabel: string;
  lostLabel: string;
  template: string | null;
  stages: StageRow[];
  fields: FieldDef[];
  items: number;
}

export interface FieldGroup {
  key: string;
  title: string;
  object: "person" | "company" | "deal";
  pipelineId?: string;
  databaseId: string | null;
  fields: FieldDef[];
  required: string[];
  builtins: { key: string; label: string }[];
}

export function CrmSettings({
  orgId,
  orgSlug,
  admin,
  access,
  managerIds,
  members,
  relationshipTypes,
  pipelines,
  groups,
  templates,
}: {
  orgId: string;
  orgSlug: string;
  admin: boolean;
  access: "ALL" | "OWN";
  managerIds: string[];
  members: { id: string; name: string }[];
  relationshipTypes: { id: string; label: string; color: string }[];
  pipelines: PipelineRow[];
  groups: FieldGroup[];
  templates: SetupKind[];
}) {
  const run = useRun();
  const search = useCallback<RelationSearch>(async (input) => (await searchRelationTargetsAction(orgId, input)).data ?? [], [orgId]);
  const databases = useCallback<RelationDatabases>(async () => (await relationDatabasesAction(orgId)).data ?? [], [orgId]);
  const [managers, setManagers] = useState(new Set(managerIds));
  const [types, setTypes] = useState(relationshipTypes);

  return (
    <RelationProvider orgId={orgId} orgSlug={orgSlug} labels={{}} search={search} databases={databases}>
      <div className="space-y-6">
        {admin && (
          <Panel title="Who sees what" lead="Owners, admins and CRM managers always see everything.">
            <Segmented
              label="Who sees what"
              value={access}
              onSelect={(v) => run(setAccessAction(orgId, v as "ALL" | "OWN"), "Saved.")}
              options={[
                { value: "ALL", label: "Every member sees everyone" },
                { value: "OWN", label: "Members see their own" },
              ]}
            />
          </Panel>
        )}
        {admin && (
          <Panel title="CRM managers" lead="They set up pipelines, stages and fields without being admins.">
            <div className="flex flex-wrap gap-1.5">
              {members.map((m) => {
                const on = managers.has(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    aria-pressed={on}
                    onClick={async () => {
                      const next = new Set(managers);
                      if (on) next.delete(m.id);
                      else next.add(m.id);
                      setManagers(next);
                      const ok = await run(setManagersAction(orgId, [...next]));
                      if (!ok) setManagers(managers);
                    }}
                    className={cn(chipClass(on), "h-8 px-3 text-[13px]")}
                  >
                    {m.name}
                  </button>
                );
              })}
            </div>
          </Panel>
        )}

        <Panel title="Relationship types" lead="What people are to you. Each person can have one.">
          <div className="space-y-2">
            {types.map((t, i) => (
              <div key={t.id} className="flex items-center gap-2">
                <Input
                  value={t.label}
                  aria-label="Relationship type"
                  onChange={(e) => setTypes((cur) => cur.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                  className="max-w-72"
                />
                <Button variant="ghost" size="icon-sm" aria-label={`Remove ${t.label}`} onClick={() => setTypes((cur) => cur.filter((_, j) => j !== i))}>
                  <X className="size-3.5" aria-hidden="true" />
                </Button>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setTypes((cur) => [...cur, { id: `type-${Date.now().toString(36)}`, label: "", color: "gray" }])}
            >
              <Plus className="size-3.5" aria-hidden="true" />
              Add a type
            </Button>
            <Button size="sm" onClick={() => run(saveRelationshipTypesAction(orgId, types.filter((t) => t.label.trim())), "Saved.")}>
              Save types
            </Button>
          </div>
        </Panel>

        <Panel title="Pipelines" lead="Each one names what it tracks, and is a database too.">
          <div className="space-y-5">
            {pipelines.map((p) => (
              <PipelineEditor key={p.id} orgId={orgId} pipeline={p} />
            ))}
          </div>
          <NewPipeline orgId={orgId} templates={templates} />
        </Panel>

        {groups.map((g) => (
          <Panel key={g.key} title={`${g.title} fields`} lead="Your own fields, on every record and in Databases.">
            <FieldsEditor orgId={orgId} group={g} />
          </Panel>
        ))}
      </div>
    </RelationProvider>
  );
}

function PipelineEditor({ orgId, pipeline }: { orgId: string; pipeline: PipelineRow }) {
  const run = useRun();
  const [name, setName] = useState(pipeline.name);
  const [noun, setNoun] = useState(pipeline.itemNoun);
  const [won, setWon] = useState(pipeline.wonLabel);
  const [lost, setLost] = useState(pipeline.lostLabel);
  const [stages, setStages] = useState<StageRow[]>(pipeline.stages);
  const requirable = [
    { key: "amount", label: "Amount" },
    { key: "closeReason", label: "Reason" },
    { key: "nextStep", label: "Next step" },
    { key: "expectedOn", label: "Expected" },
    { key: "company", label: "Company" },
    { key: "person", label: "Person" },
    ...pipeline.fields.map((f) => ({ key: f.id, label: f.name })),
  ];
  const set = (i: number, patch: Partial<StageRow>) => setStages((cur) => cur.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, d: -1 | 1) =>
    setStages((cur) => {
      const next = [...cur];
      const j = i + d;
      if (j < 0 || j >= next.length) return cur;
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  return (
    <div className="border-border space-y-4 rounded-2xl border p-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">Name</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">One item is a</span>
          <Input value={noun} onChange={(e) => setNoun(e.target.value)} />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">Won reads</span>
          <Input value={won} onChange={(e) => setWon(e.target.value)} />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">Lost reads</span>
          <Input value={lost} onChange={(e) => setLost(e.target.value)} />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={pipeline.hasAmount}
            onCheckedChange={(v) => run(updatePipelineAction(orgId, pipeline.id, { hasAmount: v }), "Saved.")}
          />
          Has an amount
        </label>
        <Button
          size="sm"
          variant="outline"
          onClick={() => run(updatePipelineAction(orgId, pipeline.id, { name, itemNoun: noun, wonLabel: won, lostLabel: lost }), "Saved.")}
        >
          Save names
        </Button>
        <span className="text-muted-foreground text-xs">{pipeline.items} items</span>
        <Button
          size="sm"
          variant="ghost"
          className="text-destructive ms-auto"
          onClick={() => run(archivePipelineAction(orgId, pipeline.id), `${pipeline.name} is archived. Its items are kept.`)}
        >
          Archive
        </Button>
      </div>
      <div className="space-y-2">
        <b className="text-sm">Stages</b>
        {stages.map((s, i) => (
          <div key={s.id ?? `new-${i}`} className="bg-muted/40 space-y-2 rounded-xl p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Input value={s.name} onChange={(e) => set(i, { name: e.target.value })} aria-label="Stage name" className="w-44" />
              {(["OPEN", "WON", "LOST"] as const).map((k) => (
                <button key={k} type="button" aria-pressed={s.kind === k} onClick={() => set(i, { kind: k })} className={cn(chipClass(s.kind === k), "h-8 px-3 text-[13px]")}>
                  {k === "OPEN" ? "Open" : k === "WON" ? won || "Won" : lost || "Lost"}
                </button>
              ))}
              <label className="flex items-center gap-1.5 text-xs">
                Stuck after
                <Input
                  type="number"
                  min={1}
                  value={s.stuckAfterDays ?? ""}
                  onChange={(e) => set(i, { stuckAfterDays: e.target.value ? Number(e.target.value) : null })}
                  className="h-8 w-16"
                  aria-label="Stuck after days"
                />
                days
              </label>
              <span className="ms-auto flex gap-1">
                <Button size="icon-sm" variant="ghost" aria-label="Move up" onClick={() => move(i, -1)}>
                  <ArrowUp className="size-3.5" aria-hidden="true" />
                </Button>
                <Button size="icon-sm" variant="ghost" aria-label="Move down" onClick={() => move(i, 1)}>
                  <ArrowDown className="size-3.5" aria-hidden="true" />
                </Button>
                <Button size="icon-sm" variant="ghost" aria-label={`Remove ${s.name}`} onClick={() => setStages((cur) => cur.filter((_, j) => j !== i))}>
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </Button>
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-muted-foreground">Needs</span>
              {requirable.map((r) => {
                const on = s.requiredFields.includes(r.key);
                return (
                  <button
                    key={r.key}
                    type="button"
                    aria-pressed={on}
                    onClick={() => set(i, { requiredFields: on ? s.requiredFields.filter((k) => k !== r.key) : [...s.requiredFields, r.key] })}
                    className={cn("h-7 rounded-full border px-2.5", on ? "bg-primary text-primary-foreground border-transparent" : "border-input hover:bg-muted")}
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setStages((cur) => [...cur, { name: "New stage", kind: "OPEN", probability: null, stuckAfterDays: 14, requiredFields: [] }])}
          >
            <Plus className="size-3.5" aria-hidden="true" />
            Add a stage
          </Button>
          <Button size="sm" onClick={() => run(saveStagesAction(orgId, pipeline.id, stages), "Stages saved.")}>
            Save stages
          </Button>
        </div>
      </div>
    </div>
  );
}

function NewPipeline({ orgId, templates }: { orgId: string; templates: SetupKind[] }) {
  const run = useRun();
  const [name, setName] = useState("");
  const [noun, setNoun] = useState("");
  return (
    <div className="space-y-3">
      {templates.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <span className="text-muted-foreground self-center text-sm">Ready-made:</span>
          {templates.map((t) => (
            <Button
              key={t}
              size="sm"
              variant="outline"
              onClick={() =>
                run(
                  createPipelineAction(orgId, {
                    name: PIPELINE_TEMPLATES[t]?.name ?? SETUP_KIND_INFO[t].label,
                    itemNoun: PIPELINE_TEMPLATES[t]?.itemNoun ?? "item",
                    template: t,
                  }),
                  "Pipeline added.",
                )
              }
            >
              {SETUP_KIND_INFO[t].label}
            </Button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">New pipeline</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Mentors" className="w-48" />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">One item is a</span>
          <Input value={noun} onChange={(e) => setNoun(e.target.value)} placeholder="mentor" className="w-40" />
        </label>
        <Button
          disabled={!name.trim()}
          onClick={async () => {
            if (await run(createPipelineAction(orgId, { name, itemNoun: noun || "item" }), "Pipeline added.")) {
              setName("");
              setNoun("");
            }
          }}
        >
          Add
        </Button>
      </div>
    </div>
  );
}

function FieldsEditor({ orgId, group }: { orgId: string; group: FieldGroup }) {
  const run = useRun();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<FieldType>("TEXT");
  const [options, setOptions] = useState<FieldOptions>({});
  const [choices, setChoices] = useState("");
  const required = new Set(group.required);
  return (
    <div className="space-y-4">
      {group.fields.length === 0 ? (
        <p className="text-muted-foreground text-sm">No fields of your own yet.</p>
      ) : (
        <ul className="divide-border divide-y">
          {group.fields.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-2 py-2">
              <Input
                defaultValue={f.name}
                aria-label="Field name"
                className="w-56"
                onBlur={(e) => e.target.value.trim() && e.target.value !== f.name && run(updateFieldAction(orgId, f.id, { name: e.target.value }), "Renamed.")}
              />
              <Badge variant="secondary">{FIELD_TYPE_META[f.type].label}</Badge>
              {group.databaseId && group.object !== "deal" && (
                <label className="flex items-center gap-1.5 text-xs">
                  <Switch checked={required.has(f.id)} onCheckedChange={(v) => run(setRequiredAction(orgId, group.databaseId!, f.id, v))} />
                  Required
                </label>
              )}
              <Button
                size="icon-sm"
                variant="ghost"
                className="ms-auto"
                aria-label={`Delete ${f.name}`}
                onClick={() => run(deleteFieldAction(orgId, f.id), `${f.name} is deleted. Its old values stay in each record's history.`)}
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {group.databaseId && group.object !== "deal" && group.builtins.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">Required everywhere:</span>
          {group.builtins.map((b) => {
            const on = required.has(b.key);
            return (
              <button
                key={b.key}
                type="button"
                aria-pressed={on}
                onClick={() => run(setRequiredAction(orgId, group.databaseId!, b.key, !on))}
                className={cn("h-7 rounded-full border px-2.5", on ? "bg-primary text-primary-foreground border-transparent" : "border-input hover:bg-muted")}
              >
                {b.label}
              </button>
            );
          })}
        </div>
      )}
      {adding ? (
        <div className="bg-muted/40 space-y-3 rounded-2xl p-4">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Field name" aria-label="Field name" className="max-w-72" autoFocus />
          <div className="flex flex-wrap gap-1.5">
            {FIELD_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={type === t}
                title={FIELD_TYPE_META[t].hint}
                onClick={() => {
                  setType(t);
                  setOptions(startingOptions(t));
                }}
                className={cn(chipClass(type === t), "h-8 px-3 text-[13px]")}
              >
                {FIELD_TYPE_META[t].label}
              </button>
            ))}
          </div>
          {(type === "SELECT" || type === "MULTI_SELECT") && (
            <Input value={choices} onChange={(e) => setChoices(e.target.value)} placeholder="Choices, separated by commas" aria-label="Choices" />
          )}
          {needsOptions(type) && <FieldOptionsEditor type={type} options={options} onChange={setOptions} idPrefix={`crm-${group.key}`} />}
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={!name.trim() || (needsOptions(type) && !optionsReady(type, options))}
              onClick={async () => {
                const opts =
                  type === "SELECT" || type === "MULTI_SELECT" ? { ...options, choices: choicesFromText(choices, []) } : options;
                const ok = await run(
                  addFieldAction(orgId, { object: group.object, pipelineId: group.pipelineId }, { name, type, options: opts }),
                  "Field added.",
                );
                if (ok) {
                  setAdding(false);
                  setName("");
                  setChoices("");
                }
              }}
            >
              Add field
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
          <Plus className="size-3.5" aria-hidden="true" />
          Add a field
        </Button>
      )}
    </div>
  );
}
