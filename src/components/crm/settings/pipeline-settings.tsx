"use client";

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useRef, useState } from "react";

import {
  addFieldAction,
  archivePipelineAction,
  createPipelineAction,
  saveStagesAction,
  updateFieldAction,
  updatePipelineAction,
} from "@/app/app/[orgSlug]/crm/actions";
import { SettingsCard, SettingsStatus } from "@/app/app/[orgSlug]/settings/settings-card";
import { choicesFromText } from "@/components/databases/custom/field-options";
import { GripVertical, Plus, X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { chipClass } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { PIPELINE_TEMPLATES, SETUP_KIND_INFO, type SetupKind } from "@/lib/crm/templates";
import { CHOICE_COLOR_CLASS, type Choice, type ChoiceColor } from "@/lib/databases/fields";
import { cn } from "@/lib/utils";

import { useSave } from "./use-save";

/**
 * CRM settings > Deal stages and types, for one pipeline: the stages (drag
 * to reorder, won and lost always last), the deal types (a Type choice on
 * the pipeline, so reports split by it), the pipeline's names, and a new
 * pipeline. Each card has its one Save.
 */

export interface StageRow {
  id?: string;
  name: string;
  kind: "OPEN" | "WON" | "LOST";
  probability: number | null;
  stuckAfterDays: number | null;
  requiredFields: string[];
  /** Deals in it now. */
  deals?: number;
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
  /** Its own fields, for "Needs" on a stage. */
  fields: { id: string; name: string }[];
  items: number;
}

/** The pipeline's Type field (a single choice named Type), with how many deals have each. */
export interface DealTypes {
  fieldId: string | null;
  choices: Choice[];
  counts: Record<string, number>;
  /** The field's other options, kept as they are when the choices change. */
  options: Record<string, unknown>;
}

const plural = (n: number, one: string, many: string) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

function SortableStage({
  id,
  stage,
  noun,
  nounPlural,
  requirable,
  onChange,
  onRemove,
}: {
  id: string;
  stage: StageRow;
  noun: string;
  nounPlural: string;
  /** What a stage can need before a deal enters it. */
  requirable: { key: string; label: string }[];
  onChange: (patch: Partial<StageRow>) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const [more, setMore] = useState(false);
  const deals = stage.deals ?? 0;
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "border-border bg-card rounded-[1.5rem] border",
        isDragging && "relative z-10 shadow-md",
      )}
    >
      <div className="flex h-12 items-center gap-2 ps-1.5 pe-2">
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground grid size-8 shrink-0 cursor-grab place-items-center rounded-full"
          aria-label={`Drag to reorder ${stage.name}`}
          title="Drag to reorder"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" aria-hidden="true" />
        </button>
        <input
          value={stage.name}
          onChange={(e) => onChange({ name: e.target.value })}
          aria-label="Stage name"
          className="min-w-0 flex-1 bg-transparent text-[15px] font-semibold outline-none"
        />
        <button
          type="button"
          aria-expanded={more}
          onClick={() => setMore((v) => !v)}
          className="text-muted-foreground hover:text-foreground shrink-0 text-sm"
          title="When it's stuck, and what it needs"
        >
          {plural(deals, noun, nounPlural)}
        </button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Remove ${stage.name}`}
          disabled={deals > 0}
          title={deals > 0 ? "Move its deals first" : undefined}
          onClick={onRemove}
        >
          <X className="size-3.5" aria-hidden="true" />
        </Button>
      </div>
      {more && (
        <div className="border-border space-y-2.5 border-t px-5 py-3 text-sm">
          <label className="flex flex-wrap items-center gap-2">
            Stuck after
            <Input
              type="number"
              min={1}
              value={stage.stuckAfterDays ?? ""}
              onChange={(e) =>
                onChange({ stuckAfterDays: e.target.value ? Number(e.target.value) : null })
              }
              className="h-8 w-20"
              aria-label="Stuck after days"
            />
            quiet days
          </label>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-muted-foreground me-1">Needs</span>
            {requirable.map((r) => {
              const on = stage.requiredFields.includes(r.key);
              return (
                <button
                  key={r.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    onChange({
                      requiredFields: on
                        ? stage.requiredFields.filter((k) => k !== r.key)
                        : [...stage.requiredFields, r.key],
                    })
                  }
                  className={cn(chipClass(on), "h-7 px-2.5 text-xs")}
                >
                  {r.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </li>
  );
}

export function StagesCard({ orgId, pipeline }: { orgId: string; pipeline: PipelineRow }) {
  const [stages, setStages] = useState<(StageRow & { key: string })[]>(() =>
    pipeline.stages.map((s, i) => ({ ...s, key: s.id ?? `s${i}` })),
  );
  const [adding, setAdding] = useState("");
  const seq = useRef(0);
  const { pending, status, save } = useSave();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const open = stages.filter((s) => s.kind === "OPEN");
  const closing = stages.filter((s) => s.kind !== "OPEN");
  const setOpen = (next: typeof open) => setStages([...next, ...closing]);
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = open.findIndex((s) => s.key === e.active.id);
    const to = open.findIndex((s) => s.key === e.over!.id);
    if (from < 0 || to < 0) return;
    setOpen(arrayMove(open, from, to));
  };
  const add = () => {
    const name = adding.trim();
    if (!name) return;
    setOpen([
      ...open,
      {
        key: `new-${(seq.current += 1)}`,
        name,
        kind: "OPEN",
        probability: null,
        stuckAfterDays: 14,
        requiredFields: [],
        deals: 0,
      },
    ]);
    setAdding("");
  };
  const requirable = [
    { key: "amount", label: "Amount" },
    { key: "closeReason", label: "Reason" },
    { key: "nextStep", label: "Next step" },
    { key: "expectedOn", label: "Expected" },
    { key: "company", label: "Company" },
    { key: "person", label: "Person" },
    ...pipeline.fields.map((f) => ({ key: f.id, label: f.name })),
  ];
  const noun = pipeline.itemNoun || "deal";
  const nounPlural = pipeline.itemNounPlural || `${noun}s`;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save(() =>
          saveStagesAction(
            orgId,
            pipeline.id,
            stages.map(({ key: _key, deals: _deals, ...s }) => s),
          ),
        );
      }}
    >
      <SettingsCard
        title="Stages"
        description={`Drag to reorder. ${pipeline.wonLabel || "Won"} and ${pipeline.lostLabel || "Lost"} always come last.`}
        status={<SettingsStatus status={status} />}
        footer={
          <Button type="submit" disabled={pending}>
            Save
          </Button>
        }
      >
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={open.map((s) => s.key)} strategy={verticalListSortingStrategy}>
            <ul className="space-y-2">
              {open.map((s) => (
                <SortableStage
                  key={s.key}
                  id={s.key}
                  stage={s}
                  noun={noun}
                  nounPlural={nounPlural}
                  requirable={requirable}
                  onChange={(patch) =>
                    setStages((cur) => cur.map((x) => (x.key === s.key ? { ...x, ...patch } : x)))
                  }
                  onRemove={() => setStages((cur) => cur.filter((x) => x.key !== s.key))}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
        <ul className="space-y-2">
          {closing.map((s) => (
            <li
              key={s.key}
              className={cn(
                "flex h-12 items-center gap-3 rounded-full px-5 text-[15px]",
                s.kind === "WON"
                  ? "bg-tint-success text-tint-success-foreground"
                  : "bg-tint-danger text-tint-danger-foreground",
              )}
            >
              <b className="flex-1">{s.name}</b>
              <span className="text-sm">
                {s.kind === "WON"
                  ? pipeline.hasAmount
                    ? "Sends to Finance"
                    : plural(s.deals ?? 0, noun, nounPlural)
                  : "Asks why, in one tap"}
              </span>
            </li>
          ))}
        </ul>
        <label className="border-input flex h-11 items-center gap-2.5 rounded-full border border-dashed px-4">
          <Plus className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
          <input
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            onBlur={add}
            placeholder="Add a stage"
            aria-label="Add a stage"
            className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-[15px] outline-none"
          />
        </label>
      </SettingsCard>
    </form>
  );
}

export function TypesCard({
  orgId,
  pipelineId,
  types,
}: {
  orgId: string;
  pipelineId: string;
  types: DealTypes;
}) {
  const [choices, setChoices] = useState<Choice[]>(types.choices);
  const [adding, setAdding] = useState("");
  const { pending, status, save } = useSave();
  const add = () => {
    const label = adding.trim();
    if (!label) return;
    setChoices((cur) => choicesFromText([...cur.map((c) => c.label), label].join(","), cur));
    setAdding("");
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const options = { ...types.options, choices };
        save(() =>
          types.fieldId
            ? updateFieldAction(orgId, types.fieldId, { options })
            : addFieldAction(
                orgId,
                { object: "deal", pipelineId },
                { name: "Type", type: "SELECT", options },
              ),
        );
      }}
    >
      <SettingsCard
        title="Types"
        description="Pick one when you make a deal. Reports can split by type."
        status={<SettingsStatus status={status} />}
        footer={
          <Button type="submit" disabled={pending || (!types.fieldId && choices.length === 0)}>
            Save
          </Button>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          {choices.map((c) => (
            <span
              key={c.id}
              className={cn(
                "inline-flex h-9 items-center gap-2 rounded-full ps-4 pe-1.5 text-sm font-semibold",
                CHOICE_COLOR_CLASS[c.color as ChoiceColor] ?? CHOICE_COLOR_CLASS.gray,
              )}
            >
              {c.label}
              <span className="font-medium opacity-70">{types.counts[c.id] ?? 0}</span>
              <button
                type="button"
                aria-label={`Remove ${c.label}`}
                className="hover:bg-foreground/10 grid size-6 place-items-center rounded-full"
                onClick={() => setChoices((cur) => cur.filter((x) => x.id !== c.id))}
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </span>
          ))}
          <input
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            onBlur={add}
            placeholder="Add a type"
            aria-label="Add a type"
            className="border-input placeholder:text-muted-foreground h-9 w-44 rounded-full border border-dashed bg-transparent px-4 text-sm outline-none"
          />
        </div>
      </SettingsCard>
    </form>
  );
}

export function PipelineCard({ orgId, pipeline }: { orgId: string; pipeline: PipelineRow }) {
  const [name, setName] = useState(pipeline.name);
  const [noun, setNoun] = useState(pipeline.itemNoun);
  const [won, setWon] = useState(pipeline.wonLabel);
  const [lost, setLost] = useState(pipeline.lostLabel);
  const [hasAmount, setHasAmount] = useState(pipeline.hasAmount);
  const { pending, status, save } = useSave();
  const field = (id: string, label: string, value: string, set: (v: string) => void) => (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} onChange={(e) => set(e.target.value)} />
    </div>
  );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save(() =>
          updatePipelineAction(orgId, pipeline.id, {
            name,
            itemNoun: noun,
            wonLabel: won,
            lostLabel: lost,
            hasAmount,
          }),
        );
      }}
    >
      <SettingsCard
        title="This pipeline"
        description={`What it's called and what one ${pipeline.itemNoun || "deal"} is. ${plural(pipeline.items, "deal", "deals")} in it.`}
        status={<SettingsStatus status={status} />}
        footer={
          <>
            <Button
              type="button"
              variant="ghost"
              className="text-destructive"
              disabled={pending}
              onClick={() =>
                save(
                  () => archivePipelineAction(orgId, pipeline.id),
                  `${pipeline.name} is archived. Its deals are kept.`,
                )
              }
            >
              Archive
            </Button>
            <Button type="submit" disabled={pending}>
              Save
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {field(`p-name-${pipeline.id}`, "Name", name, setName)}
          {field(`p-noun-${pipeline.id}`, "One is a", noun, setNoun)}
          {field(`p-won-${pipeline.id}`, "Won reads", won, setWon)}
          {field(`p-lost-${pipeline.id}`, "Lost reads", lost, setLost)}
        </div>
        <label className="flex items-center gap-2.5 text-sm">
          <Switch checked={hasAmount} onCheckedChange={setHasAmount} />
          Deals have an amount
        </label>
      </SettingsCard>
    </form>
  );
}

