"use client";

import {
  Check,
  GanttChart,
  ListTree,
  ChevronDown,
  Columns3,
  Layers,
  Gauge,
  ListFilter,
  Lock,
  Table2,
  Tag,
  UserRound,
  UsersRound,
  Globe,
  Rows3,
  X,
} from "@/components/icons";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import { PHONE_HIDDEN_LAYOUTS, type TaskLayout } from "@/app/app/[orgSlug]/tasks/views";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { UserAvatar } from "@/components/user-avatar";
import { FilterChoices, FilterSheet, PhoneToolbar } from "@/components/ui/phone-toolbar";
import { SearchField } from "@/components/ui/search-field";
import { chipClass, Segmented } from "@/components/ui/segmented";
import { TaskStatus, TaskVisibility } from "@/generated/prisma/enums";
import { hasModifier, isTypingTarget, overlayOpen, SCOPE_KEYS, TASK_KEYS } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

import { STATUS_LABEL as STATUS_LABELS } from "./layout-ui";
import { EpicDot, ParentMenu } from "./epic-menu";
import { menuItemClass, useMemberSearch } from "./task-fields";
import { useTasks, useWorkspace } from "./tasks-context";

/**
 * The one toolbar (C4).
 *
 * Every layout reads the same query, so this bar is the whole navigation:
 * which layout, whose work, and which tasks. It writes to the URL, which
 * means a filtered view is a link you can paste into Slack, and going back
 * really goes back.
 *
 * The bar reads left to right the same on every page that copies it:
 * layout, whose work, then the filters as chips you click once (Person,
 * Epic, Tag, Status), then search at the end. Every control is 40px tall.
 *
 * A phone gets its own one-row bar (MobileToolbar): whose work, the layouts
 * a phone has, Filters (a sheet with every filter, each under its name) and
 * search.
 */

const LAYOUT_ICONS = {
  board: Columns3,
  list: ListTree,
  roadmap: GanttChart,
  table: Table2,
  dashboard: Gauge,
} as const;

