"use client";

import { X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  cellKey,
  DAY_LABELS,
  DAY_SHORT,
  describeRule,
  GRID_HOURS,
  hourLabel,
  hourLabelLong,
  MAX_RULE_LABEL,
  MAX_RULES,
  toggleBlock,
  weeklyCells,
  type Availability,
  type AvailabilityRule,
  type CellKind,
} from "@/lib/availability";
import { cn } from "@/lib/utils";

import { Chip, DashedButton } from "./step-card";

/**
 * "When can't you meet?" (onboarding A5, profile page). Click or drag
 * across the week to block or free hours; rules add a recurring event, an
 * hour or day you never meet, or a single date. Teammates only ever see
 * busy/free.
 */

const CELL_TONE: Record<CellKind, string> = {
  never: "bg-warning/70",
  weekly: "bg-chart-2/60",
};

const BADGE_TONE: Record<string, string> = {
  NEVER: "bg-warning/15 text-warning",
  WEEKLY: "bg-chart-2/15 text-chart-2",
  DATE: "bg-muted text-muted-foreground",
};

export function AvailabilityEditor({
  value,
  onChange,
}: {
  value: Availability;
  onChange: (next: Availability) => void;
}) {
  const cells = useMemo(() => weeklyCells(value), [value]);
  // Drag painting: the first cell decides whether the drag blocks or frees.
  const paint = useRef<boolean | null>(null);
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  }, [value]);
  useEffect(() => {
    const stop = () => {
      paint.current = null;
    };
    window.addEventListener("pointerup", stop);
    return () => window.removeEventListener("pointerup", stop);
  }, []);

  function apply(key: string, on: boolean) {
    const next = toggleBlock(latest.current, key, on);
    latest.current = next;
    onChange(next);
  }

  function start(key: string) {
    const blockedByHand = value.blocks.includes(key);
    const blockedByRule = cells.has(key) && !blockedByHand;
    if (blockedByRule) return; // a rule owns this hour; remove the rule to free it
    paint.current = !blockedByHand;
    apply(key, paint.current);
  }

  function enter(key: string) {
    if (paint.current === null) return;
    const current = latest.current;
    const byHand = current.blocks.includes(key);
    if (byHand === paint.current) return; // already painted this way
    if (!byHand && weeklyCells(current).has(key)) return; // a rule owns it
    apply(key, paint.current);
  }

  return (
    <div className="space-y-4">
      <div
        className="grid touch-none gap-[3px] select-none"
        style={{ gridTemplateColumns: "34px repeat(7, minmax(0, 1fr))" }}
        role="grid"
        aria-label="Hours you can't meet, Monday to Sunday"
        // Whatever cell is under the pointer while dragging (touch and fast
        // mouse moves do not fire pointerenter on every cell).
        onPointerMove={(e) => {
          if (paint.current === null) return;
          const el = document.elementFromPoint(e.clientX, e.clientY);
          const key = el instanceof HTMLElement ? el.dataset.cell : undefined;
          if (key) enter(key);
        }}
      >
        <span />
        {DAY_SHORT.map((d, i) => (
          <span
            key={i}
            className="text-muted-foreground pb-0.5 text-center font-mono text-[10px]"
            aria-hidden="true"
          >
            {d}
          </span>
        ))}
        {GRID_HOURS.map((h) => (
          <Row key={h} hour={h} cells={cells} onStart={start} onEnter={enter} />
        ))}
      </div>

      <div className="text-muted-foreground flex flex-wrap gap-3.5 text-[11px]">
        <span className="flex items-center gap-1.5">
          <span className={cn("size-2.5 rounded-sm", CELL_TONE.never)} />
          Never
        </span>
        <span className="flex items-center gap-1.5">
          <span className={cn("size-2.5 rounded-sm", CELL_TONE.weekly)} />
          Recurring event
        </span>
      </div>

      <RuleList value={value} onChange={onChange} />
    </div>
  );
}

