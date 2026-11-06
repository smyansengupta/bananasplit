"use client";

import { useEffect, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  AI_AUTO,
  AI_AUTO_LABELS,
  AI_FILL_PENDING,
  AI_OUTPUT_LABELS,
  AI_OUTPUTS,
  choiceId,
  CHOICE_COLORS,
  LIMITS,
  RELATION_KIND_LABELS,
  RELATION_KINDS,
  type Choice,
  type FieldDef,
  type FieldOptions,
  type FieldType,
} from "@/lib/databases/fields";
import { cn } from "@/lib/utils";

import { useRelationContext } from "./relation-cell";

/**
 * The settings of the two field types that need more than a name: what a
 * RELATION field links to (People, Companies, Deals, or the rows
 * of one database) and whether it holds one link; what an AI field asks,
 * what it writes, and whether it searches the web first.
 */

/** Types that need more than a name. */
export function needsOptions(type: FieldType): boolean {
  return type === "RELATION" || type === "AI";
}

/** Whether a field's options are complete enough to save. */
export function optionsReady(type: FieldType, options: FieldOptions): boolean {
  if (type === "RELATION") {
    const t = options.target;
    return Boolean(t && (t.kind !== "record" || t.databaseId));
  }
  if (type === "AI") {
    return (
      Boolean(options.prompt?.trim()) &&
      (options.output !== "SELECT" || (options.choices ?? []).length > 0)
    );
  }
  return true;
}

/** The options a new field of `type` starts with. */
export function startingOptions(type: FieldType): FieldOptions {
  if (type === "SELECT" || type === "MULTI_SELECT") return { choices: [] };
  if (type === "RELATION") return { target: { kind: "person" } };
  if (type === "AI") return { prompt: "", output: "TEXT" };
  return {};
}

const optionButton = (on: boolean) =>
  cn(
    "rounded-field flex min-h-9 items-center gap-2 px-2.5 py-1.5 text-left text-[13px] transition-colors",
    on ? "bg-primary text-primary-foreground font-semibold" : "bg-muted/60 hover:bg-muted",
  );

/** Every database a relation can name, loaded once the picker needs them. */
type DatabaseOption = { id: string; name: string; kind: "record" | "deal" };

function useRelationDatabases(enabled: boolean): DatabaseOption[] | null {
  const ctx = useRelationContext();
  const [list, setList] = useState<DatabaseOption[] | null>(null);
  const load = ctx?.databases;
  useEffect(() => {
    if (!enabled || !load || list) return;
    let live = true;
    void load()
      .catch(() => [])
      .then((found) => {
        if (live) setList(found);
      });
    return () => {
      live = false;
    };
  }, [enabled, load, list]);
  return list;
}

