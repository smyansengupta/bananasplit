"use client";

import {
  AlarmClock,
  ArrowLeft,
  CalendarRange,
  CircleCheck,
  CircleDot,
  ClipboardPaste,
  Layers,
} from "@/components/icons";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { ActionItemsImport } from "@/components/ai/action-items-import";
import { useTasks, useWorkspace } from "@/components/tasks/tasks-context";
import { PHONE_SMALL_CREATE } from "@/components/page-header";
import { OpenTasksBar, taskStatsSegments } from "@/components/tasks/open-tasks-bar";
import { WorkspaceToolbar } from "@/components/tasks/workspace-toolbar";
import { Button } from "@/components/ui/button";
import { CreateSplitButton } from "@/components/ui/create-split-button";
import { chipClass } from "@/components/ui/segmented";
import { Stat, StatStrip } from "@/components/ui/stat";
import { cn } from "@/lib/utils";
import type { TaskStats } from "@/server/tasks/queries";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
  hasModifier,
  isTypingTarget,
  NEW_TASK_PARAM,
  overlayOpen,
  SCOPE_KEYS,
  TASK_KEYS,
} from "@/lib/shortcuts";

import {
  DEFAULT_TASK_LAYOUT,
  isDestination,
  parseRemembered,
  REMEMBER_COOKIE,
  TASK_LAYOUTS,
  type TaskLayout,
} from "./views";

/** The layout this person last used, read from the cookie views.ts sets. */
function lastLayout(): TaskLayout {
  const match = document.cookie.match(new RegExp(`(?:^|; )${REMEMBER_COOKIE}=([^;]*)`));
  return parseRemembered(match?.[1]).view ?? DEFAULT_TASK_LAYOUT;
}

/**
 * The workspace header: the title and New task. Nothing else competes for
 * the corner: the dashboard is a layout in the toolbar, Requests is gone,
 * and the weekly update shows where it's relevant (the Week's strip, the
 * dashboard), not as a button sitting here all week.
 *
 * Inside the weekly update the header collapses to a back link: the filter
 * toolbar has nothing to filter there, and leaving it on screen would
 * suggest otherwise.
 *
 * "Paste a list" is a way of making tasks, so it sits in New task's menu
 * rather than beside it.
 */
