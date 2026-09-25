"use client";

import {
  CalendarDays,
  Check,
  ChevronDown,
  Columns3,
  ListChecks,
  Lock,
  Search,
  SlidersHorizontal,
  Users,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { TaskStatus, TaskVisibility } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";

import { STATUS_LABELS } from "./status-select";
import { useTasks, useWorkspace } from "./tasks-context";

/**
 * The one toolbar (C4).
 *
 * Every layout reads the same query, so this bar is the whole navigation:
 * which layout, whose work, and which tasks. It writes to the URL, which
 * means a filtered view is a link you can paste into Slack, and going back
 * really goes back.
 *
 * Layout icons carry labels on desktop and shrink to icons on a phone; the
 * filters collapse behind one button with a count so the bar never wraps
 * into a wall of selects.
 */

const LAYOUT_ICONS = {
  week: ListChecks,
  board: Columns3,
  table: SlidersHorizontal,
  calendar: CalendarDays,
  team: Users,
} as const;

function Chip({
  active,
  onClick,
  children,
  title,
  className,
}: {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={cn(
        "focus-visible:ring-ring inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium whitespace-nowrap transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
        active
          ? "border-foreground bg-foreground text-background"
          : "border-border text-muted-foreground hover:text-foreground hover:bg-muted",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function WorkspaceToolbar() {
  const { org, labels, projects, members } = useTasks();
  const ws = useWorkspace();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null);

  // `/` focuses search from anywhere that is not already a field.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;
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

  const activeProject = ws.query.projectId
    ? projects.find((p) => p.id === ws.query.projectId)
    : null;
  const activeLabel = ws.query.labelId ? labels.find((l) => l.id === ws.query.labelId) : null;
  const pinnedPerson = ws.query.ownerId ?? ws.query.assigneeId;
  const pinnedMember = pinnedPerson ? members.find((m) => m.id === pinnedPerson) : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {/* Layout: five shapes of the same question. */}
        <nav aria-label="Layout" className="bg-muted flex items-center gap-0.5 rounded-lg p-1">
          {ws.layouts.map((layout, index) => {
            const Icon = LAYOUT_ICONS[layout.value];
            const active = ws.query.view === layout.value;
            return (
              <button
                key={layout.value}
                type="button"
                aria-current={active ? "page" : undefined}
                title={`${layout.label} — ${layout.hint} (${index + 1})`}
                onClick={() => ws.setView(layout.value)}
                className={cn(
                  "focus-visible:ring-ring inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none sm:px-3",
                  active
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden="true" />
                <span className="sr-only sm:not-sr-only">{layout.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Scope: whose work. The team option only exists if you have reports. */}
        <div className="flex items-center gap-1" role="group" aria-label="Whose tasks">
          {ws.scopes.map((scope) => (
            <Chip
              key={scope.value}
              active={ws.query.scope === scope.value && !pinnedMember}
              onClick={() => ws.setScope(scope.value)}
            >
              {scope.label}
            </Chip>
          ))}
        </div>

        <div className="ms-auto flex flex-1 items-center justify-end gap-2 sm:flex-none">
          <SearchField
            key={ws.query.q ?? ""}
            inputRef={searchRef}
            initial={ws.query.q ?? ""}
            onCommit={commitSearch}
          />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1.5">
                <SlidersHorizontal className="size-4" aria-hidden="true" />
                <span className="hidden sm:inline">Filter</span>
                {ws.filterCount > 0 && (
                  <span className="bg-foreground text-background inline-flex size-4 items-center justify-center rounded-full text-[10px] font-semibold">
                    {ws.filterCount}
                  </span>
                )}
                <ChevronDown className="size-3.5 opacity-60" aria-hidden="true" />
              </Button>
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
              <DropdownMenuItem
                onSelect={() => ws.setFilters({ visibility: TaskVisibility.PRIVATE })}
              >
                <Lock className="size-4" aria-hidden="true" /> Private only
                {ws.query.visibility === TaskVisibility.PRIVATE && (
                  <Check className="ms-auto size-4" />
                )}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => ws.setFilters({ visibility: TaskVisibility.ORG })}>
                Open to the club
                {ws.query.visibility === TaskVisibility.ORG && <Check className="ms-auto size-4" />}
              </DropdownMenuItem>

              {labels.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Label</DropdownMenuLabel>
                  <DropdownMenuItem onSelect={() => ws.setFilters({ labelId: undefined })}>
                    Any label
                    {!ws.query.labelId && <Check className="ms-auto size-4" />}
                  </DropdownMenuItem>
                  {labels.map((l) => (
                    <DropdownMenuItem key={l.id} onSelect={() => ws.setFilters({ labelId: l.id })}>
                      <span
                        aria-hidden="true"
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: l.color }}
                      />
                      {l.name}
                      {ws.query.labelId === l.id && <Check className="ms-auto size-4" />}
                    </DropdownMenuItem>
                  ))}
                </>
              )}

              {projects.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Project</DropdownMenuLabel>
                  <DropdownMenuItem onSelect={() => ws.setFilters({ projectId: undefined })}>
                    All projects
                    {!ws.query.projectId && <Check className="ms-auto size-4" />}
                  </DropdownMenuItem>
                  {projects.map((p) => (
                    <DropdownMenuItem
                      key={p.id}
                      onSelect={() => ws.setFilters({ projectId: p.id })}
                    >
                      {p.name}
                      {ws.query.projectId === p.id && <Check className="ms-auto size-4" />}
                    </DropdownMenuItem>
                  ))}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* What is currently narrowing the view, each removable on its own. */}
      {(ws.filterCount > 0 || activeProject) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {activeProject && (
            <FilterPill
              label={activeProject.name}
              onClear={() => ws.setFilters({ projectId: undefined })}
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
              icon={<Lock className="size-3" aria-hidden="true" />}
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
 * Search is uncontrolled between commits: you type freely, and Enter (or
 * leaving the field) writes it to the URL. Remounting on the committed value
 * keeps the two in step without an effect that fights your typing.
 */
function SearchField({
  initial,
  onCommit,
  inputRef,
}: {
  initial: string;
  onCommit: (value: string) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [draft, setDraft] = useState(initial);
  return (
    <div className="relative w-full max-w-56 sm:w-56">
      <Search
        className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
        aria-hidden="true"
      />
      <Input
        ref={inputRef}
        value={draft}
        placeholder="Search tasks"
        aria-label="Search tasks by title"
        className="h-8 ps-8 pe-8 text-sm"
        onChange={(e) => setDraft(e.target.value)}
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
      {draft ? (
        <button
          type="button"
          aria-label="Clear search"
          className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2"
          onClick={() => {
            setDraft("");
            onCommit("");
          }}
        >
          <X className="size-3.5" />
        </button>
      ) : (
        <kbd className="text-muted-foreground border-border pointer-events-none absolute top-1/2 right-2 hidden -translate-y-1/2 rounded border px-1 text-[10px] leading-4 sm:block">
          /
        </kbd>
      )}
    </div>
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
    <span className="bg-muted text-foreground inline-flex h-7 items-center gap-1.5 rounded-full ps-2.5 pe-1 text-xs font-medium">
      {icon}
      {label}
      <button
        type="button"
        aria-label={`Remove filter ${label}`}
        onClick={onClear}
        className="text-muted-foreground hover:text-foreground hover:bg-background rounded-full p-0.5 transition-colors"
      >
        <X className="size-3" />
      </button>
    </span>
  );
}
