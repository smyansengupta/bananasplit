"use client";

import { Check, ChevronsUpDown, TriangleAlert, Users, X } from "@/components/icons";
import { useId, useMemo, useRef, useState, type ReactNode } from "react";

import { TagChip } from "@/components/ui/chip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { UserAvatar } from "@/components/user-avatar";
import { TaskPriority, TaskStatus } from "@/generated/prisma/enums";
import { relationFor } from "@/lib/tasks/assignment";
import { epicColor } from "@/lib/tasks/epic";
import { cn } from "@/lib/utils";

import { STATUS_LABEL, STATUS_TOKEN } from "./layout-ui";
import { TagMenu } from "./tag-menu";
import { useTasks } from "./tasks-context";
import type { LabelOption, MemberOption } from "./types";

/**
 * The task form's pickers (TaskFormFields lays them out): the owner, the
 * people, the tags, and the status and priority choices. The pickers are
 * tall rounded wells that open a menu. Everything takes the theme's tokens,
 * so it follows the organization's colours in light and dark.
 */

/* ------------------------------------------------------------- primitives */

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
 * mean: one person here, any number there. No owner means anyone can take
 * it, and that's a choice of its own at the top of the list.
 */
export function OwnerField(props: {
  id?: string;
  value: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
}) {
  const { members } = useTasks();
  return <MemberOwnerField {...props} members={members} hint={(m) => <MemberHint member={m} />} />;
}

/**
 * OwnerField without Tasks around it: the same well, menu and keyboard for
 * any list of members (the CRM's New person, company and deal use it, so an
 * owner is picked the same way everywhere). `hint` is the quiet line at the
 * end of a row; by default the member's title. `none` names having no owner
 * (a task: anyone can take it); `allowNone={false}` takes that choice away.
 */
export function MemberOwnerField({
  id,
  value,
  onChange,
  disabled,
  allowNone = true,
  members,
  hint,
  none = { well: "Anyone", option: "Anyone can take it" },
  label = "Owner",
}: {
  id?: string;
  value: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
  allowNone?: boolean;
  members: MemberOption[];
  hint?: (member: MemberOption) => ReactNode;
  none?: { well: string; option: string };
  /** What's being picked, when it isn't an owner (a goal's Who). */
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const owner = value ? members.find((m) => m.id === value) : undefined;
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
          aria-label={label}
          className={wellClass(open, !owner)}
        >
          {owner && (
            <span className="flex shrink-0 pe-1">
              <UserAvatar user={owner} size="xs" className="ring-card -me-1.5 ring-2" />
            </span>
          )}
          {!owner && <Users className="size-3.5 shrink-0" aria-hidden="true" />}
          <span className="truncate">{owner ? firstName(owner) : none.well}</span>
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
        <MenuHeading>{label}</MenuHeading>
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
          {allowNone && (
            <button
              type="button"
              role="option"
              aria-selected={value === null}
              className={menuItemClass(value === null)}
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
            >
              <Users className="size-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{none.option}</span>
              {value === null && (
                <Check className="text-primary ms-auto size-3.5 shrink-0" aria-hidden="true" />
              )}
            </button>
          )}
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
                ) : hint ? (
                  hint(m)
                ) : (
                  m.title && (
                    <small className="text-muted-foreground ms-auto max-w-28 shrink-0 truncate text-xs font-normal">
                      {m.title}
                    </small>
                  )
                )}
              </button>
            );
          })}
        </div>
        <p className="text-muted-foreground mt-1 border-t px-2 pt-1.5 text-[11px]">
          Enter picks, Backspace clears, Esc closes
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
          Enter adds, Backspace removes, Esc closes
        </p>
      </PopoverContent>
    </Popover>
  );
}

/* ------------------------------------------------------------------ epics */

export { epicColor };

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
