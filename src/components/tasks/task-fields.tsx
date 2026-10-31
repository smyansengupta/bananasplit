"use client";

import {
  Calendar,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Globe,
  Lock,
  TriangleAlert,
  X,
} from "@/components/icons";
import { useId, useMemo, useRef, useState, type ReactNode } from "react";

import { TagChip } from "@/components/ui/chip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { UserAvatar } from "@/components/user-avatar";
import { TaskPriority, TaskStatus, TaskVisibility } from "@/generated/prisma/enums";
import { relationFor } from "@/lib/tasks/assignment";
import { addDaysToKey, weekdayOfKey } from "@/lib/tasks/dates";
import { parseDueText, quickDues } from "@/lib/tasks/due-text";
import { epicColor } from "@/lib/tasks/epic";
import { cn } from "@/lib/utils";

import { STATUS_LABEL, STATUS_TOKEN } from "./layout-ui";
import { EpicDot, ParentMenu } from "./epic-menu";
import { TagMenu } from "./tag-menu";
import { useTasks } from "./tasks-context";
import type { LabelOption, MemberOption } from "./types";

/**
 * The task form's controls, drawn as the task drawer design has them: a
 * label over each field, dropdown fields as tall rounded wells that open a
 * menu, and the small fixed choices (status, priority, who can see it) as
 * a row of segments. Everything takes the theme's tokens, so it follows the
 * club's colours in light and dark.
 */

/* ------------------------------------------------------------- primitives */

export function FieldLabel({
  children,
  htmlFor,
  optional,
  required,
}: {
  children: ReactNode;
  htmlFor?: string;
  optional?: boolean;
  required?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between text-[13px] font-medium">
      <label htmlFor={htmlFor} className="text-foreground/85">
        {children}
        {required && <span className="text-destructive"> *</span>}
      </label>
      {optional && (
        <span className="text-muted-foreground/80 text-[11px] font-normal">Optional</span>
      )}
    </div>
  );
}

/** A field: its label over its control. */
export function Field({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex min-w-0 flex-col gap-2", className)}>{children}</div>;
}

/** The dropdown well's classes: open is outlined in the primary, empty reads quieter. */
export function wellClass(open: boolean, empty = false) {
  return cn(
    "bg-card hover:bg-muted/60 hover:border-foreground/15 flex h-[42px] w-full min-w-0 items-center gap-2.5 overflow-hidden rounded-[11px] border px-3 text-left text-[13px] font-medium whitespace-nowrap transition-colors outline-none",
    "focus-visible:border-primary/70 focus-visible:ring-primary/15 focus-visible:ring-3",
    "disabled:pointer-events-none disabled:opacity-60",
    open && "bg-muted/60 border-primary/70 ring-primary/15 ring-3",
    empty && "text-muted-foreground font-normal",
  );
}

const UpDown = () => (
  <ChevronsUpDown
    className="text-muted-foreground/70 ms-auto size-3.5 shrink-0"
    aria-hidden="true"
  />
);

/** A menu item's classes; the chosen one reads in the primary. */
export function menuItemClass(on = false) {
  return cn(
    "hover:bg-muted focus-visible:bg-muted flex h-[34px] w-full min-w-0 items-center gap-2.5 rounded-md px-2 text-left text-[13px] font-medium outline-none",
    on ? "text-primary" : "text-foreground/90",
  );
}

export function MenuHeading({ children }: { children: ReactNode }) {
  return (
    <div className="text-muted-foreground px-2 pt-1.5 pb-1 text-[11px] font-semibold tracking-[0.05em] uppercase">
      {children}
    </div>
  );
}

const MENU = "w-[300px] gap-px rounded-[10px] p-1.5";

/** The row of segments for a small fixed choice. */
export function SegmentBox<T extends string>({
  label,
  value,
  onChange,
  options,
  disabled,
  id,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: ReactNode; icon?: ReactNode }[];
  disabled?: boolean;
  id?: string;
}) {
  return (
    <div
      id={id}
      role="radiogroup"
      aria-label={label}
      className={cn("bg-card flex gap-[3px] rounded-[11px] border p-1", disabled && "opacity-60")}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              "focus-visible:ring-ring/50 inline-flex h-8 min-w-0 flex-1 items-center justify-center gap-[5px] rounded-lg px-0.5 text-[13px] font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3 disabled:pointer-events-none",
              on
                ? "bg-muted text-foreground dark:bg-input/70"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.icon}
            <span className="truncate">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------- status and priority */

const STATUS_ORDER = [
  TaskStatus.NOT_STARTED,
  TaskStatus.IN_PROGRESS,
  TaskStatus.BLOCKED,
  TaskStatus.COMPLETED,
];

export const STATUS_OPTIONS = STATUS_ORDER.map((s) => ({
  value: s,
  label: STATUS_LABEL[s] ?? s,
  icon: (
    <span
      aria-hidden="true"
      className="size-[7px] shrink-0 rounded-full"
      style={{ background: STATUS_TOKEN[s] }}
    />
  ),
}));

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
};