export function NewPipelineCard({ orgId, templates }: { orgId: string; templates: SetupKind[] }) {
  const [name, setName] = useState("");
  const [noun, setNoun] = useState("");
  const { pending, status, save } = useSave();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        save(
          () => createPipelineAction(orgId, { name, itemNoun: noun || "deal" }),
          "Pipeline added.",
        );
        setName("");
        setNoun("");
      }}
    >
      <SettingsCard
        title="Another pipeline"
        description="For a different kind of deal, with its own stages."
        status={<SettingsStatus status={status} />}
        footer={
          <Button type="submit" disabled={pending || !name.trim()}>
            Add
          </Button>
        }
      >
        {templates.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-muted-foreground me-1 text-sm">Ready-made</span>
            {templates.map((t) => (
              <Button
                key={t}
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  save(
                    () =>
                      createPipelineAction(orgId, {
                        name: PIPELINE_TEMPLATES[t]?.name ?? SETUP_KIND_INFO[t].label,
                        itemNoun: PIPELINE_TEMPLATES[t]?.itemNoun ?? "deal",
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
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="new-pipeline-name">Name</Label>
            <Input
              id="new-pipeline-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Grants"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="new-pipeline-noun">One is a</Label>
            <Input
              id="new-pipeline-noun"
              value={noun}
              onChange={(e) => setNoun(e.target.value)}
              placeholder="grant"
            />
          </div>
        </div>
      </SettingsCard>
    </form>
  );
}