export function WorkspaceHeader({
  title = "Tasks",
  teamwork = true,
  stats = null,
  weekEndKey,
}: {
  /** The section's name in the club's sidebar. */
  title?: string;
  /** The weekly update exists (a club's layouts; not Personal or the Free plan). */
  teamwork?: boolean;
  /** The stat strip (none on the Free plan). */
  stats?: TaskStats | null;
  /** The last day of this week (Sunday), for the Due this week filter. */
  weekEndKey?: string;
}) {
  const { newTask, org } = useTasks();
  const ws = useWorkspace();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [importing, setImporting] = useState(false);
  const inDestination = isDestination(ws.query.view);
  // Filtered to one epic: new work goes into it.
  const epicId = ws.query.epicId ?? null;
  const inEpic = useMemo(
    () => (epicId ? { parentTaskId: epicId, parentType: "EPIC" as const } : undefined),
    [epicId],
  );

  // Each number in the strip is a filter that narrows to what it counted.
  const q = ws.query;
  const dueWeekOn =
    q.status === "open" && Boolean(weekEndKey) && q.dueTo === weekEndKey && !q.dueFrom;
  const statFilters = stats
    ? [
        {
          key: "open",
          icon: CircleDot,
          value: stats.open,
          label: "Open",
          on: q.status === "open" && !dueWeekOn,
          toggle: () =>
            ws.setFilters(
              q.status === "open" && !dueWeekOn
                ? { status: undefined }
                : { status: "open", dueTo: undefined, dueFrom: undefined },
            ),
        },
        {
          key: "week",
          icon: CalendarRange,
          value: stats.dueThisWeek,
          label: "Due this week",
          on: dueWeekOn,
          toggle: () =>
            ws.setFilters(
              dueWeekOn
                ? { status: undefined, dueTo: undefined }
                : { status: "open", dueTo: weekEndKey, dueFrom: undefined },
            ),
        },
        {
          key: "overdue",
          icon: AlarmClock,
          value: stats.overdue,
          label: "Overdue",
          on: q.overdue,
          toggle: () => ws.setFilters({ overdue: !q.overdue }),
        },
        {
          key: "done",
          icon: CircleCheck,
          value: stats.doneThisWeek,
          label: "Done this week",
          on: q.status === "COMPLETED",
          toggle: () =>
            ws.setFilters({ status: q.status === "COMPLETED" ? undefined : "COMPLETED" }),
        },
      ]
    : [];

  // The single keys (src/lib/shortcuts.ts, listed on the ⌘/ sheet): 1-5
  // switch layout (1 is the dashboard, 2 the board), c starts a task, m / t / e pick
  // whose work, x clears the filters, u opens the weekly update. Typing in a
  // field never triggers them, nor does a key an open menu uses.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || hasModifier(event) || isTypingTarget(event)) return;
      if (overlayOpen()) return;
      const run = (action: () => void) => {
        event.preventDefault();
        action();
      };
      const key = event.key.toLowerCase();
      const index = Number.parseInt(event.key, 10);
      if (!ws.simple && index >= 1 && index <= TASK_LAYOUTS.length) {
        return run(() => ws.setView(TASK_LAYOUTS[index - 1]!.value as TaskLayout));
      }
      if (key === TASK_KEYS.newTask) return run(() => newTask(inEpic));
      if (teamwork && key === TASK_KEYS.updates) return run(() => ws.setView("updates"));
      // The rest narrow a layout; a destination has nothing to narrow.
      if (inDestination) return;
      const scope = ws.scopes.find((s) => SCOPE_KEYS[s.value] === key);
      if (scope) return run(() => ws.setScope(scope.value));
      if (key === TASK_KEYS.clearFilters) {
        return run(() => router.push(`/app/${org.slug}/tasks?view=${ws.query.view}`));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ws, newTask, inEpic, teamwork, inDestination, router, org.slug]);

  // `c` pressed elsewhere in the app lands here with ?new=1: start the task,
  // then drop the param so a reload or Back doesn't start another.
  const startNew = searchParams.get(NEW_TASK_PARAM) === "1";
  useEffect(() => {
    if (!startNew) return;
    newTask(inEpic);
    const params = new URLSearchParams(searchParams.toString());
    params.delete(NEW_TASK_PARAM);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [startNew, newTask, inEpic, searchParams, router, pathname]);

  return (
    <div className="mb-[30px] space-y-[30px] max-md:mb-5 max-md:space-y-4">
      {/* On a phone: the title, and New task at the top right. */}
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3 max-md:flex-nowrap max-md:items-center">
        <h1 className="page-title mr-auto max-md:min-w-0">{title}</h1>

        <div className={cn("flex flex-wrap items-center gap-2", PHONE_SMALL_CREATE)}>
          {inDestination ? (
            <Button variant="ghost" onClick={() => ws.setView(lastLayout())}>
              <ArrowLeft className="size-4" aria-hidden="true" />
              Tasks
            </Button>
          ) : null}

          {/* New task (the screen's one create), with more ways in its menu. */}
          <CreateSplitButton
            label="New task"
            title="New task (c)"
            onClick={() => newTask(inEpic)}
            menuLabel="More"
          >
            {!ws.simple && (
              <>
                <DropdownMenuItem onSelect={() => newTask({ type: "EPIC" })}>
                  <Layers className="size-4" aria-hidden="true" />
                  New epic
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setImporting(true)}>
                  <ClipboardPaste className="size-4" aria-hidden="true" />
                  Paste a list
                </DropdownMenuItem>
              </>
            )}
          </CreateSplitButton>
        </div>
      </div>

      {/*
        The numbers, each one a filter: press one and the view narrows to
        exactly what it counted; press it again to let go. A phone gets the
        bar and the same four as small chips under it.
      */}
      {!inDestination && stats && (
        <div className="space-y-2.5 md:hidden">
          <OpenTasksBar open={stats.open} segments={taskStatsSegments(stats)} />
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Task counts">
            {statFilters.map((f) => (
              <button
                key={f.key}
                type="button"
                aria-pressed={f.on}
                onClick={f.toggle}
                className={cn(chipClass(f.on), "h-8 gap-1 px-3 text-[13px]")}
              >
                <b className="tabular-nums">{f.value}</b> {f.label.toLowerCase()}
              </button>
            ))}
          </div>
        </div>
      )}
      {!inDestination && stats && (
        <StatStrip className="max-md:hidden">
          {statFilters.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={f.on}
              onClick={f.toggle}
              title={f.on ? "Show every task" : `Show only these (${f.label.toLowerCase()})`}
              className={cn(
                "focus-glow -m-1.5 rounded-[20px] p-1.5 text-start transition-colors outline-none",
                f.on ? "bg-muted" : "hover:bg-muted/60",
              )}
            >
              <Stat icon={f.icon} value={f.value} label={f.label} />
            </button>
          ))}
        </StatStrip>
      )}

      {!inDestination && <WorkspaceToolbar />}
      {importing && (
        <ActionItemsImport
          orgId={org.id}
          orgSlug={org.slug}
          open={importing}
          onOpenChange={setImporting}
        />
      )}
    </div>
  );
}