export const PRIORITY_OPTIONS = (Object.values(TaskPriority) as TaskPriority[]).map((p) => ({
  value: p,
  label: PRIORITY_LABEL[p],
}));

export const VISIBILITY_OPTIONS = [
  {
    value: TaskVisibility.ORG,
    label: "Everyone",
    icon: <Globe className="size-[15px]" aria-hidden="true" />,
  },
  {
    value: TaskVisibility.PRIVATE,
    label: "Private",
    icon: <Lock className="size-[15px]" aria-hidden="true" />,
  },
] as const;

/* ----------------------------------------------------------------- people */

function firstName(m: MemberOption | undefined): string {
  return m?.name?.trim().split(/\s+/)[0] ?? "Member";
}

const RELATION_HINT: Partial<Record<string, string>> = {
  SELF: "You",
  DOWN_LINE: "Your team",
  ABOVE: "Above you",
};

function MemberHint({ member }: { member: MemberOption }) {
  const { viewer } = useTasks();
  const relation = relationFor(viewer.chart, member.id);
  const hint = RELATION_HINT[relation] ?? member.title;
  if (!hint) return null;
  return (
    <small
      className={cn(
        "ms-auto inline-flex shrink-0 items-center gap-1 text-xs font-normal",
        relation === "ABOVE" ? "text-warning" : "text-muted-foreground",
      )}
    >
      {relation === "ABOVE" && <TriangleAlert className="size-3" aria-hidden="true" />}
      <span className="max-w-28 truncate">{hint}</span>
    </small>
  );
}

/**
 * The people menus' search box. It narrows the list as you type and runs it
 * from the keyboard: ↑/↓ move through the matches, Enter picks the
 * highlighted one (the first, until you move). After a pick the box clears
 * and keeps focus, so in the multi-pick menu you type the next name straight
 * away; Backspace in an empty box hands back to `onRemoveLast`. The box shows
 * when the list is long, or always with `always`.
 */
export function useMemberSearch(
  members: MemberOption[],
  {
    onPick,
    onRemoveLast,
    always = false,
  }: {
    onPick: (member: MemberOption) => void;
    onRemoveLast?: () => void;
    always?: boolean;
  },
) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return members;
    return members.filter((m) => `${m.name ?? ""} ${m.title ?? ""}`.toLowerCase().includes(needle));
  }, [members, q]);
  const current = filtered.length === 0 ? -1 : Math.min(active, filtered.length - 1);
  const optionId = (m: MemberOption) => `${listId}-${m.id}`;

  const reset = () => {
    setQ("");
    setActive(0);
  };
  const pick = (m: MemberOption) => {
    onPick(m);
    reset();
    inputRef.current?.focus();
  };

  const input =
    always || members.length > 8 ? (
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            if (filtered.length === 0) return;
            const step = e.key === "ArrowDown" ? 1 : -1;
            const next = (current + step + filtered.length) % filtered.length;
            setActive(next);
            document
              .getElementById(optionId(filtered[next]!))
              ?.scrollIntoView({ block: "nearest" });
          } else if (e.key === "Enter") {
            e.preventDefault();
            const m = filtered[current];
            if (m) pick(m);
          } else if (e.key === "Backspace" && q === "" && onRemoveLast) {
            e.preventDefault();
            onRemoveLast();
          }
        }}
        placeholder="Type a name"
        aria-label="Find someone"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded="true"
        aria-controls={listId}
        aria-activedescendant={filtered[current] ? optionId(filtered[current]) : undefined}
        className="bg-background border-input placeholder:text-muted-foreground focus-visible:border-primary/70 mb-1 h-8 rounded-md border px-2.5 text-[13px] outline-none"
      />
    ) : null;

  return {
    filtered,
    input,
    listId,
    optionId,
    /** The highlighted row, when the search box is there to drive it. */
    isActive: (i: number) => input !== null && i === current,
    hover: (i: number) => setActive(i),
    pick,
    reset,
    focus: () => inputRef.current?.focus(),
  };
}

