"use client";

import { CalendarDays, Check, Plus, X } from "@/components/icons";
import { useRef, useState } from "react";

import { TAG_PICKER_COLORS, type LabelColor } from "@/lib/label-colors";
import { cn } from "@/lib/utils";

/** The ten colours the picker offers. */
export const TAG_COLORS = TAG_PICKER_COLORS;

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export interface TagRow {
  key: string;
  /** The saved row's id; null for one added here. */
  id: string | null;
  name: string;
  color: LabelColor;
}

/**
 * A list of named, coloured tags, for onboarding's Tags and Event types:
 * each row is a colour dot (click it and the ten colours slide in over the
 * name; pick one and they slide away) and a name; suggestions not yet on the list are one click away, and
 * Add puts an empty row at the end, focused.
 */
export function TagListEditor({
  rows,
  onChange,
  suggestions,
  noun,
  max,
  week = false,
}: {
  rows: TagRow[];
  onChange: (rows: TagRow[]) => void;
  /** Quick adds, shown while they aren't on the list. */
  suggestions: readonly string[];
  /** "tag", "event type". */
  noun: string;
  max: number;
  /**
   * Draw the list as a week on the calendar ("This week", a weekday on each
   * row, each row tinted its colour), so what you edit is what you'll see.
   */
  week?: boolean;
}) {
  const list = useRef<HTMLUListElement>(null);
  /** The row whose colours are showing, over its name. */
  const [picking, setPicking] = useState<string | null>(null);
  const update = (key: string, patch: Partial<TagRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const taken = new Set(rows.map((r) => r.name.trim().toLowerCase()));
  const open = suggestions.filter((s) => !taken.has(s.toLowerCase()));

  function add(name = "") {
    if (rows.length >= max) return;
    const key = `new-${Date.now()}-${rows.length}`;
    // A colour nothing on the list has yet; past ten, they repeat in order.
    const used = new Set(rows.map((r) => r.color));
    const color =
      TAG_COLORS.find((c) => !used.has(c)) ?? TAG_COLORS[rows.length % TAG_COLORS.length]!;
    onChange([...rows, { key, id: null, name, color }]);
    if (!name) {
      setTimeout(
        () => list.current?.querySelector<HTMLInputElement>(`[data-key="${key}"]`)?.focus(),
        0,
      );
    }
  }

  const items = (
    <ul ref={list} className="m-0 flex list-none flex-col gap-2 p-0">
      {rows.map((row, i) => (
        <li
          key={row.key}
          className={cn(
            "focus-within-banana rounded-field flex h-11 items-center gap-3 pr-2 pl-3",
            week ? "" : "bg-card border-border border",
          )}
          style={
            week
              ? { backgroundColor: `color-mix(in oklab, ${row.color} 14%, var(--card))` }
              : undefined
          }
        >
          <button
            type="button"
            aria-label={`Colour of ${row.name || `this ${noun}`}`}
            aria-expanded={picking === row.key}
            onClick={() => setPicking(picking === row.key ? null : row.key)}
            className="hover:bg-muted grid size-7 flex-none cursor-pointer place-items-center rounded-full"
          >
            <span className="size-3.5 rounded-full" style={{ backgroundColor: row.color }} />
          </button>
          <span className="relative flex h-full min-w-0 flex-1 items-center overflow-hidden">
            <input
              data-key={row.key}
              aria-label={`${noun} name`}
              value={row.name}
              maxLength={40}
              placeholder={`Name this ${noun}`}
              onChange={(e) => update(row.key, { name: e.target.value })}
              tabIndex={picking === row.key ? -1 : undefined}
              className={cn(
                "w-full min-w-0 bg-transparent text-[15px] font-semibold transition-opacity duration-200 outline-none",
                picking === row.key && "opacity-0",
              )}
            />
            {/* The colours slide in over the name, then back out once one is picked. */}
            <span
              role="group"
              aria-label="Colours"
              aria-hidden={picking !== row.key}
              className={cn(
                "absolute inset-0 flex items-center gap-1.5 transition-[transform,opacity] duration-200 ease-(--ease-ink)",
                !week && "bg-card",
                picking === row.key
                  ? "translate-x-0 opacity-100"
                  : "pointer-events-none -translate-x-3 opacity-0",
              )}
              style={
                week
                  ? { backgroundColor: `color-mix(in oklab, ${row.color} 14%, var(--card))` }
                  : undefined
              }
            >
              {TAG_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  tabIndex={picking === row.key ? undefined : -1}
                  aria-label={`Use ${color}`}
                  aria-pressed={row.color === color}
                  onClick={() => {
                    update(row.key, { color });
                    setPicking(null);
                  }}
                  className={cn(
                    "grid size-6 flex-none cursor-pointer place-items-center rounded-full transition-transform hover:scale-110",
                    row.color === color && "ring-foreground ring-2 ring-offset-1",
                  )}
                  style={{ backgroundColor: color }}
                >
                  {row.color === color && (
                    <Check className="size-3 text-white" strokeWidth={3.5} aria-hidden="true" />
                  )}
                </button>
              ))}
            </span>
          </span>
          {week && (
            <span className="text-muted-foreground flex-none text-[12px] font-medium">
              {WEEKDAYS[i % WEEKDAYS.length]}
            </span>
          )}
          <button
            type="button"
            aria-label={`Remove ${row.name || `this ${noun}`}`}
            onClick={() => onChange(rows.filter((r) => r.key !== row.key))}
            className="text-muted-foreground hover:text-foreground hover:bg-muted grid size-7 flex-none cursor-pointer place-items-center rounded-full"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="flex flex-col gap-3">
      {week ? (
        <div className="bg-card border-border flex flex-col gap-2 rounded-[18px] border p-3">
          <span className="flex items-center gap-2 px-1 text-[13px] font-semibold">
            <CalendarDays className="size-4" aria-hidden="true" />
            This week
          </span>
          {items}
        </div>
      ) : (
        items
      )}

      {rows.length < max && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => add()}
            className="border-input hover:bg-muted inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-semibold"
          >
            <Plus className="size-4" aria-hidden="true" />
            Add {noun}
          </button>
          {open.slice(0, 6).map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => add(name)}
              className="bg-muted hover:bg-muted-strong text-muted-foreground hover:text-foreground inline-flex h-9 cursor-pointer items-center gap-1 rounded-full px-3 text-[13px] font-medium"
            >
              <Plus className="size-3.5" aria-hidden="true" />
              {name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
