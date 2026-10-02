"use client";

import {
  Ban,
  CalendarX,
  Eraser,
  MousePointerClick,
  Moon,
  Repeat,
  Sunrise,
  Umbrella,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  cellKey,
  DAY_LABELS,
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
import { ScheduleImport } from "./schedule-import";

/**
 * "When can't you meet?" (onboarding A5, profile page).
 *
 * - Click an hour to mark it, or drag across the week. Where the drag
 *   starts decides whether it marks or clears.
 * - Click a day or an hour label to mark (or clear) that whole column/row.
 * - Presets cover the usual cases in one tap.
 * - Regular commitments (a class, a lab) and "never" rules paint the grid
 *   too; a date rule is a one-off and only shows in the list.
 *
 * Red is "can't meet", blue is a recurring commitment, and a free hour is a
 * quiet cell. Teammates only ever see busy or free.
 */

const CELL_TONE: Record<CellKind, string> = {
  never: "bg-destructive/85 hover:bg-destructive",
  weekly: "bg-chart-1/85",
};

const HAND_HOURS = GRID_HOURS;
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

interface Preset {
  id: string;
  label: string;
  icon: LucideIcon;
  keys: string[];
}

const PRESETS: Preset[] = [
  {
    id: "mornings",
    label: "Before 10 AM",
    icon: Sunrise,
    keys: ALL_DAYS.flatMap((d) => [8, 9].map((h) => cellKey(d, h))),
  },
  {
    id: "nights",
    label: "After 9 PM",
    icon: Moon,
    keys: ALL_DAYS.flatMap((d) => [21, 22].map((h) => cellKey(d, h))),
  },
  {
    id: "weekends",
    label: "Weekends",
    icon: Umbrella,
    keys: [5, 6].flatMap((d) => HAND_HOURS.map((h) => cellKey(d, h))),
  },
];

export function AvailabilityEditor({
  value,
  onChange,
}: {
  value: Availability;
  onChange: (next: Availability) => void;
}) {
  const cells = useMemo(() => weeklyCells(value), [value]);
  const [hover, setHover] = useState<{ day: number; hour: number } | null>(null);
  // Drag painting: the first cell decides whether the drag marks or clears.
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

  function commit(next: Availability) {
    latest.current = next;
    onChange(next);
  }

  function ruleOwns(v: Availability, key: string) {
    return !v.blocks.includes(key) && weeklyCells(v).has(key);
  }

  function start(key: string) {
    const current = latest.current;
    if (ruleOwns(current, key)) return; // a rule owns this hour; remove the rule to free it
    paint.current = !current.blocks.includes(key);
    commit(toggleBlock(current, key, paint.current));
  }

  function enter(key: string) {
    if (paint.current === null) return;
    const current = latest.current;
    if (current.blocks.includes(key) === paint.current) return;
    if (ruleOwns(current, key)) return;
    commit(toggleBlock(current, key, paint.current));
  }

  /** Mark all of `keys`, or clear them when they are all marked already. */
  function toggleMany(keys: string[]) {
    const current = latest.current;
    const own = keys.filter((k) => !ruleOwns(current, k));
    const allOn = own.length > 0 && own.every((k) => current.blocks.includes(k));
    const set = new Set(current.blocks);
    for (const k of own) {
      if (allOn) set.delete(k);
      else set.add(k);
    }
    commit({ ...current, blocks: [...set].sort() });
  }

  const presetOn = (p: Preset) => p.keys.every((k) => cells.has(k));

  // Totals inside the grid's hours.
  let never = 0;
  let weekly = 0;
  for (const [key, kind] of cells) {
    const h = Number(key.split("-")[1]);
    if (!HAND_HOURS.includes(h)) continue;
    if (kind === "never") never++;
    else weekly++;
  }
  const totalHours = HAND_HOURS.length * 7;
  const free = totalHours - never - weekly;

  const hoverKey = hover ? cellKey(hover.day, hover.hour) : null;
  const hoverKind = hoverKey ? cells.get(hoverKey) : undefined;
  const hoverIsRule = hoverKey ? ruleOwns(value, hoverKey) : false;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-muted-foreground mr-1 text-xs">Quick add</span>
        {PRESETS.map((p) => (
          <Chip key={p.id} icon={p.icon} selected={presetOn(p)} onClick={() => toggleMany(p.keys)}>
            {p.label}
          </Chip>
        ))}
        <ScheduleImport value={value} onChange={commit} />
        {value.blocks.length > 0 && (
          <button
            type="button"
            onClick={() => commit({ ...latest.current, blocks: [] })}
            className="text-muted-foreground hover:text-foreground ml-auto inline-flex items-center gap-1 text-xs"
          >
            <Eraser className="size-3.5" aria-hidden="true" />
            Clear grid
          </button>
        )}
      </div>

      <div className="bg-background/60 rounded-xl border p-3">
        <div
          className="grid touch-none gap-1 select-none"
          style={{ gridTemplateColumns: "44px repeat(7, minmax(0, 1fr))" }}
          role="grid"
          aria-label="Hours you can't meet, Monday to Sunday"
          onPointerLeave={() => setHover(null)}
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
          {DAY_LABELS.map((day, d) => (
            <button
              key={day}
              type="button"
              onClick={() => toggleMany(HAND_HOURS.map((h) => cellKey(d, h)))}
              className={cn(
                "rounded-md py-1 text-center text-[11px] font-medium transition-colors",
                hover?.day === d ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
              title={`Mark all of ${day}`}
            >
              {day}
            </button>
          ))}
          {HAND_HOURS.map((h) => (
            <Row
              key={h}
              hour={h}
              cells={cells}
              hover={hover}
              onHover={(day) => setHover({ day, hour: h })}
              onStart={start}
              onEnter={enter}
              onRow={() => toggleMany(ALL_DAYS.map((d) => cellKey(d, h)))}
            />
          ))}
        </div>

        <div className="text-muted-foreground mt-3 flex min-h-5 items-center gap-1.5 border-t pt-2.5 text-xs" aria-live="polite">
          <MousePointerClick className="size-3.5 shrink-0" aria-hidden="true" />
          {hover ? (
            <span>
              <span className="text-foreground font-medium">
                {DAY_LABELS[hover.day]} {hourLabelLong(hover.hour)}
              </span>
              {" · "}
              {hoverIsRule
                ? "from a regular commitment below"
                : hoverKind
                  ? "can't meet. Click to free it"
                  : "free. Click or drag to block it"}
            </span>
          ) : (
            <span>Click or drag to block hours. Click a day or a time to block the whole column or row.</span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs">
        <Stat tone="bg-destructive" label="Can't meet" hours={never} />
        <Stat tone="bg-chart-1" label="Commitments" hours={weekly} />
        <Stat tone="bg-muted border" label="Free" hours={free} />
      </div>

      <RuleList value={value} onChange={commit} />
    </div>
  );
}

function Stat({ tone, label, hours }: { tone: string; label: string; hours: number }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border px-2.5 py-2">
      <span className={cn("size-2.5 shrink-0 rounded-sm", tone)} aria-hidden="true" />
      <span className="text-muted-foreground truncate">{label}</span>
      <span className="ml-auto font-mono font-medium tabular-nums">{hours}h</span>
    </div>
  );
}

function Row({
  hour,
  cells,
  hover,
  onHover,
  onStart,
  onEnter,
  onRow,
}: {
  hour: number;
  cells: Map<string, CellKind>;
  hover: { day: number; hour: number } | null;
  onHover: (day: number) => void;
  onStart: (key: string) => void;
  onEnter: (key: string) => void;
  onRow: () => void;
}) {
  return (
    <>
      <button
        type="button"
        onClick={onRow}
        title={`Mark ${hourLabelLong(hour)} every day`}
        className={cn(
          "flex items-center justify-end rounded-md pr-1.5 font-mono text-[10px] transition-colors",
          hover?.hour === hour ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        {hourLabel(hour)}
      </button>
      {DAY_LABELS.map((day, d) => {
        const key = cellKey(d, hour);
        const kind = cells.get(key);
        const crosshair = hover && (hover.day === d || hover.hour === hour) && !kind;
        return (
          <button
            key={key}
            type="button"
            role="gridcell"
            data-cell={key}
            aria-selected={Boolean(kind)}
            aria-label={`${day} ${hourLabelLong(hour)}: ${kind === "weekly" ? "regular commitment" : kind ? "can't meet" : "free"}`}
            onPointerDown={(e) => {
              e.preventDefault();
              (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
              onStart(key);
            }}
            onPointerEnter={() => {
              onHover(d);
              onEnter(key);
            }}
            onKeyDown={(e) => {
              if (e.key === " " || e.key === "Enter") {
                e.preventDefault();
                onStart(key);
              }
            }}
            onFocus={() => onHover(d)}
            className={cn(
              "focus-visible:ring-ring h-6 cursor-pointer rounded-md transition-colors outline-none focus-visible:ring-2",
              kind
                ? cn(CELL_TONE[kind], kind === "weekly" && "cursor-not-allowed")
                : crosshair
                  ? "bg-muted-foreground/15"
                  : "bg-muted/70 hover:bg-destructive/40",
            )}
          />
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------- rules

type AddKind = "weekly" | "never" | "date" | null;

const RULE_STYLE: Record<string, { icon: LucideIcon; tone: string }> = {
  NEVER: { icon: Ban, tone: "bg-destructive/10 text-destructive" },
  WEEKLY: { icon: Repeat, tone: "bg-chart-1/10 text-chart-1" },
  DATE: { icon: CalendarX, tone: "bg-muted text-muted-foreground" },
};

function RuleList({ value, onChange }: { value: Availability; onChange: (next: Availability) => void }) {
  const [adding, setAdding] = useState<AddKind>(null);
  const full = value.rules.length >= MAX_RULES;

  function add(rule: AvailabilityRule) {
    onChange({ ...value, rules: [...value.rules, rule] });
    setAdding(null);
  }

  return (
    <div className="space-y-2">
      <div>
        <span className="text-sm font-medium">Regular commitments</span>
        <p className="text-muted-foreground text-xs">
          Classes, labs, jobs, or a time you&apos;re never free. They fill the grid for you.
        </p>
      </div>
      {value.rules.length > 0 && (
        <ul className="grid gap-1.5">
          {value.rules.map((rule, i) => {
            const d = describeRule(rule);
            const style = RULE_STYLE[d.badge];
            const Icon = style.icon;
            return (
              <li key={i} className="group flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm">
                <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", style.tone)}>
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{d.title}</span>
                  <span className="text-muted-foreground block truncate text-xs">{d.when}</span>
                </span>
                <button
                  type="button"
                  className="text-muted-foreground hover:bg-muted hover:text-foreground rounded-md p-1"
                  aria-label={`Remove: ${d.title}`}
                  onClick={() => onChange({ ...value, rules: value.rules.filter((_, j) => j !== i) })}
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {adding === "weekly" && <WeeklyForm onAdd={add} onCancel={() => setAdding(null)} />}
      {adding === "never" && <NeverForm onAdd={add} onCancel={() => setAdding(null)} />}
      {adding === "date" && <DateForm onAdd={add} onCancel={() => setAdding(null)} />}

      {!adding && (
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
          <DashedButton icon={Repeat} disabled={full} onClick={() => setAdding("weekly")}>
            Weekly class
          </DashedButton>
          <DashedButton icon={Ban} disabled={full} onClick={() => setAdding("never")}>
            Never at…
          </DashedButton>
          <DashedButton icon={CalendarX} disabled={full} onClick={() => setAdding("date")}>
            One date
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
      className="border-input bg-background h-9 rounded-md border px-2 text-sm"
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
  icon: Icon,
  title,
  children,
  onCancel,
  onAdd,
  canAdd,
  error,
}: {
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
  onCancel: () => void;
  onAdd: () => void;
  canAdd: boolean;
  error?: string | null;
}) {
  return (
    <div className="bg-muted/30 animate-in fade-in-0 zoom-in-95 space-y-3 rounded-xl border p-3.5 duration-200">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Icon className="text-muted-foreground size-4" aria-hidden="true" />
        {title}
      </div>
      {children}
      {error && <p className="text-destructive text-xs">{error}</p>}
      <div className="flex justify-end gap-1.5">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={onAdd} disabled={!canAdd}>
          Add
        </Button>
      </div>
    </div>
  );
}

function WeeklyForm({ onAdd, onCancel }: { onAdd: (r: AvailabilityRule) => void; onCancel: () => void }) {
  const [label, setLabel] = useState("");
  const [days, setDays] = useState<number[]>([]);
  const [start, setStart] = useState(13);
  const [end, setEnd] = useState(15);
  const error = end <= start ? "The end must be after the start." : null;
  return (
    <FormShell
      icon={Repeat}
      title="A class or weekly commitment"
      onCancel={onCancel}
      canAdd={label.trim().length > 0 && days.length > 0 && !error}
      error={error}
      onAdd={() => onAdd({ kind: "weekly", label: label.trim(), days: [...days].sort(), start, end })}
    >
      <Input
        autoFocus
        placeholder="e.g. CS 3500 lab"
        aria-label="What is it?"
        maxLength={MAX_RULE_LABEL}
        value={label}
        onChange={(e) => setLabel(e.target.value)}
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
      <div className="flex items-center gap-2 text-sm">
        <HourSelect label="From" value={start} onChange={setStart} />
        <span className="text-muted-foreground">to</span>
        <HourSelect label="Until" value={end} onChange={setEnd} from={1} to={24} />
      </div>
    </FormShell>
  );
}

function NeverForm({ onAdd, onCancel }: { onAdd: (r: AvailabilityRule) => void; onCancel: () => void }) {
  const [scope, setScope] = useState<"hour" | "day">("hour");
  const [hour, setHour] = useState(8);
  const [day, setDay] = useState(6);
  return (
    <FormShell
      icon={Ban}
      title="A time you're never free"
      onCancel={onCancel}
      canAdd
      onAdd={() => onAdd(scope === "hour" ? { kind: "never", scope, hour } : { kind: "never", scope, day })}
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
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">I can never meet at</span>
          <HourSelect label="Hour" value={hour} onChange={setHour} />
        </div>
      ) : (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">No meetings on</span>
          <select
            aria-label="Day"
            value={day}
            onChange={(e) => setDay(Number(e.target.value))}
            className="border-input bg-background h-9 rounded-md border px-2 text-sm"
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

function DateForm({ onAdd, onCancel }: { onAdd: (r: AvailabilityRule) => void; onCancel: () => void }) {
  const [label, setLabel] = useState("");
  const [date, setDate] = useState("");
  const [allDay, setAllDay] = useState(true);
  const [start, setStart] = useState(9);
  const [end, setEnd] = useState(17);
  const error = !allDay && end <= start ? "The end must be after the start." : null;
  return (
    <FormShell
      icon={CalendarX}
      title="One date you can't make"
      onCancel={onCancel}
      canAdd={label.trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(date) && !error}
      error={error}
      onAdd={() =>
        onAdd({ kind: "date", label: label.trim(), date, start: allDay ? null : start, end: allDay ? null : end })
      }
    >
      <Input
        autoFocus
        placeholder="e.g. Midterm"
        aria-label="What is it?"
        maxLength={MAX_RULE_LABEL}
        value={label}
        onChange={(e) => setLabel(e.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Input type="date" aria-label="Date" value={date} onChange={(e) => setDate(e.target.value)} className="w-auto" />
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

// ---------------------------------------------------------------- read-only

/** Read-only busy grid for other members (no labels, no reasons). */
export function BusyGrid({ busy }: { busy: readonly string[] }) {
  const set = new Set(busy);
  return (
    <div
      className="grid gap-1"
      style={{ gridTemplateColumns: "40px repeat(7, minmax(0, 1fr))" }}
      role="img"
      aria-label={`Busy ${busy.length} hours in a typical week`}
    >
      <span />
      {DAY_LABELS.map((d) => (
        <span key={d} className="text-muted-foreground pb-0.5 text-center text-[10px] font-medium">
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
      <span className="text-muted-foreground flex items-center justify-end pr-1 font-mono text-[9px]">
        {hourLabel(hour)}
      </span>
      {DAY_LABELS.map((_, d) => (
        <span
          key={d}
          className={cn("h-3.5 rounded-[3px]", set.has(cellKey(d, hour)) ? "bg-muted-foreground/45" : "bg-muted")}
        />
      ))}
    </>
  );
}