/**
 * The owner. The same drop-down as PeopleField below it in every respect —
 * the same well, heading, search box, rows and footer — because on the task
 * form they sit side by side, and two pickers of people that look different
 * read as two different kinds of thing. The only difference is what they
 * mean: one person here, any number there.
 */
export function OwnerField({
  id,
  value,
  onChange,
  disabled,
  allowNone = true,
}: {
  id?: string;
  value: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
  allowNone?: boolean;
}) {
  const { members, memberById } = useTasks();
  const [open, setOpen] = useState(false);
  const owner = value ? memberById.get(value) : undefined;
  const search = useMemberSearch(members, {
    always: true,
    onPick: (m) => {
      onChange(m.id);
      setOpen(false);
    },
    onRemoveLast: () => allowNone && onChange(null),
  });

  return (
    <Popover open={open} onOpenChange={(o) => (setOpen(o), o || search.reset())}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          disabled={disabled}
          aria-label="Owner"
          className={wellClass(open, !owner)}
        >
          {owner && (
            <span className="flex shrink-0 pe-1">
              <UserAvatar user={owner} size="xs" className="ring-card -me-1.5 ring-2" />
            </span>
          )}
          <span className="truncate">{owner ? firstName(owner) : "No owner"}</span>
          <UpDown />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className={MENU}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          search.focus();
        }}
      >
        <MenuHeading>Owner</MenuHeading>
        {owner && (
          <div className="flex flex-wrap gap-1 px-1 pb-1.5">
            <span className="bg-muted inline-flex h-6 items-center gap-1 rounded-md ps-0.5 pe-0.5 text-xs font-medium">
              <UserAvatar user={owner} size="xs" />
              {firstName(owner)}
              {allowNone && (
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={`Remove ${owner.name ?? "member"}`}
                  onClick={() => {
                    onChange(null);
                    search.focus();
                  }}
                  className="text-muted-foreground hover:text-foreground hover:bg-background rounded p-0.5"
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              )}
            </span>
          </div>
        )}
        {search.input}
        <div
          id={search.listId}
          role="listbox"
          aria-label="Owner"
          className="flex max-h-72 flex-col gap-px overflow-y-auto"
        >
          {search.filtered.length === 0 && (
            <p className="text-muted-foreground px-2 py-2 text-[13px]">Nobody by that name.</p>
          )}
          {search.filtered.map((m, i) => {
            const on = m.id === value;
            return (
              <button
                key={m.id}
                id={search.optionId(m)}
                type="button"
                role="option"
                aria-selected={on}
                className={cn(menuItemClass(on), search.isActive(i) && "bg-muted")}
                onPointerMove={() => search.hover(i)}
                onClick={() => search.pick(m)}
              >
                <UserAvatar user={m} size="xs" />
                <span className="truncate">{m.name ?? "Member"}</span>
                {on ? (
                  <Check className="text-primary ms-auto size-3.5 shrink-0" aria-hidden="true" />
                ) : (
                  <MemberHint member={m} />
                )}
              </button>
            );
          })}
        </div>
        <p className="text-muted-foreground mt-1 border-t px-2 pt-1.5 text-[11px]">
          Enter picks · Backspace clears · Esc closes
        </p>
      </PopoverContent>
    </Popover>
  );
}