/** Choices typed as one line ("Yes, Maybe, No"), keeping the ids of the ones that stay. */
export function choicesFromText(text: string, before: readonly Choice[]): Choice[] {
  const seen = new Set<string>();
  return text
    .split(",")
    .map((s) => s.trim().slice(0, 80))
    .filter((s) => {
      const k = s.toLowerCase();
      if (!s || seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, LIMITS.choicesPerField)
    .map(
      (label, i) =>
        before.find((c) => c.label.toLowerCase() === label.toLowerCase()) ?? {
          id: choiceId(),
          label,
          color: CHOICE_COLORS[(i + 1) % CHOICE_COLORS.length]!,
        },
    );
}

export function FieldOptionsEditor({
  type,
  options,
  onChange,
  idPrefix = "field",
}: {
  type: FieldType;
  options: FieldOptions;
  onChange: (options: FieldOptions) => void;
  idPrefix?: string;
}) {
  const databases = useRelationDatabases(type === "RELATION");
  const [choiceText, setChoiceText] = useState(() =>
    (options.choices ?? []).map((c) => c.label).join(", "),
  );

  if (type === "RELATION") {
    const target = options.target ?? { kind: "person" as const };
    const listed = (databases ?? []).filter((d) => d.kind === target.kind);
    return (
      <div className="space-y-3">
        <div className="space-y-1.5">
          <p className="text-sm font-medium" id={`${idPrefix}-links`}>
            Links to
          </p>
          <div
            role="radiogroup"
            aria-labelledby={`${idPrefix}-links`}
            className="grid grid-cols-2 gap-1"
          >
            {RELATION_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={target.kind === k}
                onClick={() => onChange({ ...options, target: { kind: k } })}
                className={optionButton(target.kind === k)}
              >
                {RELATION_KIND_LABELS[k]}
              </button>
            ))}
          </div>
        </div>
        {(target.kind === "deal" || target.kind === "record") && (
          <div className="space-y-1.5">
            <p className="text-sm font-medium" id={`${idPrefix}-db`}>
              {target.kind === "deal" ? "Which pipeline" : "Which database"}
            </p>
            {databases === null ? (
              <p className="text-muted-foreground text-xs">Loading</p>
            ) : (
              <div
                role="radiogroup"
                aria-labelledby={`${idPrefix}-db`}
                className="grid max-h-40 gap-1 overflow-y-auto"
              >
                {target.kind === "deal" && (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={!target.databaseId}
                    onClick={() => onChange({ ...options, target: { kind: "deal" } })}
                    className={optionButton(!target.databaseId)}
                  >
                    Any pipeline
                  </button>
                )}
                {listed.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    role="radio"
                    aria-checked={target.databaseId === d.id}
                    onClick={() =>
                      onChange({ ...options, target: { kind: target.kind, databaseId: d.id } })
                    }
                    className={optionButton(target.databaseId === d.id)}
                  >
                    <span className="truncate">{d.name}</span>
                  </button>
                ))}
                {listed.length === 0 && target.kind === "record" && (
                  <p className="text-muted-foreground text-xs">No databases yet.</p>
                )}
              </div>
            )}
          </div>
        )}
        <label className="flex items-center justify-between gap-3 text-sm">
          One link only
          <Switch
            checked={options.single === true}
            onCheckedChange={(v) => onChange({ ...options, single: v === true ? true : undefined })}
          />
        </label>
      </div>
    );
  }

  if (type === "AI") {
    const output = options.output ?? "TEXT";
    return (
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-prompt`}>What to ask about each row</Label>
          <Textarea
            id={`${idPrefix}-prompt`}
            value={options.prompt ?? ""}
            maxLength={2000}
            rows={3}
            placeholder="e.g. Their mission in one line"
            onChange={(e) => onChange({ ...options, prompt: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <p className="text-sm font-medium" id={`${idPrefix}-output`}>
            It writes
          </p>
          <div
            role="radiogroup"
            aria-labelledby={`${idPrefix}-output`}
            className="grid grid-cols-2 gap-1"
          >
            {AI_OUTPUTS.map((o) => (
              <button
                key={o}
                type="button"
                role="radio"
                aria-checked={output === o}
                onClick={() =>
                  onChange({
                    ...options,
                    output: o,
                    choices: o === "SELECT" ? (options.choices ?? []) : undefined,
                  })
                }
                className={optionButton(output === o)}
              >
                {AI_OUTPUT_LABELS[o]}
              </button>
            ))}
          </div>
        </div>
        {output === "SELECT" && (
          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-choices`}>Choices, with commas between</Label>
            <Input
              id={`${idPrefix}-choices`}
              value={choiceText}
              placeholder="Yes, Maybe, No"
              onChange={(e) => {
                setChoiceText(e.target.value);
                onChange({
                  ...options,
                  choices: choicesFromText(e.target.value, options.choices ?? []),
                });
              }}
            />
          </div>
        )}
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>
            Search the web first
            <span className="text-muted-foreground block text-xs">
              On your organization&apos;s own Tavily key
            </span>
          </span>
          <Switch
            checked={options.research === true}
            onCheckedChange={(v) =>
              onChange({ ...options, research: v === true ? true : undefined })
            }
          />
        </label>
        <div className="space-y-1.5">
          <p id={`${idPrefix}-auto`} className="text-sm font-medium">
            When it fills itself
          </p>
          <div role="radiogroup" aria-labelledby={`${idPrefix}-auto`} className="grid grid-cols-2 gap-1">
            {AI_AUTO.map((a) => (
              <button
                key={a}
                type="button"
                role="radio"
                aria-checked={(options.auto ?? "off") === a}
                onClick={() => onChange({ ...options, auto: a === "off" ? undefined : a })}
                className={optionButton((options.auto ?? "off") === a)}
              >
                {AI_AUTO_LABELS[a]}
              </button>
            ))}
          </div>
        </div>
        <p className="text-muted-foreground text-xs">{AI_FILL_PENDING}</p>
      </div>
    );
  }
  return null;
}

/**
 * A relation's or AI field's settings: for turning a field into one (its
 * values are converted after), or changing what it links to or asks.
 */
export function FieldSettingsDialog({
  field,
  type,
  onClose,
  onSave,
}: {
  field: FieldDef;
  /** The type being set up: the field's own, or the one it is changing to. */
  type: FieldType;
  onClose: () => void;
  onSave: (options: FieldOptions) => Promise<boolean>;
}) {
  const [options, setOptions] = useState<FieldOptions>(() =>
    field.type === type ? field.options : startingOptions(type),
  );
  const [pending, start] = useTransition();
  const changing = field.type !== type;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {changing
              ? `Make “${field.name}” ${type === "AI" ? "an AI field" : "a relation"}`
              : `Settings for “${field.name}”`}
          </DialogTitle>
          <DialogDescription>
            {changing
              ? type === "RELATION"
                ? "Its values can't become links, so they're cleared."
                : "Values that fit what it writes are kept; the rest are cleared."
              : type === "RELATION"
                ? "Links that no longer fit are cleared."
                : "What it asks and what it writes."}
          </DialogDescription>
        </DialogHeader>
        <FieldOptionsEditor
          type={type}
          options={options}
          onChange={setOptions}
          idPrefix="field-settings"
        />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={pending || !optionsReady(type, options)}
            onClick={() =>
              start(async () => {
                if (await onSave(options)) onClose();
              })
            }
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
