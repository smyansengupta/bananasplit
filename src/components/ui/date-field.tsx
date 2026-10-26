"use client";

import * as React from "react";

import { CalendarDays } from "@/components/icons";
import { Calendar } from "@/components/ui/calendar";
import { FieldSelect } from "@/components/ui/field-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Dates and times that look like the rest of the app.
 *
 * A native <input type="date"> or "datetime-local" draws the operating
 * system's own picker — the grey Windows calendar, Chrome's clock — which
 * is the one control left that ignores the theme, in the one place it is
 * most used. These take the same value a native input takes, in the same
 * shape ("YYYY-MM-DD", "YYYY-MM-DDTHH:mm", "HH:mm"), and hand back the
 * same, so a field swaps over one for one. The popover is the themed
 * Calendar, and the time is a themed Select rather than a spinner.
 *
 *   <DateField value={due} onChange={setDue} />
 *   <DateTimeField value={startsAt} onChange={setStartsAt} />
 *   <TimeField value={from} onChange={setFrom} />
 *
 * With `name`, a hidden input carries the value into FormData, so a form
 * that posts to a server action keeps working.
 */

const FIELD =
  "border-input bg-card rounded-field focus-visible:border-foreground flex h-10 w-full min-w-0 items-center gap-2 border px-3 text-left text-sm transition-colors outline-none focus-visible:shadow-[0_0_0_4px_color-mix(in_oklab,var(--glow)_45%,transparent)] disabled:cursor-not-allowed disabled:opacity-50 data-invalid:border-destructive";

/* ------------------------------------------------------------------ dates */

/** "2026-10-26" → a Date at local midnight (never a day out, unlike parsing). */
function fromKey(key: string | undefined): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key ?? "");
  if (!m) return undefined;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** A Date → "2026-10-26", in the viewer's own day, not UTC's. */
function toKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const dayFmt = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
});

function dayLabel(key: string): string {
  const date = fromKey(key);
  return date ? dayFmt.format(date) : "";
}

/* ------------------------------------------------------------------ times */

const STEP_MINUTES = 15;