export function WorkspaceToolbar() {
  const { org, labels, parentById, members } = useTasks();
  const ws = useWorkspace();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null);

  // `/` focuses search from anywhere that is not already a field.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || isTypingTarget(event)) return;
      if (event.key === "/" && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const commitSearch = useCallback(
    (value: string) => startTransition(() => ws.setFilters({ q: value || undefined })),
    [ws],
  );

  const activeEpic = ws.query.epicId ? parentById.get(ws.query.epicId) : null;
  const activeLabel = ws.query.labelId ? labels.find((l) => l.id === ws.query.labelId) : null;
  const pinnedPerson = ws.query.ownerId ?? ws.query.assigneeId;
  const pinnedMember = pinnedPerson ? members.find((m) => m.id === pinnedPerson) : null;

  return (
    <div className="space-y-3">
      <MobileToolbar
        onCommitSearch={commitSearch}
        clearAll={() => router.push(`/app/${org.slug}/tasks?view=${ws.query.view}`)}
      />
      {/*
        A container, not a viewport breakpoint. What makes this bar tighten is
        the room it actually has, and that is not the window: docking or
        railing the sidebar moves it by 150px, and a MacBook with the sidebar
        out had the filters pushed onto a second row while the same window on
        a desktop was fine. Everything below steps down on @[…]/toolbar.

        Two things keep it whole at every width. It wraps rather than
        overflowing, and the search block asks for 12rem, so when the rest of
        the bar leaves less than that the search drops onto its own line
        whole, instead of being squeezed to a slot nobody can type in. And
        the layout names only appear with the room for them: six names are
        most of the bar's width, and each button keeps its icon and its
        tooltip without them.
      */}
      <div className="@container/toolbar max-md:hidden">
        <div className="flex flex-wrap items-center gap-2">
          {/* Layout: three shapes of the same question (none on the Free plan). */}
          {ws.layouts.length > 0 && (
            <Segmented
              label="Layout"
              value={ws.query.view}
              onSelect={(v) => ws.setView(v as (typeof ws.layouts)[number]["value"])}
              options={ws.layouts.map((layout, index) => ({
                value: layout.value,
                label: layout.label,
                icon: LAYOUT_ICONS[layout.value],
                compact: true,
                title: `${layout.label}: ${layout.hint} (${index + 1})`,
              }))}
              // The first thing to go when the bar tightens.
              labelsFrom="sr-only @[64rem]/toolbar:not-sr-only"
              className="shrink-0"
            />
          )}

          {/*
            Scope: whose work, named (Mine, My team, Everyone). The team
            option only exists if you have reports. The names give way to
            icons only when the bar itself is tight.
          */}
          <Segmented
            label="Whose tasks"
            value={pinnedMember ? "" : ws.query.scope}
            onSelect={(v) => ws.setScope(v as (typeof ws.scopes)[number]["value"])}
            options={ws.scopes.map((scope) => ({
              value: scope.value,
              label: scope.label,
              icon: SCOPE_ICONS[scope.value],
              compact: true,
              title: SCOPE_KEYS[scope.value]
                ? `${scope.label} (${SCOPE_KEYS[scope.value]})`
                : scope.label,
            }))}
            labelsFrom="sr-only @[52rem]/toolbar:not-sr-only"
            className="shrink-0"
          />

          {/* The filters, each one click away. */}
          {members.length > 1 && <PersonFilter />}
          <EpicFilter />
          {labels.length > 0 && <TagFilter />}
          <StatusFilter />

          <div className="ms-auto flex min-w-48 flex-1 items-center justify-end gap-2">
            {/* The board's lanes: one per epic, or none. */}
            {ws.query.view === "board" && <EpicLanesToggle />}
            <TaskSearch
              key={ws.query.q ?? ""}
              inputRef={searchRef}
              initial={ws.query.q ?? ""}
              onCommit={commitSearch}
            />
          </div>
        </div>
      </div>

      {/* What is currently narrowing the view, each removable on its own. */}
      {(ws.filterCount > 0 || activeEpic) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {activeEpic && (
            <FilterPill
              label={activeEpic.title}
              onClear={() => ws.setFilters({ epicId: undefined })}
            />
          )}
          {ws.query.status && (
            <FilterPill
              label={
                ws.query.status === "open"
                  ? "Open"
                  : (STATUS_LABELS[ws.query.status] ?? ws.query.status)
              }
              onClear={() => ws.setFilters({ status: undefined })}
            />
          )}
          {ws.query.visibility && (
            <FilterPill
              icon={
                ws.query.visibility === TaskVisibility.PRIVATE ? (
                  <Lock className="size-3" aria-hidden="true" />
                ) : undefined
              }
              label={ws.query.visibility === TaskVisibility.PRIVATE ? "Private" : "Everyone"}
              onClear={() => ws.setFilters({ visibility: undefined })}
            />
          )}
          {activeLabel && (
            <FilterPill
              icon={
                <span
                  aria-hidden="true"
                  className="size-2 rounded-full"
                  style={{ backgroundColor: activeLabel.color }}
                />
              }
              label={activeLabel.name}
              onClear={() => ws.setFilters({ labelId: undefined })}
            />
          )}
          {pinnedMember && (
            <FilterPill
              label={`${pinnedMember.name ?? "Someone"}${ws.query.ownerId ? " (owns)" : ""}`}
              onClear={() => ws.setFilters({ ownerId: undefined, assigneeId: undefined })}
            />
          )}
          {ws.query.blockers && (
            <FilterPill label="Blockers" onClear={() => ws.setFilters({ blockers: false })} />
          )}
          {ws.query.overdue && (
            <FilterPill label="Overdue" onClear={() => ws.setFilters({ overdue: false })} />
          )}
          {ws.query.flagged && (
            <FilterPill label="Flagged" onClear={() => ws.setFilters({ flagged: false })} />
          )}
          {ws.query.unowned && (
            <FilterPill label="No owner" onClear={() => ws.setFilters({ unowned: false })} />
          )}
          {ws.query.q && (
            <FilterPill label={`“${ws.query.q}”`} onClear={() => ws.setFilters({ q: undefined })} />
          )}
          {(ws.query.dueFrom || ws.query.dueTo) && (
            <FilterPill
              label={
                ws.query.dueFrom && ws.query.dueTo
                  ? `Due ${ws.query.dueFrom} to ${ws.query.dueTo}`
                  : ws.query.dueTo
                    ? `Due by ${ws.query.dueTo}`
                    : `Due from ${ws.query.dueFrom}`
              }
              onClear={() => ws.setFilters({ dueFrom: undefined, dueTo: undefined })}
            />
          )}
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground ms-1 text-xs underline-offset-4 hover:underline"
            onClick={() => {
              router.push(`/app/${org.slug}/tasks?view=${ws.query.view}`);
            }}
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The toolbar below md, the phone's one list toolbar (PhoneToolbar, as on
 * Files and People): whose work as icons you flip between (Mine, My team,
 * Everyone; their names are on them for screen readers and show from sm
 * up), the layout picker, Filters (a FilterSheet: person, epic, tag,
 * status, visibility, each under its name, with a count on the button),
 * and a search icon that opens the search box over the row.
 *
 * The layouts are the ones a phone has (not the Board or Table: the page
 * and the effect below see to it).
 *
 * The sheet's contents mount only while it is open, so its person filter
 * doesn't add a second `p` shortcut behind the desktop one.
 */
function MobileToolbar({
  onCommitSearch,
  clearAll,
}: {
  onCommitSearch: (value: string) => void;
  clearAll: () => void;
}) {
  const { members, labels } = useTasks();
  const ws = useWorkspace();
  const router = useRouter();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const pinnedPerson = ws.query.ownerId ?? ws.query.assigneeId;
  const count = ws.filterCount + (ws.query.epicId ? 1 : 0);

  // A phone the page didn't recognise (a narrow desktop window, say) still
  // leaves the Board and Table. replace, and no cookie: the desktop keeps
  // its layout.
  const { view } = ws.query;
  const { hrefWith } = ws;
  useEffect(() => {
    if (!(PHONE_HIDDEN_LAYOUTS as readonly string[]).includes(view)) return;
    if (!window.matchMedia("(max-width: 767px)").matches) return;
    router.replace(hrefWith({ view: "list" }), { scroll: false });
  }, [view, hrefWith, router]);
  // The List first: it is a phone's main layout.
  const layouts = ws.layouts
    .filter((l) => !PHONE_HIDDEN_LAYOUTS.includes(l.value))
    .sort((a, b) => Number(b.value === "list") - Number(a.value === "list"));

  return (
    <>
      <PhoneToolbar
        middle={
          layouts.length > 1 && (
            // The layouts a phone has, side by side: one tap each.
            <Segmented
              label="Layout"
              value={ws.query.view}
              onSelect={(v) => ws.setView(v as TaskLayout)}
              options={layouts.map((l) => ({
                value: l.value,
                label: l.label,
                title: l.label,
              }))}
              className="w-full min-w-0 [&>button]:flex-1 [&>button]:justify-center"
            />
          )
        }
        leading={
          <Segmented
            label="Whose tasks"
            value={pinnedPerson ? "" : ws.query.scope}
            onSelect={(v) => ws.setScope(v as (typeof ws.scopes)[number]["value"])}
            options={ws.scopes.map((scope) => ({
              value: scope.value,
              label: scope.label,
              icon: SCOPE_ICONS[scope.value],
              compact: true,
              title: scope.label,
            }))}
            className="[&>button]:px-2.5"
          />
        }
        filterCount={count}
        onFilters={() => setFiltersOpen(true)}
        searchLabel="Search tasks"
        searchActive={Boolean(ws.query.q)}
        search={
          <TaskSearch
            key={ws.query.q ?? ""}
            initial={ws.query.q ?? ""}
            onCommit={onCommitSearch}
            className="w-full"
            hint=""
            autoFocus
          />
        }
        onCancelSearch={() => {
          if (ws.query.q) onCommitSearch("");
        }}
      />

      <FilterSheet
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        title="Filters"
        canClear={count > 0}
        onClear={clearAll}
      >
        <div className="flex flex-wrap gap-2">
          {members.length > 1 && <PersonFilter />}
          <EpicFilter />
          {labels.length > 0 && <TagFilter />}
        </div>
        <FilterChoices
          title="Status"
          value={ws.query.status ?? ""}
          onPick={(v) =>
            ws.setFilters({ status: (v || undefined) as TaskStatus | "open" | undefined })
          }
          options={[
            { value: "", label: "Any" },
            { value: "open", label: "Open" },
            ...Object.values(TaskStatus).map((s) => ({ value: s, label: STATUS_LABELS[s] })),
          ]}
        />
        <FilterChoices
          title="Needs a look"
          value={
            ws.query.overdue
              ? "overdue"
              : ws.query.flagged
                ? "flagged"
                : ws.query.unowned
                  ? "unowned"
                  : ""
          }
          onPick={(v) =>
            ws.setFilters({
              overdue: v === "overdue",
              flagged: v === "flagged",
              unowned: v === "unowned",
            })
          }
          options={[
            { value: "", label: "Any" },
            { value: "overdue", label: "Overdue" },
            { value: "flagged", label: "Flagged" },
            { value: "unowned", label: "No owner" },
          ]}
        />
        <FilterChoices
          title="Visibility"
          value={ws.query.visibility ?? ""}
          onPick={(v) => ws.setFilters({ visibility: (v || undefined) as TaskVisibility })}
          options={[
            { value: "", label: "Any" },
            { value: TaskVisibility.ORG, label: "Everyone" },
            { value: TaskVisibility.PRIVATE, label: "Private" },
          ]}
        />
      </FilterSheet>
    </>
  );
}

/**
 * Filter by epic, as a pill of its own so it is there even before the club
 * has an epic: its menu can make the first one.
 */
function EpicFilter() {
  const { parentById } = useTasks();
  const ws = useWorkspace();
  const [open, setOpen] = useState(false);
  const epic = ws.query.epicId ? parentById.get(ws.query.epicId) : undefined;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={epic ? `Filtered to epic ${epic.title}` : "Filter by epic"}
          className={chipClass(Boolean(epic))}
        >
          {epic ? <EpicDot epic={epic} /> : <Layers className="size-3.5" aria-hidden="true" />}
          <span className="max-w-48 text-start break-words">{epic?.title ?? "Epic"}</span>
          <ChevronDown className="size-3 opacity-60" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 gap-px p-1.5">
        <ParentMenu
          value={ws.query.epicId ?? null}
          noneLabel="All epics"
          onPick={(id) => {
            ws.setFilters({ epicId: id ?? undefined });
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/** Filter by tag (one at a time, ?label=). */
function TagFilter() {
  const { labels } = useTasks();
  const ws = useWorkspace();
  const [open, setOpen] = useState(false);
  const tag = ws.query.labelId ? labels.find((l) => l.id === ws.query.labelId) : undefined;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={tag ? `Filtered to tag ${tag.name}` : "Filter by tag"}
          className={chipClass(Boolean(tag))}
        >
          {tag ? (
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-full"
              style={{ background: tag.color }}
            />
          ) : (
            <Tag className="size-3.5" aria-hidden="true" />
          )}
          <span className="max-w-48 text-start break-words">{tag?.name ?? "Tag"}</span>
          <ChevronDown className="size-3 opacity-60" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 gap-px p-1.5">
        <div
          role="listbox"
          aria-label="Tag"
          className="flex max-h-72 flex-col gap-px overflow-y-auto"
        >
          <button
            type="button"
            role="option"
            aria-selected={!tag}
            className={menuItemClass(!tag)}
            onClick={() => (ws.setFilters({ labelId: undefined }), setOpen(false))}
          >
            Any tag
            {!tag && <Check className="ms-auto size-3.5" aria-hidden="true" />}
          </button>
          {labels.map((l) => (
            <button
              key={l.id}
              type="button"
              role="option"
              aria-selected={l.id === tag?.id}
              className={menuItemClass(l.id === tag?.id)}
              onClick={() => (ws.setFilters({ labelId: l.id }), setOpen(false))}
            >
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full"
                style={{ background: l.color }}
              />
              <span className="break-words">{l.name}</span>
              {l.id === tag?.id && <Check className="ms-auto size-3.5" aria-hidden="true" />}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Filter by person: every layout narrowed to one member's tasks, the ones
 * they own or are involved in (or, ticked, only the ones they own). It
 * writes ?assignee= or ?owner=, the links the People pages already publish,
 * so a filtered board is a link you can share. `p` opens it; type a name and
 * press Enter.
 */
function PersonFilter() {
  const { members, memberById } = useTasks();
  const ws = useWorkspace();
  const [open, setOpen] = useState(false);
  const personId = ws.query.ownerId ?? ws.query.assigneeId;
  const person = personId ? memberById.get(personId) : undefined;
  const [ownedOnly, setOwnedOnly] = useState(Boolean(ws.query.ownerId));

  const choose = (userId: string | undefined, owned = ownedOnly) =>
    ws.setFilters(
      owned
        ? { ownerId: userId, assigneeId: undefined }
        : { assigneeId: userId, ownerId: undefined },
    );
  const search = useMemberSearch(members, {
    always: true,
    onPick: (m) => {
      choose(m.id);
      setOpen(false);
    },
  });

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || isTypingTarget(event) || hasModifier(event)) return;
      if (event.key.toLowerCase() !== TASK_KEYS.person || overlayOpen()) return;
      event.preventDefault();
      setOpen(true);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <Popover open={open} onOpenChange={(o) => (setOpen(o), o || search.reset())}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={`Filter by person (${TASK_KEYS.person})`}
          aria-label={person ? `Filtered to ${person.name ?? "a member"}` : "Filter by person"}
          className={cn(chipClass(Boolean(person)), person && "ps-1")}
        >
          {person ? (
            <>
              <UserAvatar user={person} size="xs" />
              <span className="max-w-40 text-start break-words">{person.name ?? "Member"}</span>
            </>
          ) : (
            <>
              <UserRound className="size-3.5" aria-hidden="true" />
              {/* In a span like every other pill's label, so the filters
                  panel can lay them all out the same way. */}
              <span>Person</span>
            </>
          )}
          <ChevronDown className="size-3 opacity-60" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-72 gap-px p-1.5"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          search.focus();
        }}
      >
        <Segmented
          label="Which of their tasks"
          value={ownedOnly ? "owns" : "involved"}
          onSelect={(v) => {
            const next = v === "owns";
            setOwnedOnly(next);
            if (person) choose(person.id, next);
          }}
          options={[
            { value: "involved", label: "Involved" },
            { value: "owns", label: "Owns" },
          ]}
          className="mb-1 h-9 w-full [&>button]:h-7 [&>button]:flex-1 [&>button]:justify-center"
        />
        {search.input}
        <div
          id={search.listId}
          role="listbox"
          aria-label="Person"
          className="flex max-h-72 flex-col gap-px overflow-y-auto"
        >
          {person && (
            <button
              type="button"
              role="option"
              aria-selected={false}
              className={cn(menuItemClass(), "text-muted-foreground")}
              onClick={() => {
                choose(undefined);
                setOpen(false);
              }}
            >
              <X className="size-3.5" aria-hidden="true" />
              Anyone
            </button>
          )}
          {search.filtered.length === 0 && (
            <p className="text-muted-foreground px-2 py-2 text-[13px]">No match</p>
          )}
          {search.filtered.map((m, i) => (
            <button
              key={m.id}
              id={search.optionId(m)}
              type="button"
              role="option"
              aria-selected={m.id === personId}
              className={cn(menuItemClass(m.id === personId), search.isActive(i) && "bg-muted")}
              onPointerMove={() => search.hover(i)}
              onClick={() => search.pick(m)}
            >
              <UserAvatar user={m} size="xs" />
              <span className="break-words">{m.name ?? "Member"}</span>
              {m.id === personId && (
                <Check className="text-primary ms-auto size-3.5 shrink-0" aria-hidden="true" />
              )}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Search is uncontrolled between commits: you type freely, and Enter (or
 * leaving the field) writes it to the URL. Remounting on the committed value
 * keeps the two in step without an effect that fights your typing.
 */
function TaskSearch({
  initial,
  onCommit,
  inputRef,
  className = "sm:max-w-56",
  hint = "/",
  autoFocus,
}: {
  initial: string;
  onCommit: (value: string) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  className?: string;
  /** The keyboard hint (none on a phone). */
  hint?: string;
  autoFocus?: boolean;
}) {
  const [draft, setDraft] = useState(initial);
  return (
    <SearchField
      ref={inputRef}
      value={draft}
      onValueChange={setDraft}
      onClear={() => onCommit("")}
      hint={hint}
      autoFocus={autoFocus}
      placeholder="Search tasks"
      aria-label="Search tasks by title"
      className={className}
      onKeyDown={(e) => {
        if (e.key === "Enter") onCommit(draft.trim());
        if (e.key === "Escape") {
          setDraft("");
          onCommit("");
          e.currentTarget.blur();
        }
      }}
      onBlur={() => {
        if (draft.trim() !== initial) onCommit(draft.trim());
      }}
    />
  );
}

function FilterPill({
  label,
  icon,
  onClear,
}: {
  label: string;
  icon?: React.ReactNode;
  onClear: () => void;
}) {
  return (
    <span className="bg-muted text-foreground inline-flex h-8 items-center gap-1.5 rounded-full ps-3.5 pe-1 text-[13px] font-medium">
      {icon}
      {label}
      <button
        type="button"
        aria-label={`Remove filter ${label}`}
        onClick={onClear}
        className="text-muted-foreground hover:text-foreground hover:bg-background grid size-6 place-items-center rounded-full transition-colors"
      >
        <X className="size-3" />
      </button>
    </span>
  );
}

/**
 * Status, who can see it, and the tasks that need a look (overdue, flagged,
 * no owner): one chip, a panel of buttons, each choice one click.
 */
function StatusFilter() {
  const ws = useWorkspace();
  const [open, setOpen] = useState(false);
  const q = ws.query;
  const active = Boolean(q.status || q.visibility || q.flagged || q.unowned || q.overdue);
  const label = q.status
    ? q.status === "open"
      ? "Open"
      : STATUS_LABELS[q.status]
    : q.overdue
      ? "Overdue"
      : q.flagged
        ? "Flagged"
        : q.unowned
          ? "No owner"
          : q.visibility === TaskVisibility.PRIVATE
            ? "Private"
            : "Status";
  const row = "w-full [&>button]:h-7 [&>button]:flex-auto [&>button]:justify-center";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger aria-label="Filter by status" className={chipClass(active)}>
        <ListFilter className="size-3.5" aria-hidden="true" />
        <span>{label}</span>
        <ChevronDown className="size-3 opacity-60" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent align="start" className="grid w-[22rem] gap-3 p-3">
        <div className="grid gap-1.5">
          <span className="text-muted-foreground text-[13px] font-medium">Status</span>
          <div className="flex flex-wrap gap-1.5">
            {[
              { value: "", label: "Any" },
              { value: "open", label: "Open" },
              ...Object.values(TaskStatus).map((s) => ({ value: s, label: STATUS_LABELS[s] })),
            ].map((o) => (
              <button
                key={o.value || "any"}
                type="button"
                aria-pressed={(q.status ?? "") === o.value}
                onClick={() =>
                  ws.setFilters({
                    status: (o.value || undefined) as TaskStatus | "open" | undefined,
                  })
                }
                className={cn(chipClass((q.status ?? "") === o.value), "h-8 px-3 text-[13px]")}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-1.5">
          <span className="text-muted-foreground text-[13px] font-medium">Needs a look</span>
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ["overdue", "Overdue"],
                ["flagged", "Flagged"],
                ["unowned", "No owner"],
              ] as const
            ).map(([key, text]) => (
              <button
                key={key}
                type="button"
                aria-pressed={q[key]}
                onClick={() => ws.setFilters({ [key]: !q[key] })}
                className={cn(chipClass(q[key]), "h-8 px-3 text-[13px]")}
              >
                {text}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-1.5">
          <span className="text-muted-foreground text-[13px] font-medium">Who can see it</span>
          <Segmented
            label="Who can see it"
            value={q.visibility ?? ""}
            onSelect={(v) => ws.setFilters({ visibility: (v || undefined) as TaskVisibility })}
            options={[
              { value: "", label: "Any" },
              { value: TaskVisibility.ORG, label: "Everyone" },
              { value: TaskVisibility.PRIVATE, label: "Private" },
            ]}
            className={row}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

const SCOPE_ICONS: Record<string, typeof UserRound> = {
  mine: UserRound,
  team: UsersRound,
  all: Globe,
};

/** The board's lanes: one per epic (?lanes=epic), or none. One click either way. */
function EpicLanesToggle() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const lanes = searchParams.get("lanes") === "epic";
  const toggle = () => {
    const params = new URLSearchParams(searchParams.toString());
    if (lanes) params.delete("lanes");
    else params.set("lanes", "epic");
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  };
  return (
    <button type="button" aria-pressed={lanes} onClick={toggle} className={chipClass(lanes)}>
      <Rows3 className="size-3.5" aria-hidden="true" />
      By epic
    </button>
  );
}
