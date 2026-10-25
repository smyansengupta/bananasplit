"use client";

import {
  AlarmClock,
  ArrowLeft,
  CalendarRange,
  CircleCheck,
  CircleDot,
  ClipboardPaste,
  Layers,
  Plus,
} from "@/components/icons";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { ActionItemsImport } from "@/components/ai/action-items-import";
import { useTasks, useWorkspace } from "@/components/tasks/tasks-context";
import { PHONE_SMALL_CREATE } from "@/components/page-header";
import { OpenTasksBar, taskStatsSegments } from "@/components/tasks/open-tasks-bar";
import { WorkspaceToolbar } from "@/components/tasks/workspace-toolbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CreateSplitButton } from "@/components/ui/create-split-button";
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

import { isDestination, TASK_LAYOUTS, type TaskLayout } from "./views";

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
}: {
  /** The section's name in the club's sidebar. */
  title?: string;
  /** The weekly update exists (a club's layouts; not Personal or the Free plan). */
  teamwork?: boolean;
  /** The stat strip (none on the Free plan). */
  stats?: TaskStats | null;
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

  // The single keys (src/lib/shortcuts.ts, listed on the ⌘/ sheet): 1-6
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
            <Button variant="ghost" onClick={() => ws.setView("board")}>
              <ArrowLeft className="size-4" aria-hidden="true" />
              Back to tasks
            </Button>
          ) : null}

          {/* New task (the screen's one create), with more ways in its menu. */}
          <CreateSplitButton
            label="New task"
            title="New task (c)"
            onClick={() => newTask(inEpic)}
            menuLabel="More ways to add tasks"
          >
            {!ws.simple && (
              <>
                <DropdownMenuItem onSelect={() => newTask(inEpic)}>
                  <Plus className="size-4" aria-hidden="true" />
                  New task
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => newTask({ type: "EPIC" })}>
                  <Layers className="size-4" aria-hidden="true" />
                  New epic
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setImporting(true)}>
                  <ClipboardPaste className="size-4" aria-hidden="true" />
                  <span className="flex flex-col">
                    Paste a list
                    <span className="text-muted-foreground text-xs">
                      A to-do list or meeting notes, turned into tasks
                    </span>
                  </span>
                </DropdownMenuItem>
              </>
            )}
          </CreateSplitButton>
        </div>
      </div>

      {/* A phone: the numbers as one bar, the same as the Overview's. */}
      {!inDestination && stats && (
        <OpenTasksBar open={stats.open} className="md:hidden" segments={taskStatsSegments(stats)} />
      )}
      {!inDestination && stats && (
        <StatStrip className="max-md:hidden">
          <Stat icon={CircleDot} value={stats.open} label="Open" />
          <Stat icon={CalendarRange} value={stats.dueThisWeek} label="Due this week" />
          <Stat
            icon={AlarmClock}
            value={stats.overdue}
            label="Overdue"
            chip={
              stats.overdue > 0 ? (
                <button
                  type="button"
                  onClick={() => ws.setFilters({ blockers: true })}
                  className="focus-glow rounded-full"
                >
                  <Badge variant="destructive">Show them</Badge>
                </button>
              ) : undefined
            }
          />
          <Stat icon={CircleCheck} value={stats.doneThisWeek} label="Done this week" />
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
