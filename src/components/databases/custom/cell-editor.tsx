"use client";

import { Check, ExternalLink, Plus, X } from "@/components/icons";
import { useEffect, useRef, useState } from "react";

import { TagChip } from "@/components/ui/chip";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { parseCell, type Choice, type FieldDef, type StoredValue } from "@/lib/databases/fields";
import { formatPhone } from "@/lib/rsvp/format";
import { cn } from "@/lib/utils";

import { choiceColor } from "../styles";

/**
 * One cell of a club-made database, editable in place. Every editor saves
 * itself: text as you pause typing (and when you leave the cell), the rest
 * the moment you pick. `onSave` gets the stored shape; the grid updates the
 * row at once and sends the change (src/server/databases/custom.ts).
 */

export interface Member {
  id: string;
  name: string;
}

export interface CellProps {
  field: FieldDef;
  value: unknown;
  members: readonly Member[];
  canEdit: boolean;
  /** Owners and admins: may add a choice from the cell. */
  canManage: boolean;
  onSave: (value: StoredValue | null) => void;
  onAddChoice?: (label: string) => Promise<Choice | null>;
  /** Labels the input for screen readers: "Shirt size for Maya Patel". */
  label: string;
}

const SAVE_AFTER_MS = 600;

/**
 * A cell's editor: no box of its own (the grid has no cell lines), a soft
 * tile on hover and the glow ring while you type in it. 40px, so a row with
 * its 4px inset is the table's 48.
 */
const base =
  "h-10 w-full min-w-0 rounded-field bg-transparent px-2.5 text-sm outline-none transition-[background-color,box-shadow] hover:bg-muted/60 focus:bg-card focus:shadow-[0_0_0_2px_color-mix(in_oklab,var(--glow)_60%,transparent)]";

/** A field option ("Checked out", "M") as a chip in the option's own colour. */
export function ChoicePill({ choice }: { choice: Choice }) {
  return <TagChip color={choiceColor(choice.color)}>{choice.label}</TagChip>;
}

/** The small input inside a cell's menu (find someone, add a choice). */
const menuInput =
  "border-input bg-card rounded-field h-8 min-w-0 border px-2.5 text-sm outline-none focus-visible:border-foreground focus-visible:shadow-[0_0_0_3px_color-mix(in_oklab,var(--glow)_45%,transparent)]";

/** One option row in a cell's menu. */
const menuOption =
  "hover:bg-muted rounded-field flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left";

/** A value as the grid shows it when not editing. */
export function formatValue(field: FieldDef, value: unknown, members: readonly Member[]): string {
  if (value === null || value === undefined) return "";
  switch (field.type) {
    case "CURRENCY":
      return typeof value === "number"
        ? value.toLocaleString("en-US", { style: "currency", currency: "USD" })
        : "";
    case "NUMBER":
      return typeof value === "number"
        ? value.toLocaleString("en-US", { maximumFractionDigits: field.options.decimals ?? 4 })
        : "";
    case "PHONE":
      return typeof value === "string" ? formatPhone(value) : "";
    case "DATE": {
      if (typeof value !== "string") return "";
      const d = new Date(`${value}T00:00:00Z`);
      return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      });
    }
    case "MEMBER":
      return members.find((m) => m.id === value)?.name ?? "Former member";
    default:
      return String(value);
  }
}

export function CellEditor(props: CellProps) {
  const { field } = props;
  switch (field.type) {
    case "CHECKBOX":
      return (
        <div className="flex h-10 items-center justify-center">
          <Checkbox
            checked={props.value === true}
            disabled={!props.canEdit}
            aria-label={props.label}
            onCheckedChange={(v) => props.onSave(v === true ? true : null)}
          />
        </div>
      );
    case "DATE":
      return <DateCell {...props} />;
    case "SELECT":
    case "MULTI_SELECT":
      return <ChoiceCell {...props} />;
    case "MEMBER":
      return <MemberCell {...props} />;
    case "LONG_TEXT":
      return <LongTextCell {...props} />;
    default:
      return <TextCell {...props} />;
  }
}