function Row({
  hour,
  cells,
  onStart,
  onEnter,
}: {
  hour: number;
  cells: Map<string, CellKind>;
  onStart: (key: string) => void;
  onEnter: (key: string) => void;
}) {
  return (
    <>
      <span
        className="text-muted-foreground flex items-center font-mono text-[9px]"
        aria-hidden="true"
      >
        {hourLabel(hour)}
      </span>
      {DAY_LABELS.map((day, d) => {
        const key = cellKey(d, hour);
        const kind = cells.get(key);
        return (
          <button
            key={key}
            type="button"
            role="gridcell"
            data-cell={key}
            aria-selected={Boolean(kind)}
            aria-label={`${day} ${hourLabelLong(hour)}: ${kind === "weekly" ? "recurring event" : kind ? "can't meet" : "free"}`}
            onPointerDown={(e) => {
              e.preventDefault();
              (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
              onStart(key);
            }}
            onPointerEnter={() => onEnter(key)}
            onKeyDown={(e) => {
              if (e.key === " " || e.key === "Enter") {
                e.preventDefault();
                onStart(key);
              }
            }}
            className={cn(
              "focus-visible:ring-ring h-4 cursor-pointer rounded-[3px] outline-none focus-visible:ring-2",
              kind ? CELL_TONE[kind] : "bg-muted hover:bg-muted-foreground/20",
            )}
          />
        );
      })}
    </>
  );
}

type AddKind = "weekly" | "never" | "date" | null;

function RuleList({
  value,
  onChange,
}: {
  value: Availability;
  onChange: (next: Availability) => void;
}) {
  const [adding, setAdding] = useState<AddKind>(null);
  const full = value.rules.length >= MAX_RULES;

  function add(rule: AvailabilityRule) {
    onChange({ ...value, rules: [...value.rules, rule] });
    setAdding(null);
  }

  return (
    <div className="space-y-1.5">
      <span className="text-xs font-medium">Rules</span>
      {value.rules.length === 0 && !adding && (
        <p className="text-muted-foreground text-xs">
          No rules yet. Add a class, a lab, or a day you never meet.
        </p>
      )}
      <ul className="grid gap-1.5">
        {value.rules.map((rule, i) => {
          const d = describeRule(rule);
          return (
            <li key={i} className="flex items-center gap-2.5 rounded-lg border px-2.5 py-2 text-xs">
              <span
                className={cn("rounded px-1.5 py-0.5 font-mono text-[10px]", BADGE_TONE[d.badge])}
              >
                {d.badge}
              </span>
              <span className="min-w-0 flex-1 truncate">{d.title}</span>
              <span className="text-muted-foreground shrink-0 font-mono text-[11px]">{d.when}</span>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground rounded p-0.5"
                aria-label={`Remove rule: ${d.title}`}
                onClick={() => onChange({ ...value, rules: value.rules.filter((_, j) => j !== i) })}
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>

      {adding === "weekly" && <WeeklyForm onAdd={add} onCancel={() => setAdding(null)} />}
      {adding === "never" && <NeverForm onAdd={add} onCancel={() => setAdding(null)} />}
      {adding === "date" && <DateForm onAdd={add} onCancel={() => setAdding(null)} />}

      {!adding && (
        <div className="flex flex-wrap gap-1.5">
          <DashedButton disabled={full} onClick={() => setAdding("weekly")}>
            + Recurring event
          </DashedButton>
          <DashedButton disabled={full} onClick={() => setAdding("never")}>
            + Never at…
          </DashedButton>
          <DashedButton disabled={full} onClick={() => setAdding("date")}>
            + Specific date
          </DashedButton>
        </div>
      )}
    </div>
  );
}

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => h);

function HourSelect({
  value,
  onChange,
  label,
  from = 0,
  to = 23,
}: {
  value: number;
  onChange: (h: number) => void;
  label: string;
  from?: number;
  to?: number;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="border-input bg-background h-8 rounded-md border px-2 text-xs"
    >
      {HOUR_OPTIONS.filter((h) => h >= from && h <= to).map((h) => (
        <option key={h} value={h}>
          {hourLabelLong(h)}
        </option>
      ))}
      {to === 24 && <option value={24}>12 AM (midnight)</option>}
    </select>
  );
}

function FormShell({
  children,
  onCancel,
  onAdd,
  canAdd,
  error,
}: {
  children: React.ReactNode;
  onCancel: () => void;
  onAdd: () => void;
  canAdd: boolean;
  error?: string | null;
}) {
  return (
    <div className="bg-muted/30 space-y-2.5 rounded-lg border p-3">
      {children}
      {error && <p className="text-destructive text-xs">{error}</p>}
      <div className="flex justify-end gap-1.5">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={onAdd} disabled={!canAdd}>
          Add rule
        </Button>
      </div>
    </div>
  );
}

function WeeklyForm({
  onAdd,
  onCancel,
}: {
  onAdd: (r: AvailabilityRule) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState("");
  const [days, setDays] = useState<number[]>([]);
  const [start, setStart] = useState(13);
  const [end, setEnd] = useState(15);
  const error = end <= start ? "The end must be after the start." : null;
  return (
    <FormShell
      onCancel={onCancel}
      canAdd={label.trim().length > 0 && days.length > 0 && !error}
      error={error}
      onAdd={() =>
        onAdd({ kind: "weekly", label: label.trim(), days: [...days].sort(), start, end })
      }
    >
      <Input
        autoFocus
        placeholder="Lab section"
        aria-label="What is it?"
        maxLength={MAX_RULE_LABEL}
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        className="h-8 text-xs"
      />
      <div className="flex flex-wrap gap-1" role="group" aria-label="Days">
        {DAY_LABELS.map((d, i) => (
          <Chip
            key={d}
            selected={days.includes(i)}
            onClick={() => setDays(days.includes(i) ? days.filter((x) => x !== i) : [...days, i])}
          >
            {d}
          </Chip>
        ))}
      </div>
      <div className="flex items-center gap-2 text-xs">
        <HourSelect label="From" value={start} onChange={setStart} />
        <span className="text-muted-foreground">to</span>
        <HourSelect label="Until" value={end} onChange={setEnd} from={1} to={24} />
      </div>
    </FormShell>
  );
}

function NeverForm({
  onAdd,
  onCancel,
}: {
  onAdd: (r: AvailabilityRule) => void;
  onCancel: () => void;
}) {
  const [scope, setScope] = useState<"hour" | "day">("hour");
  const [hour, setHour] = useState(8);
  const [day, setDay] = useState(6);
  return (
    <FormShell
      onCancel={onCancel}
      canAdd
      onAdd={() =>
        onAdd(scope === "hour" ? { kind: "never", scope, hour } : { kind: "never", scope, day })
      }
    >
      <div className="flex gap-1">
        <Chip selected={scope === "hour"} onClick={() => setScope("hour")}>
          An hour, every day
        </Chip>
        <Chip selected={scope === "day"} onClick={() => setScope("day")}>
          A whole day
        </Chip>
      </div>
      {scope === "hour" ? (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">I can never meet at</span>
          <HourSelect label="Hour" value={hour} onChange={setHour} />
        </div>
      ) : (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">No meetings on</span>
          <select
            aria-label="Day"
            value={day}
            onChange={(e) => setDay(Number(e.target.value))}
            className="border-input bg-background h-8 rounded-md border px-2 text-xs"
          >
            {DAY_LABELS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
        </div>
      )}
    </FormShell>
  );
}

function DateForm({
  onAdd,
  onCancel,
}: {
  onAdd: (r: AvailabilityRule) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState("");
  const [date, setDate] = useState("");
  const [allDay, setAllDay] = useState(true);
  const [start, setStart] = useState(9);
  const [end, setEnd] = useState(17);
  const error = !allDay && end <= start ? "The end must be after the start." : null;
  return (
    <FormShell
      onCancel={onCancel}
      canAdd={label.trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(date) && !error}
      error={error}
      onAdd={() =>
        onAdd({
          kind: "date",
          label: label.trim(),
          date,
          start: allDay ? null : start,
          end: allDay ? null : end,
        })
      }
    >
      <Input
        autoFocus
        placeholder="Midterm"
        aria-label="What is it?"
        maxLength={MAX_RULE_LABEL}
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        className="h-8 text-xs"
      />
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Input
          type="date"
          aria-label="Date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="h-8 w-auto text-xs"
        />
        <Chip selected={allDay} onClick={() => setAllDay(!allDay)}>
          All day
        </Chip>
        {!allDay && (
          <>
            <HourSelect label="From" value={start} onChange={setStart} />
            <span className="text-muted-foreground">to</span>
            <HourSelect label="Until" value={end} onChange={setEnd} from={1} to={24} />
          </>
        )}
      </div>
    </FormShell>
  );
}

/** Read-only busy grid for other members (no labels, no reasons). */
export function BusyGrid({ busy }: { busy: readonly string[] }) {
  const set = new Set(busy);
  return (
    <div
      className="grid gap-[3px]"
      style={{ gridTemplateColumns: "34px repeat(7, minmax(0, 1fr))" }}
      role="img"
      aria-label={`Busy ${busy.length} hours in a typical week`}
    >
      <span />
      {DAY_SHORT.map((d, i) => (
        <span key={i} className="text-muted-foreground pb-0.5 text-center font-mono text-[10px]">
          {d}
        </span>
      ))}
      {GRID_HOURS.map((h) => (
        <BusyRow key={h} hour={h} set={set} />
      ))}
    </div>
  );
}

function BusyRow({ hour, set }: { hour: number; set: Set<string> }) {
  return (
    <>
      <span className="text-muted-foreground flex items-center font-mono text-[9px]">
        {hourLabel(hour)}
      </span>
      {DAY_LABELS.map((_, d) => (
        <span
          key={d}
          className={cn(
            "h-3.5 rounded-[3px]",
            set.has(cellKey(d, hour)) ? "bg-muted-foreground/40" : "bg-muted",
          )}
        />
      ))}
    </>
  );
}
