"use client";

import { Plus, Trash2 } from "@/components/icons";
import { useState, useTransition, type CSSProperties } from "react";

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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  choiceId,
  CHOICE_COLORS,
  FIELD_TYPE_META,
  FIELD_TYPES,
  LIMITS,
  type Choice,
  type FieldDef,
  type FieldType,
} from "@/lib/databases/fields";
import { cn } from "@/lib/utils";

import { choiceColor } from "../styles";
import { FieldIcon } from "./field-icon";

/** The "+" at the end of the header row: a name and a type. */
export function NewFieldPopover({
  onAdd,
}: {
  onAdd: (name: string, type: FieldType) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<FieldType>("TEXT");
  const [pending, start] = useTransition();

  function submit() {
    if (!name.trim()) return;
    start(async () => {
      if (await onAdd(name.trim(), type)) {
        setName("");
        setType("TEXT");
        setOpen(false);
      }
    });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Add a field"
          title="Add a field"
          className="text-muted-foreground hover:bg-muted-strong hover:text-foreground data-[state=open]:bg-muted-strong mx-auto grid size-8 place-items-center rounded-full transition-colors"
        >
          <Plus className="size-4" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3 p-4">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="new-field-name">Field name</Label>
            <Input
              id="new-field-name"
              autoFocus
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Shirt size"
            />
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-medium" id="new-field-type">
              Type
            </p>
            <div
              role="radiogroup"
              aria-labelledby="new-field-type"
              className="grid grid-cols-2 gap-1"
            >
              {FIELD_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={type === t}
                  title={FIELD_TYPE_META[t].hint}
                  onClick={() => setType(t)}
                  className={cn(
                    "rounded-field flex h-9 items-center gap-2 px-2.5 text-left text-[13px] transition-colors",
                    type === t
                      ? "bg-primary text-primary-foreground font-semibold"
                      : "hover:bg-muted",
                  )}
                >
                  <FieldIcon type={t} className={cn(type === t && "text-current")} />
                  {FIELD_TYPE_META[t].label}
                </button>
              ))}
            </div>
          </div>
          <Button type="submit" className="w-full" disabled={!name.trim() || pending}>
            {pending ? "Adding…" : "Add field"}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

export function FieldNameDialog({
  field,
  onClose,
  onSave,
}: {
  field: FieldDef;
  onClose: () => void;
  onSave: (name: string) => Promise<boolean>;
}) {
  const [name, setName] = useState(field.name);
  const [pending, start] = useTransition();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Rename field</DialogTitle>
          <DialogDescription>The data stays put; only the name changes.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              if (await onSave(name)) onClose();
            });
          }}
        >
          <Input
            autoFocus
            aria-label="Field name"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || pending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A select field's choices: rename, recolour, add, remove (removing one clears it from rows). */
export function ChoicesDialog({
  field,
  onClose,
  onSave,
}: {
  field: FieldDef;
  onClose: () => void;
  onSave: (choices: Choice[]) => Promise<boolean>;
}) {
  const [choices, setChoices] = useState<Choice[]>(field.options.choices ?? []);
  const [pending, start] = useTransition();
  const removed = (field.options.choices ?? []).filter(
    (c) => !choices.some((n) => n.id === c.id),
  ).length;

  function update(i: number, patch: Partial<Choice>) {
    setChoices((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Choices for “{field.name}”</DialogTitle>
          <DialogDescription>Renaming a choice updates every row that has it.</DialogDescription>
        </DialogHeader>
        <ul className="max-h-[50vh] space-y-2 overflow-y-auto">
          {choices.map((c, i) => (
            <li key={c.id} className="flex items-center gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label={`Colour of ${c.label}`}
                    style={{ "--tag": choiceColor(c.color) } as CSSProperties}
                    className="border-input hover:bg-muted grid size-10 shrink-0 place-items-center rounded-full border transition-colors"
                  >
                    <span aria-hidden="true" className="size-4 rounded-full bg-(--tag)" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="grid w-auto grid-cols-5 gap-1.5 p-3">
                  {CHOICE_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      aria-label={color}
                      aria-pressed={c.color === color}
                      onClick={() => update(i, { color })}
                      style={{ "--tag": choiceColor(color) } as CSSProperties}
                      className={cn(
                        "ring-offset-popover size-7 rounded-full bg-(--tag) transition-transform hover:scale-110",
                        c.color === color && "ring-foreground ring-2 ring-offset-2",
                      )}
                    />
                  ))}
                </PopoverContent>
              </Popover>
              <Input
                aria-label="Choice name"
                value={c.label}
                maxLength={80}
                onChange={(e) => update(i, { label: e.target.value })}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${c.label}`}
                onClick={() => setChoices((cs) => cs.filter((_, j) => j !== i))}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={choices.length >= LIMITS.choicesPerField}
          onClick={() =>
            setChoices((cs) => [
              ...cs,
              {
                id: choiceId(),
                label: `Option ${cs.length + 1}`,
                color: CHOICE_COLORS[(cs.length + 1) % CHOICE_COLORS.length]!,
              },
            ])
          }
        >
          <Plus aria-hidden="true" />
          Add a choice
        </Button>
        {removed > 0 && (
          <p className="text-muted-foreground text-xs">
            Removing {removed === 1 ? "a choice" : `${removed} choices`} clears it from any row that
            has it.
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={pending || choices.some((c) => !c.label.trim())}
            onClick={() =>
              start(async () => {
                if (await onSave(choices.map((c) => ({ ...c, label: c.label.trim() })))) onClose();
              })
            }
          >
            Save choices
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