/** Text, numbers, money, email, phone and links: type, and it saves when you pause. */
function TextCell({ field, value, members, canEdit, onSave, label }: CellProps) {
  const shown = formatValue(field, value, members);
  const raw = value === null || value === undefined ? "" : String(value);
  const [draft, setDraft] = useState(raw);
  const [focused, setFocused] = useState(false);
  const [invalid, setInvalid] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSent = useRef(raw);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function commit(text: string, final: boolean) {
    if (timer.current) clearTimeout(timer.current);
    if (text === lastSent.current) return;
    const parsed = parseCell(field, text);
    if (!parsed.ok) {
      // Typing "4." or "maya@" mid-word isn't wrong yet; leaving the cell is.
      if (final) setInvalid(parsed.error);
      return;
    }
    setInvalid(null);
    lastSent.current = text;
    onSave(parsed.value);
  }

  if (!canEdit) {
    return <ReadOnly field={field} value={value} shown={shown} />;
  }

  const numeric = field.type === "NUMBER" || field.type === "CURRENCY";
  return (
    <div className="group/cell relative">
      <input
        data-cell-input
        aria-label={label}
        aria-invalid={invalid ? true : undefined}
        title={invalid ?? undefined}
        value={focused ? draft : shown}
        inputMode={
          numeric
            ? "decimal"
            : field.type === "EMAIL"
              ? "email"
              : field.type === "PHONE"
                ? "tel"
                : undefined
        }
        onFocus={(e) => {
          setFocused(true);
          setDraft(raw);
          lastSent.current = raw;
          requestAnimationFrame(() => e.target.select());
        }}
        onChange={(e) => {
          const text = e.target.value;
          setDraft(text);
          setInvalid(null);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => commit(text, false), SAVE_AFTER_MS);
        }}
        onBlur={() => {
          commit(draft, true);
          setFocused(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === "Escape") {
            setDraft(lastSent.current);
            setInvalid(null);
            if (timer.current) clearTimeout(timer.current);
            requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
          }
        }}
        className={cn(
          base,
          numeric && "text-right tabular-nums",
          invalid && "ring-destructive/60 focus:ring-destructive/60 ring-2",
          (field.type === "URL" || field.type === "EMAIL") && !focused && value
            ? "text-primary pe-7"
            : "",
        )}
      />
      {!focused &&
        typeof value === "string" &&
        (field.type === "URL" || field.type === "EMAIL") && (
          <a
            href={field.type === "EMAIL" ? `mailto:${value}` : value}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={field.type === "EMAIL" ? `Email ${value}` : `Open ${value}`}
            className="text-muted-foreground hover:text-foreground absolute top-1/2 right-1.5 -translate-y-1/2 opacity-0 group-hover/cell:opacity-100 focus-visible:opacity-100"
          >
            <ExternalLink className="size-3.5" aria-hidden="true" />
          </a>
        )}
    </div>
  );
}

function ReadOnly({ field, value, shown }: { field: FieldDef; value: unknown; shown: string }) {
  const numeric = field.type === "NUMBER" || field.type === "CURRENCY";
  const inner =
    typeof value === "string" && field.type === "URL" ? (
      <a
        href={value}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary truncate hover:underline"
      >
        {shown}
      </a>
    ) : typeof value === "string" && field.type === "EMAIL" ? (
      <a href={`mailto:${value}`} className="text-primary truncate hover:underline">
        {shown}
      </a>
    ) : (
      <span className="truncate">{shown}</span>
    );
  return (
    <div
      className={cn("flex h-10 items-center px-2.5 text-sm", numeric && "justify-end tabular-nums")}
    >
      {inner}
    </div>
  );
}

