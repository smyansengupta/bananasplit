"use client";

import {
  CalendarDays,
  Check,
  GanttChart,
  ListTree,
  ChevronDown,
  Columns3,
  Layers,
  Gauge,
  ListFilter,
  Lock,
  SlidersHorizontal,
  Table2,
  Tag,
  UserRound,
  UsersRound,
  Globe,
  Rows3,
  X,
} from "@/components/icons";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Children, useCallback, useEffect, useRef, useState, useTransition } from "react";

import { PHONE_HIDDEN_LAYOUTS, type TaskLayout } from "@/app/app/[orgSlug]/tasks/views";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { UserAvatar } from "@/components/user-avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FilterChoices, FilterSheet, PhoneToolbar } from "@/components/ui/phone-toolbar";
import { SearchField } from "@/components/ui/search-field";
import { chipClass, Segmented } from "@/components/ui/segmented";
import { TaskStatus, TaskVisibility } from "@/generated/prisma/enums";
import { hasModifier, isTypingTarget, overlayOpen, SCOPE_KEYS, TASK_KEYS } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

import { STATUS_LABELS } from "./status-select";
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
 * Layout icons carry labels on desktop; the filters collapse behind one
 * button with a count so the bar never wraps into a wall of selects. Every
 * control is the same height (h-7).
 *
 * A phone gets its own one-row bar (MobileToolbar): whose work, the layout
 * picker, Filters (a sheet with every filter, each with its name) and
 * search, since six layout icons in a row meant nothing there.
 */