export function PeopleField({
  id,
  value,
  onChange,
  exclude,
  disabled,
}: {
  id?: string;
  value: string[];
  onChange: (ids: string[]) => void;
  /** The owner, who is already on the task. */
  exclude: string | null;
  disabled?: boolean;
}) {
  const { members, memberById } = useTasks();
  const [open, setOpen] = useState(false);
  const choices = members.filter((m) => m.id !== exclude);
  const picked = value
    .filter((v) => v !== exclude)
    .map((v) => memberById.get(v))
    .filter(Boolean) as MemberOption[];
  const toggle = (userId: string) =>
    onChange(value.includes(userId) ? value.filter((v) => v !== userId) : [...value, userId]);
  // Type a name, Enter, type the next: the box clears and keeps focus after each.
  const search = useMemberSearch(choices, {
    always: true,
    onPick: (m) => toggle(m.id),
    onRemoveLast: () => {
      const last = picked.at(-1);
      if (last) toggle(last.id);
    },
  });
  return (
    <Popover open={open} onOpenChange={(o) => (setOpen(o), o || search.reset())}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          disabled={disabled}
          aria-label="Involved people"
          className={wellClass(open, picked.length === 0)}
        >
          {picked.length > 0 && (
            <span className="flex shrink-0 pe-1">
              {picked.slice(0, 3).map((m) => (
                <UserAvatar key={m.id} user={m} size="xs" className="ring-card -me-1.5 ring-2" />
              ))}
            </span>
          )}
          <span className="truncate">
            {picked.length === 0 ? "Nobody else" : picked.map((m) => firstName(m)).join(", ")}
          </span>
          <UpDown />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className={MENU}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          search.focus();
        }}
      >
        <MenuHeading>Add people</MenuHeading>
        {picked.length > 0 && (
          <div className="flex flex-wrap gap-1 px-1 pb-1.5">
            {picked.map((m) => (
              <span
                key={m.id}
                className="bg-muted inline-flex h-6 items-center gap-1 rounded-md ps-0.5 pe-0.5 text-xs font-medium"
              >
                <UserAvatar user={m} size="xs" />
                {firstName(m)}
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={`Remove ${m.name ?? "member"}`}
                  onClick={() => {
                    toggle(m.id);
                    search.focus();
                  }}
                  className="text-muted-foreground hover:text-foreground hover:bg-background rounded p-0.5"
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        )}
        {search.input}
        <div
          id={search.listId}
          role="listbox"
          aria-multiselectable="true"
          aria-label="Involved people"
          className="flex max-h-72 flex-col gap-px overflow-y-auto"
        >
          {search.filtered.length === 0 && (
            <p className="text-muted-foreground px-2 py-2 text-[13px]">Nobody by that name.</p>
          )}
          {search.filtered.map((m, i) => {
            const on = value.includes(m.id);
            return (
              <button
                key={m.id}
                id={search.optionId(m)}
                type="button"
                role="option"
                aria-selected={on}
                className={cn(menuItemClass(on), search.isActive(i) && "bg-muted")}
                onPointerMove={() => search.hover(i)}
                onClick={() => search.pick(m)}
              >
                <UserAvatar user={m} size="xs" />
                <span className="truncate">{m.name ?? "Member"}</span>
                {on ? (
                  <Check className="text-primary ms-auto size-3.5 shrink-0" aria-hidden="true" />
                ) : (
                  <MemberHint member={m} />
                )}
              </button>
            );
          })}
        </div>
        <p className="text-muted-foreground mt-1 border-t px-2 pt-1.5 text-[11px]">
          Enter adds · Backspace removes · Esc closes
        </p>
      </PopoverContent>
    </Popover>
  );
}

/* --------------------------------------------------------------- due date */

const shortFmt = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const longFmt = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const monthFmt = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

const asDate = (key: string) => new Date(`${key}T00:00:00Z`);
const pad = (n: number) => String(n).padStart(2, "0");
/** "Fri, Oct 16". */
export const shortDue = (key: string) => shortFmt.format(asDate(key));
/** "Friday, Oct 16". */
export const longDue = (key: string) => longFmt.format(asDate(key));

/** The due-date menu: type a date, pick a quick one, or pick a day on the month. */
export function DueMenu({
  value,
  onPick,
  clearLabel = "No due date",
}: {
  value: string;
  /** "" clears the date. */
  onPick: (key: string) => void;
  clearLabel?: string;
}) {
  const { org } = useTasks();
  const today = org.todayKey;
  const [typed, setTyped] = useState("");
  const [month, setMonth] = useState((value || today).slice(0, 7));
  const parsed = parseDueText(typed, today);
  const quick = quickDues(today);

  const first = `${month}-01`;
  const lead = weekdayOfKey(first);
  const start = addDaysToKey(first, -lead);
  const cells = Array.from({ length: 42 }, (_, i) => addDaysToKey(start, i));
  const rows = cells.slice(35).every((k) => k.slice(0, 7) !== month) ? cells.slice(0, 35) : cells;
  const shift = (by: number) => {
    const [y, mo] = month.split("-").map(Number);
    const d = new Date(Date.UTC(y, mo - 1 + by, 1));
    setMonth(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`);
  };

  return (
    <div
      className="flex flex-col gap-px"
      onKeyDown={(e) => {
        if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
        const hit = quick.find((q) => q.shortcut.toLowerCase() === e.key.toLowerCase());
        if (hit) {
          e.preventDefault();
          onPick(hit.key);
        }
      }}
    >
      <label htmlFor="due-typed" className="sr-only">
        Type a date
      </label>
      <input
        id="due-typed"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && parsed) {
            e.preventDefault();
            onPick(parsed);
          }
        }}
        placeholder="Try “next thu” or “in 3 days”"
        className="bg-background border-input placeholder:text-muted-foreground focus-visible:border-ring mb-1 h-8 rounded-md border px-2.5 text-[13px] outline-none"
      />
      {typed && (
        <button
          type="button"
          disabled={!parsed}
          className={cn(menuItemClass(), !parsed && "text-muted-foreground")}
          onClick={() => parsed && onPick(parsed)}
        >
          {parsed ? longDue(parsed) : "Not a date I know"}
          {parsed && (
            <small className="text-muted-foreground ms-auto text-xs font-normal">Enter</small>
          )}
        </button>
      )}
      {quick.map((q) => (
        <button
          key={q.label}
          type="button"
          className={menuItemClass(value === q.key)}
          onClick={() => onPick(q.key)}
        >
          {q.label}
          <small className="text-muted-foreground ms-auto inline-flex items-center gap-2 text-xs font-normal">
            {shortDue(q.key)}
            <kbd className="border-border rounded-[4px] border px-1 font-mono text-[10px] leading-4">
              {q.shortcut}
            </kbd>
          </small>
        </button>
      ))}
      <button
        type="button"
        className={cn(menuItemClass(), "text-muted-foreground")}
        onClick={() => onPick("")}
      >
        {clearLabel}
      </button>
      <div className="bg-border mx-1 my-1.5 h-px" />
      <div className="flex items-center justify-between px-1.5 pb-1.5">
        <span className="text-foreground/90 text-xs font-semibold">
          {monthFmt.format(asDate(first))}
        </span>
        <span className="flex">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => shift(-1)}
            className="text-muted-foreground hover:bg-muted hover:text-foreground grid size-6 place-items-center rounded-md"
          >
            <ChevronLeft className="size-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => shift(1)}
            className="text-muted-foreground hover:bg-muted hover:text-foreground grid size-6 place-items-center rounded-md"
          >
            <ChevronRight className="size-3.5" aria-hidden="true" />
          </button>
        </span>
      </div>
      <div
        className="text-muted-foreground grid grid-cols-7 gap-0.5 pb-0.5 text-center text-[10px]"
        aria-hidden="true"
      >
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {rows.map((k) => {
          const inMonth = k.slice(0, 7) === month;
          const selected = k === value;
          return (
            <button
              key={k}
              type="button"
              aria-label={longDue(k)}
              aria-pressed={selected}
              onClick={() => onPick(k)}
              className={cn(
                "h-7 rounded-md text-xs font-medium transition-colors",
                selected
                  ? "bg-primary text-primary-foreground"
                  : inMonth
                    ? "text-foreground/85 hover:bg-muted"
                    : "text-muted-foreground/50 hover:bg-muted",
                !selected && k === today && "ring-border ring-1 ring-inset",
              )}
            >
              {Number(k.slice(8))}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function DueField({
  id,
  value,
  onChange,
  disabled,
  label = "Due date",
  emptyLabel = "No due date",
}: {
  id?: string;
  value: string;
  onChange: (key: string) => void;
  disabled?: boolean;
  /** The same picker for another date (the start date). */
  label?: string;
  emptyLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          disabled={disabled}
          aria-label={label}
          className={wellClass(open, !value)}
        >
          <Calendar className="text-muted-foreground size-[15px] shrink-0" aria-hidden="true" />
          <span className="truncate">{value ? shortDue(value) : emptyLabel}</span>
          <UpDown />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className={MENU}>
        <DueMenu
          value={value}
          clearLabel={emptyLabel}
          onPick={(k) => {
            onChange(k);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/* ------------------------------------------------------------------ epics */

export { epicColor };

/**
 * "Part of": the epic (or, for a task, the story) it sits in. `current` is
 * its parent as loaded, shown even when the pickers' list doesn't carry it
 * (a private story, say). Changing it moves the task (updateTask checks
 * the hierarchy again).
 */
export function PartOfField({
  id,
  value,
  onChange,
  types,
  disabled,
  current,
  excludeId,
}: {
  id?: string;
  value: string | null;
  onChange: (id: string | null) => void;
  types: readonly ("EPIC" | "STORY")[];
  disabled?: boolean;
  current?: { id: string; title: string; type: string; color?: string | null } | null;
  excludeId?: string;
}) {
  const { parentById } = useTasks();
  const [open, setOpen] = useState(false);
  const picked = value
    ? (parentById.get(value) ?? (current?.id === value ? current : undefined))
    : undefined;
  const storyEpicId =
    picked && picked.type === "STORY" && "parentTaskId" in picked
      ? (picked.parentTaskId as string | null)
      : null;
  const epic = storyEpicId ? parentById.get(storyEpicId) : undefined;
  const pick = (next: string | null) => {
    onChange(next);
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          disabled={disabled}
          aria-label="Part of"
          className={wellClass(open, !picked)}
        >
          {picked?.type === "STORY" ? (
            <EpicDot epic={epic ?? null} />
          ) : (
            <EpicDot epic={picked ?? null} />
          )}
          <span className="truncate">
            {picked ? (
              <>
                {epic && <span className="text-muted-foreground font-normal">{epic.title} / </span>}
                {picked.title}
              </>
            ) : types.includes("STORY") ? (
              "Not in an epic or story"
            ) : (
              "Not in an epic"
            )}
          </span>
          <UpDown />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className={MENU}>
        <ParentMenu
          value={value}
          onPick={pick}
          types={types}
          excludeId={excludeId}
          noneLabel={types.includes("STORY") ? "Not in an epic or story" : "Not in an epic"}
        />
      </PopoverContent>
    </Popover>
  );
}

/* ------------------------------------------------------------------- tags */

/** A tag on a task (stored as a Label): the shared TagChip. */
export function LabelChip({ label }: { label: LabelOption }) {
  return <TagChip color={label.color}>{label.name}</TagChip>;
}

/** The Tags field: the task's tags as chips, opening the tag menu (find, toggle, create). */
export function LabelsField({
  id,
  labels,
  value,
  onChange,
  disabled,
}: {
  id?: string;
  labels: LabelOption[];
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const picked = value
    .map((v) => labels.find((l) => l.id === v))
    .filter((l): l is LabelOption => Boolean(l));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          disabled={disabled}
          aria-label="Tags"
          className={wellClass(open, picked.length === 0)}
        >
          {picked.length > 0 ? (
            <span className="flex min-w-0 gap-1 overflow-hidden">
              {picked.map((l) => (
                <LabelChip key={l.id} label={l} />
              ))}
            </span>
          ) : (
            <span>Add a tag</span>
          )}
          <UpDown />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        className={cn(MENU, "w-[max(var(--radix-popover-trigger-width),280px)]")}
      >
        <TagMenu value={value} onChange={onChange} />
      </PopoverContent>
    </Popover>
  );
}