/** A day: shown as "Oct 12, 2026"; the browser's date picker while editing. */
function DateCell({ field, value, members, canEdit, onSave, label }: CellProps) {
  const [editing, setEditing] = useState(false);
  const stored = typeof value === "string" ? value : "";
  const [draft, setDraft] = useState(stored);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shown = formatValue(field, value, members);

  function startEditing() {
    setDraft(stored);
    setEditing(true);
  }

  // Typing a year digit by digit makes the picker report every step; save
  // the day once it settles, or when leaving the cell.
  function commit(next: string) {
    if (timer.current) clearTimeout(timer.current);
    if (next !== stored) onSave(next || null);
  }
  if (!canEdit) {
    return (
      <div className="flex h-10 items-center px-2.5 text-sm tabular-nums">
        <span className="truncate">{shown}</span>
      </div>
    );
  }
  if (!editing) {
    return (
      <button
        type="button"
        aria-label={label}
        onClick={startEditing}
        onFocus={startEditing}
        className={cn(base, "text-left tabular-nums")}
      >
        {shown}
      </button>
    );
  }
  return (
    <input
      type="date"
      autoFocus
      aria-label={label}
      value={draft}
      onChange={(e) => {
        const next = e.target.value;
        setDraft(next);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => commit(next), SAVE_AFTER_MS);
      }}
      onBlur={() => {
        commit(draft);
        setEditing(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur();
      }}
      className={cn(base, "tabular-nums [&::-webkit-calendar-picker-indicator]:opacity-50")}
    />
  );
}

/** Paragraphs: the cell shows the first line; editing opens a roomy box. */
function LongTextCell({ field, value, canEdit, onSave, label }: CellProps) {
  const raw = typeof value === "string" ? value : "";
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(raw);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSent = useRef(raw);

  function commit(text: string) {
    if (timer.current) clearTimeout(timer.current);
    if (text === lastSent.current) return;
    const parsed = parseCell(field, text);
    if (!parsed.ok) return;
    lastSent.current = text;
    onSave(parsed.value);
  }

  if (!canEdit) {
    return (
      <div className="flex h-10 items-center px-2.5 text-sm" title={raw}>
        <span className="truncate">{raw.split("\n")[0]}</span>
      </div>
    );
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setDraft(raw);
          lastSent.current = raw;
        } else {
          commit(draft);
        }
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <button type="button" aria-label={label} className={cn(base, "text-left")}>
          <span className="block truncate">{raw.split("\n")[0]}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(28rem,90vw)] p-2">
        <textarea
          autoFocus
          aria-label={label}
          value={draft}
          rows={6}
          onChange={(e) => {
            const text = e.target.value;
            setDraft(text);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => commit(text), SAVE_AFTER_MS);
          }}
          className="border-input bg-card rounded-field focus-visible:border-foreground w-full resize-y border p-3 text-sm leading-relaxed outline-none"
        />
        <p className="text-muted-foreground px-1 pt-1 text-xs">Saves as you type.</p>
      </PopoverContent>
    </Popover>
  );
}