const LAYOUT_ICONS = {
  board: Columns3,
  week: CalendarDays,
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
        A container, not a viewport breakpoint. What makes this bar wrap is
        the room it actually has, and that is not the window: docking or
        railing the sidebar moves it by 150px, and a MacBook with the sidebar
        out had the filters pushed onto a second row while the same window on
        a desktop was fine. Everything below steps down on @[…]/toolbar.
      */}
      <div className="@container/toolbar max-md:hidden">
        <div className="flex flex-nowrap items-center gap-2 overflow-visible">
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
            // The first thing to go when the bar tightens: five layout names
            // is most of its width, and each one keeps its icon and its title.
            labelsFrom="sr-only @[52rem]/toolbar:not-sr-only"
            className="shrink-0"
          />
        )}

        {/*
          Scope: whose work, as icons that open up to say what they are on
          hover or focus. The team option only exists if you have reports.
        */}
        <div className="flex shrink-0 items-center gap-1" role="group" aria-label="Whose tasks">
          {ws.scopes.map((scope) => (
            <ExpandChip
              key={scope.value}
              icon={SCOPE_ICONS[scope.value]}
              label={scope.label}
              active={ws.query.scope === scope.value && !pinnedMember}
              onClick={() => ws.setScope(scope.value)}
              title={SCOPE_KEYS[scope.value] && `${scope.label} (${SCOPE_KEYS[scope.value]})`}
            />
          ))}
        </div>

        {/* Filters: one chip that slides out Person, Epic, Tag and Status. */}
        <FiltersMenu count={ws.filterCount + (ws.query.epicId ? 1 : 0)}>
          {members.length > 1 && <PersonFilter />}
          <EpicFilter />
          {labels.length > 0 && <TagFilter />}
          <StatusFilter />
        </FiltersMenu>

        <div className="ms-auto flex min-w-0 flex-1 items-center justify-end gap-2">
          {/* How the board is grouped, beside the search: its own menu, not a toggle on the board. */}
          {ws.query.view === "board" && <GroupMenu />}
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
              label={
                ws.query.visibility === TaskVisibility.PRIVATE ? "Private only" : "Open to the club"
              }
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
              label={`${ws.query.ownerId ? "Owned by" : "Involving"} ${pinnedMember.name ?? "someone"}`}
              onClear={() => ws.setFilters({ ownerId: undefined, assigneeId: undefined })}
            />
          )}
          {ws.query.blockers && (
            <FilterPill label="Blockers" onClear={() => ws.setFilters({ blockers: false })} />
          )}
          {ws.query.flagged && (
            <FilterPill label="Flagged" onClear={() => ws.setFilters({ flagged: false })} />
          )}
          {ws.query.q && (
            <FilterPill label={`“${ws.query.q}”`} onClear={() => ws.setFilters({ q: undefined })} />
          )}
          {(ws.query.dueFrom || ws.query.dueTo) && (
            <FilterPill
              label={`Due ${ws.query.dueFrom ?? "…"} – ${ws.query.dueTo ?? "…"}`}
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
  const { members, labels, org } = useTasks();
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
  const current = layouts.find((l) => l.value === ws.query.view);

  return (
    <>
      <PhoneToolbar
        middle={
          layouts.length > 1 && (
            // The layouts a phone has, named, filling the room up to Filters.
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="h-10 w-full min-w-0 justify-between gap-1 rounded-full px-3"
                  aria-label={`Layout: ${current?.label ?? "List"}`}
                >
                  <span className="truncate">{current?.label ?? "List"}</span>
                  <ChevronDown className="size-3.5 shrink-0 opacity-60" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-60">
                <DropdownMenuLabel>Show tasks as</DropdownMenuLabel>
                {layouts.map((l) => {
                  const Icon = LAYOUT_ICONS[l.value];
                  return (
                    <DropdownMenuItem
                      key={l.value}
                      onSelect={() => ws.setView(l.value as TaskLayout)}
                      className="min-h-12 gap-3"
                    >
                      <Icon className="size-4" aria-hidden="true" />
                      <span className="flex flex-col">
                        <span className="font-medium">{l.label}</span>
                        <span className="text-muted-foreground text-xs">{l.hint}</span>
                      </span>
                      {l.value === ws.query.view && (
                        <Check className="ms-auto size-4" aria-hidden="true" />
                      )}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
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
        title="Filter tasks"
        description="The list shows only the tasks that match."
        canClear={count > 0}
        onClear={clearAll}
      >
        <div className="flex flex-wrap gap-2">
          {members.length > 1 && <PersonFilter />}
          <EpicFilter />
          {labels.length > 0 && <TagFilter />}
        </div>
        {/* The header's Epics button, which a phone's header has no room for. */}
        <Link
          href={`/app/${org.slug}/tasks?view=roadmap`}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline"
        >
          <Layers className="size-4" aria-hidden="true" />
          See all epics
        </Link>
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
          title="Visibility"
          value={ws.query.visibility ?? ""}
          onPick={(v) => ws.setFilters({ visibility: (v || undefined) as TaskVisibility })}
          options={[
            { value: "", label: "Everything I can see" },
            { value: TaskVisibility.PRIVATE, label: "Private only" },
            { value: TaskVisibility.ORG, label: "Open to the club" },
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
          <span className="max-w-36 truncate">{epic?.title ?? "Epic"}</span>
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
          <span className="max-w-36 truncate">{tag?.name ?? "Tag"}</span>
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
              <span className="truncate">{l.name}</span>
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
              <span className="max-w-32 truncate">{person.name ?? "Member"}</span>
            </>
          ) : (
            <>
              <UserRound className="size-3.5" aria-hidden="true" />
              Person
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
            <p className="text-muted-foreground px-2 py-2 text-[13px]">Nobody by that name.</p>
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
              <span className="truncate">{m.name ?? "Member"}</span>
              {m.id === personId && (
                <Check className="text-primary ms-auto size-3.5 shrink-0" aria-hidden="true" />
              )}
            </button>
          ))}
        </div>
        <label className="text-muted-foreground mt-1 flex items-center gap-2 border-t px-2 pt-2 pb-1 text-xs">
          <Checkbox
            checked={ownedOnly}
            onCheckedChange={(checked) => {
              const next = checked === true;
              setOwnedOnly(next);
              if (person) choose(person.id, next);
            }}
          />
          Only tasks they own
        </label>
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

/** Status and who can see it, as the last of the Filters pills. */
function StatusFilter() {
  const ws = useWorkspace();
  const active = Boolean(ws.query.status || ws.query.visibility);
  const label = ws.query.status
    ? ws.query.status === "open"
      ? "Open"
      : STATUS_LABELS[ws.query.status]
    : ws.query.visibility === TaskVisibility.PRIVATE
      ? "Private only"
      : "Status";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Filter by status or visibility"
          className={chipClass(active)}
        >
          <ListFilter className="size-3.5" aria-hidden="true" />
          <span className="max-w-36 truncate">{label}</span>
          <ChevronDown className="size-3 opacity-60" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>Status</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => ws.setFilters({ status: undefined })}>
          Any status
          {!ws.query.status && <Check className="ms-auto size-4" />}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => ws.setFilters({ status: "open" })}>
          Open (not completed)
          {ws.query.status === "open" && <Check className="ms-auto size-4" />}
        </DropdownMenuItem>
        {Object.values(TaskStatus).map((s) => (
          <DropdownMenuItem key={s} onSelect={() => ws.setFilters({ status: s })}>
            {STATUS_LABELS[s]}
            {ws.query.status === s && <Check className="ms-auto size-4" />}
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />
        <DropdownMenuLabel>Visibility</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => ws.setFilters({ visibility: undefined })}>
          Everything I can see
          {!ws.query.visibility && <Check className="ms-auto size-4" />}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => ws.setFilters({ visibility: TaskVisibility.PRIVATE })}>
          <Lock className="size-4" aria-hidden="true" /> Private only
          {ws.query.visibility === TaskVisibility.PRIVATE && <Check className="ms-auto size-4" />}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => ws.setFilters({ visibility: TaskVisibility.ORG })}>
          Open to the club
          {ws.query.visibility === TaskVisibility.ORG && <Check className="ms-auto size-4" />}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const SCOPE_ICONS: Record<string, typeof UserRound> = {
  mine: UserRound,
  team: UsersRound,
  all: Globe,
};

/**
 * A chip that is just its icon until you hover or focus it, then opens up
 * to say what it is (Mine, My team, Everyone). Filled when it's on.
 */
function ExpandChip({
  icon: Icon,
  label,
  active,
  onClick,
  title,
}: {
  icon: typeof UserRound;
  label: string;
  active: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      title={title ?? label}
      onClick={onClick}
      className={cn(chipClass(active), "group/expand gap-0 px-3")}
    >
      <Icon className="size-4 flex-none" aria-hidden="true" />
      <span
        aria-hidden="true"
        className="max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-[max-width,opacity,margin] duration-300 ease-(--ease-ink) group-hover/expand:ms-1.5 group-hover/expand:max-w-32 group-hover/expand:opacity-100 group-focus-visible/expand:ms-1.5 group-focus-visible/expand:max-w-32 group-focus-visible/expand:opacity-100 motion-reduce:transition-none"
      >
        {label}
      </span>
    </button>
  );
}

/** Group the board: none, or a lane per epic (?lanes=epic). */
function GroupMenu() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const lanes = searchParams.get("lanes") === "epic";
  const set = (value: "epic" | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set("lanes", value);
    else params.delete("lanes");
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={chipClass(lanes)} aria-label="Group the board">
          <Rows3 className="size-3.5" aria-hidden="true" />
          {lanes ? "Grouped by epic" : "Group"}
          <ChevronDown className="size-3.5 opacity-70" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuLabel>Group the board</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => set(null)}>
          No groups
          {!lanes && <Check className="ms-auto size-4" />}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => set("epic")}>
          <Layers className="size-4" aria-hidden="true" /> By epic
          {lanes && <Check className="ms-auto size-4" />}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The Filters chip. Hover it (or focus it, or tap it) and the filter pills
 * slide out beside it; it stays open while one of their menus is open, and
 * folds away again once the pointer leaves.
 */
function FiltersMenu({ count, children }: { count: number; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const pills = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [packed, setPacked] = useState(false);
  const pillList = Children.toArray(children);
  const show = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setOpen(true);
  };
  // Only a pill's own menu (it lives in a portal) keeps the row out; the
  // Filters chip's aria-expanded doesn't count, or it would never close.
  const pillMenuOpen = () =>
    Boolean(pills.current?.querySelector('[aria-expanded="true"], [data-state="open"]'));
  // A short grace period, started once: moving the pointer around outside
  // doesn't keep pushing it back (which made it feel slow to fold).
  const hideSoon = () => {
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      if (!pillMenuOpen()) setOpen(false);
    }, 240);
  };

  useEffect(() => {
    if (!open) return;
    const onMove = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target) return;
      if (ref.current?.contains(target)) return show();
      if (target.closest("[data-radix-popper-content-wrapper]")) return;
      hideSoon();
    };
    document.addEventListener("pointermove", onMove);
    return () => document.removeEventListener("pointermove", onMove);
    // show/hideSoon only touch refs and state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const chip = (expanded: boolean) => (
    <>
      <SlidersHorizontal className="size-3.5" aria-hidden="true" />
      Filters
      {count > 0 && <Badge className="h-4 min-w-4 px-1 text-[10px]">{count}</Badge>}
      <span className="sr-only">{expanded ? " (open)" : ""}</span>
    </>
  );

  return (
    <div ref={ref} className="flex shrink-0 items-center gap-1">
      {/*
        A tight bar (a laptop, or any window with the sidebar docked): the
        pills have nowhere to slide to, and sliding them anyway is what used
        to push the whole row onto a second line. They go in a popover
        instead, stacked, which needs no room in the bar at all.
      */}
      <Popover open={packed} onOpenChange={setPacked}>
        <PopoverTrigger
          aria-label={count > 0 ? `Filters, ${count} on` : "Filters"}
          className={cn(chipClass(packed || count > 0), "@[64rem]/toolbar:hidden")}
        >
          {chip(packed)}
        </PopoverTrigger>
        <PopoverContent align="start" className="grid w-64 gap-1.5 p-2">
          {pillList.map((pill, i) => (
            <div key={i} className="[&>*]:w-full">
              {pill}
            </div>
          ))}
        </PopoverContent>
      </Popover>

      {/* A roomy bar keeps the pills sliding out beside the chip. */}
      <div
        className="hidden items-center gap-1 @[64rem]/toolbar:flex"
        onPointerEnter={show}
        onPointerLeave={hideSoon}
        onFocus={show}
        onBlur={(e) => {
          if (!ref.current?.contains(e.relatedTarget as Node | null)) hideSoon();
        }}
      >
        <button
          type="button"
          aria-expanded={open}
          aria-label={count > 0 ? `Filters, ${count} on` : "Filters"}
          onClick={() => setOpen((v) => !v)}
          className={chipClass(open || count > 0)}
        >
          {chip(open)}
        </button>
        <div
          inert={!open}
          className={cn(
            "grid transition-[grid-template-columns] duration-[380ms] ease-(--ease-ink) motion-reduce:transition-none",
            open ? "grid-cols-[1fr]" : "pointer-events-none grid-cols-[0fr]",
          )}
        >
          {/*
            The pills slide out one after another, and fold back in the other
            order (last one first) while the row closes up behind them.
          */}
          <div ref={pills} className="flex min-w-0 items-center gap-1 overflow-hidden p-0.5">
            {pillList.map((pill, i) => (
              <span
                key={i}
                className={cn(
                  "flex transition-[opacity,transform] duration-200 ease-(--ease-ink) motion-reduce:transition-none",
                  open ? "translate-x-0 opacity-100" : "-translate-x-3 opacity-0",
                )}
                style={{
                  transitionDelay: `${(open ? i : pillList.length - 1 - i) * 40}ms`,
                }}
              >
                {pill}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