/** "18:30" → "6:30 PM". */
export function timeLabel(value: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!m) return "";
  const hour = Number(m[1]);
  const suffix = hour < 12 ? "AM" : "PM";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}:${m[2]} ${suffix}`;
}

/** Every quarter hour, plus whatever is already picked if it is off the grid. */
function timeOptions(current: string): string[] {
  const out: string[] = [];
  for (let m = 0; m < 24 * 60; m += STEP_MINUTES) {
    const h = String(Math.floor(m / 60)).padStart(2, "0");
    out.push(`${h}:${String(m % 60).padStart(2, "0")}`);
  }
  const normal = current.slice(0, 5);
  if (/^\d{2}:\d{2}$/.test(normal) && !out.includes(normal)) {
    out.push(normal);
    out.sort();
  }
  return out;
}

export function TimeField({
  value,
  onChange,
  name,
  id,
  disabled,
  required,
  className,
  "aria-label": ariaLabel,
}: {
  /** "HH:mm". */
  value: string;
  onChange: (value: string) => void;
  name?: string;
  id?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  const options = React.useMemo(() => timeOptions(value), [value]);
  return (
    <FieldSelect
      id={id}
      name={name}
      value={value.slice(0, 5)}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      required={required}
      aria-label={ariaLabel ?? "Time"}
      className={cn("w-full", className)}
    >
      {options.map((t) => (
        <option key={t} value={t}>
          {timeLabel(t)}
        </option>
      ))}
    </FieldSelect>
  );
}

/* ------------------------------------------------------------- date picker */

/**
 * The themed calendar hung off whatever you give it as a trigger, for the
 * few places that already have one — a cell in a table, a date written into
 * a note — and only need the picker.
 */
export function DatePopover({
  value,
  onPick,
  min,
  max,
  children,
  open,
  onOpenChange,
}: {
  value: string;
  onPick: (key: string) => void;
  min?: string;
  max?: string;
  children: React.ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const selected = fromKey(value);
  // react-day-picker wants one matcher or none, never one with holes in it.
  const bounds = [
    ...(fromKey(min) ? [{ before: fromKey(min)! }] : []),
    ...(fromKey(max) ? [{ after: fromKey(max)! }] : []),
  ];
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          autoFocus
          selected={selected}
          defaultMonth={selected}
          captionLayout="dropdown"
          disabled={bounds.length > 0 ? bounds : undefined}
          onSelect={(date) => {
            if (!date) return;
            onPick(toKey(date));
            onOpenChange(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

export function DateField({
  value,
  onChange,
  name,
  id,
  min,
  max,
  disabled,
  required,
  className,
  placeholder = "Pick a date",
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
}: {
  /** "YYYY-MM-DD", or "" for nothing picked. */
  value: string;
  onChange: (value: string) => void;
  name?: string;
  id?: string;
  min?: string;
  max?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  placeholder?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <DatePopover
        value={value}
        onPick={onChange}
        min={min}
        max={max}
        open={open}
        onOpenChange={setOpen}
      >
        <button
          type="button"
          id={id}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-describedby={ariaDescribedBy}
          data-invalid={ariaInvalid === true || ariaInvalid === "true" ? "" : undefined}
          className={cn(FIELD, !value && "text-muted-foreground", className)}
        >
          <CalendarDays className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{value ? dayLabel(value) : placeholder}</span>
        </button>
      </DatePopover>
      {name && <input type="hidden" name={name} value={value} required={required} />}
    </>
  );
}

/* --------------------------------------------------------- date plus time */

/** Splits "2026-10-26T18:30" into its day and its time. */
function splitStamp(value: string): { day: string; time: string } {
  const [day = "", rest = ""] = value.split("T");
  return { day, time: rest.slice(0, 5) };
}

export function DateTimeField({
  value,
  onChange,
  name,
  id,
  min,
  max,
  disabled,
  required,
  className,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
}: {
  /** "YYYY-MM-DDTHH:mm", or "" for nothing picked. */
  value: string;
  onChange: (value: string) => void;
  name?: string;
  id?: string;
  /** Also "YYYY-MM-DDTHH:mm"; only the day part bounds the calendar. */
  min?: string;
  max?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
}) {
  const [open, setOpen] = React.useState(false);
  const { day, time } = splitStamp(value);
  const set = (nextDay: string, nextTime: string) =>
    onChange(nextDay ? `${nextDay}T${nextTime || "09:00"}` : "");

  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      <DatePopover
        value={day}
        onPick={(d) => set(d, time)}
        min={min?.slice(0, 10)}
        max={max?.slice(0, 10)}
        open={open}
        onOpenChange={setOpen}
      >
        <button
          type="button"
          id={id}
          disabled={disabled}
          aria-label={ariaLabel ?? "Date"}
          aria-describedby={ariaDescribedBy}
          data-invalid={ariaInvalid === true || ariaInvalid === "true" ? "" : undefined}
          className={cn(FIELD, "flex-1", !day && "text-muted-foreground")}
        >
          <CalendarDays className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{day ? dayLabel(day) : "Pick a date"}</span>
        </button>
      </DatePopover>
      <TimeField
        value={time}
        onChange={(t) => set(day, t)}
        disabled={disabled}
        aria-label="Time"
        className="w-[7.5rem] shrink-0"
      />
      {name && <input type="hidden" name={name} value={value} required={required} />}
    </div>
  );
}

/* ------------------------------------------------- the <Input> adapter */

/** The input types whose native control is the operating system's own. */
export const THEMED_INPUT_TYPES = new Set(["date", "datetime-local", "time"]);

/**
 * What <Input type="date" | "datetime-local" | "time"> renders instead of a
 * native input. It takes the native props and hands `onChange` something
 * shaped like the event a native input would have given, so every field in
 * the app swaps over without its call site changing a line.
 */
export function DateInput({
  type,
  value,
  defaultValue,
  onChange,
  name,
  id,
  min,
  max,
  required,
  disabled,
  className,
  placeholder,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
}: React.ComponentProps<"input">) {
  const controlled = value !== undefined;
  const [own, setOwn] = React.useState(String(defaultValue ?? ""));
  const current = String((controlled ? value : own) ?? "");

  const emit = (next: string) => {
    if (!controlled) setOwn(next);
    const field = { value: next, name: name ?? "" };
    onChange?.({
      target: field,
      currentTarget: field,
    } as unknown as React.ChangeEvent<HTMLInputElement>);
  };

  const shared = {
    id,
    name,
    disabled,
    required,
    className,
    "aria-label": ariaLabel,
    "aria-describedby": ariaDescribedBy,
    "aria-invalid": ariaInvalid as boolean | "true" | "false" | undefined,
  };

  if (type === "time") {
    return <TimeField {...shared} value={current} onChange={emit} />;
  }
  if (type === "datetime-local") {
    return (
      <DateTimeField
        {...shared}
        value={current}
        onChange={emit}
        min={typeof min === "string" ? min : undefined}
        max={typeof max === "string" ? max : undefined}
      />
    );
  }
  return (
    <DateField
      {...shared}
      value={current}
      onChange={emit}
      min={typeof min === "string" ? min : undefined}
      max={typeof max === "string" ? max : undefined}
      placeholder={typeof placeholder === "string" ? placeholder : undefined}
    />
  );
}