function ChoiceCell({ field, value, canEdit, canManage, onSave, onAddChoice, label }: CellProps) {
  const [open, setOpen] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [adding, setAdding] = useState(false);
  const choices = field.options.choices ?? [];
  const multi = field.type === "MULTI_SELECT";
  const selected = new Set(
    Array.isArray(value) ? (value as string[]) : typeof value === "string" ? [value] : [],
  );
  const shown = choices.filter((c) => selected.has(c.id));

  function toggle(choice: Choice) {
    if (multi) {
      const next = new Set(selected);
      if (next.has(choice.id)) next.delete(choice.id);
      else next.add(choice.id);
      const ordered = choices.filter((c) => next.has(c.id)).map((c) => c.id);
      onSave(ordered.length ? ordered : null);
    } else {
      onSave(selected.has(choice.id) ? null : choice.id);
      setOpen(false);
    }
  }

  async function add() {
    const text = newLabel.trim();
    if (!text || !onAddChoice) return;
    setAdding(true);
    const choice = await onAddChoice(text);
    setAdding(false);
    if (!choice) return;
    setNewLabel("");
    // Pick it, never toggle: it may be a choice the cell already has. A new
    // choice isn't in `choices` yet (the field updates on the next render),
    // so it goes after the ones already picked, the way it sits in the list.
    if (multi) {
      const known = choices.some((c) => c.id === choice.id);
      const ids = choices.filter((c) => selected.has(c.id) || c.id === choice.id).map((c) => c.id);
      onSave(known ? ids : [...ids, choice.id]);
    } else {
      onSave(choice.id);
      setOpen(false);
    }
  }

  const pills = (
    <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
      {shown.map((c) => (
        <ChoicePill key={c.id} choice={c} />
      ))}
    </span>
  );

  if (!canEdit) return <div className="flex h-10 items-center px-2.5">{pills}</div>;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(base, "flex items-center text-left")}
        >
          {pills}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1.5">
        <ul
          role="listbox"
          aria-label={field.name}
          aria-multiselectable={multi}
          className="max-h-64 space-y-0.5 overflow-y-auto"
        >
          {choices.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                role="option"
                aria-selected={selected.has(c.id)}
                onClick={() => toggle(c)}
                className={menuOption}
              >
                <ChoicePill choice={c} />
                {selected.has(c.id) && <Check className="size-4 shrink-0" aria-hidden="true" />}
              </button>
            </li>
          ))}
          {choices.length === 0 && (
            <li className="text-muted-foreground px-2 py-1.5 text-xs">No choices yet.</li>
          )}
        </ul>
        {selected.size > 0 && (
          <button
            type="button"
            onClick={() => {
              onSave(null);
              setOpen(false);
            }}
            className="text-muted-foreground hover:bg-muted hover:text-foreground rounded-field mt-1 flex w-full items-center gap-2 px-2.5 py-2 text-[13px]"
          >
            <X className="size-3.5" aria-hidden="true" />
            Clear
          </button>
        )}
        {canManage && onAddChoice && (
          <form
            className="border-border/70 mt-1.5 flex gap-1.5 border-t pt-2"
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
          >
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Add a choice"
              maxLength={80}
              aria-label={`Add a choice to ${field.name}`}
              className={cn(menuInput, "flex-1")}
            />
            <button
              type="submit"
              disabled={!newLabel.trim() || adding}
              aria-label="Add choice"
              className="border-input hover:bg-muted grid size-8 shrink-0 place-items-center rounded-full border disabled:opacity-50"
            >
              <Plus className="size-3.5" aria-hidden="true" />
            </button>
          </form>
        )}
      </PopoverContent>
    </Popover>
  );
}

function MemberCell({ value, members, canEdit, onSave, label }: CellProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const current = members.find((m) => m.id === value);
  const shown = current?.name ?? (value ? "Former member" : "");
  const matches = members
    .filter((m) => m.name.toLowerCase().includes(query.trim().toLowerCase()))
    .slice(0, 50);

  if (!canEdit) {
    return (
      <div className="flex h-10 items-center px-2.5 text-sm">
        <span className="truncate">{shown}</span>
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={label} className={cn(base, "text-left")}>
          <span className="block truncate">{shown}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1.5">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find someone"
          aria-label="Find a member"
          className={cn(menuInput, "mb-1.5 w-full")}
        />
        <ul role="listbox" aria-label="Members" className="max-h-60 overflow-y-auto">
          {matches.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                role="option"
                aria-selected={m.id === value}
                onClick={() => {
                  onSave(m.id === value ? null : m.id);
                  setOpen(false);
                }}
                className={cn(menuOption, "text-sm")}
              >
                <span className="truncate">{m.name}</span>
                {m.id === value && <Check className="size-4 shrink-0" aria-hidden="true" />}
              </button>
            </li>
          ))}
          {matches.length === 0 && (
            <li className="text-muted-foreground px-2 py-1.5 text-xs">Nobody by that name.</li>
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
