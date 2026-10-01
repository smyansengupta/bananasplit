"use client";

import { ArrowLeft, Inbox, NotebookPen, Plus, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import { ActionItemsImport } from "@/components/ai/action-items-import";
import { useTasks, useWorkspace } from "@/components/tasks/tasks-context";
import { WorkspaceToolbar } from "@/components/tasks/workspace-toolbar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { isDestination, TASK_LAYOUTS, type TaskLayout } from "./views";

/**
 * The workspace header.
 *
 * Requests and the Sunday update used to be two of seven equal tabs. They
 * are not layouts — you do not "look at the board as a Sunday update" — so
 * they sit here as destinations instead, next to New task. Pulling them out
 * is what lets the tab row become five genuine views of one question.
 *
 * Inside a destination the header collapses to a back link: the filter
 * toolbar has nothing to filter there, and leaving it on screen would
 * suggest otherwise.
 */
export function WorkspaceHeader({
  intakeCount,
  showIntake,
  posted,
}: {
  /** Open requests waiting in the intake queue. */
  intakeCount: number;
  showIntake: boolean;
  /** Whether the viewer already posted this week's Sunday update. */
  posted: boolean;
}) {
  const { newTask, org } = useTasks();
  const ws = useWorkspace();
  const [importing, setImporting] = useState(false);
  const inDestination = isDestination(ws.query.view);

  // 1-5 switch layout, c starts a task. Typing in a field never triggers them.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;
      if (document.querySelector("[role=dialog][data-state=open]")) return;

      const index = Number.parseInt(event.key, 10);
      if (index >= 1 && index <= TASK_LAYOUTS.length) {
        event.preventDefault();
        ws.setView(TASK_LAYOUTS[index - 1]!.value as TaskLayout);
        return;
      }
      if (event.key === "c") {
        event.preventDefault();
        newTask({ projectId: ws.query.projectId ?? null });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ws, newTask]);

  return (
    <div className="mb-5 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="font-heading mr-auto text-xl font-semibold tracking-tight">Tasks</h1>

        {inDestination ? (
          <Button variant="ghost" size="sm" onClick={() => ws.setView("week")} className="gap-1.5">
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to tasks
          </Button>
        ) : (
          <>
            {showIntake && (
              <DestinationButton
                icon={Inbox}
                label="Requests"
                hint={
                  intakeCount > 0
                    ? `${intakeCount} request${intakeCount === 1 ? "" : "s"} waiting on triage`
                    : "The intake queue"
                }
                count={intakeCount}
                onClick={() => ws.setView("intake")}
              />
            )}
            <DestinationButton
              icon={NotebookPen}
              label="Sunday update"
              hint={posted ? "You have posted this week" : "Draft and post this week's update"}
              dot={!posted}
              onClick={() => ws.setView("updates")}
            />
          </>
        )}

        <Button
          size="sm"
          variant="outline"
          onClick={() => setImporting(true)}
          className="gap-1.5"
          title="Paste a to-do list or meeting notes; AI turns it into tasks and events for you to check"
        >
          <Sparkles className="size-4" aria-hidden="true" />
          <span className="hidden sm:inline">Import with AI</span>
          <span className="sm:hidden">Import</span>
        </Button>
        <Button
          size="sm"
          onClick={() => newTask({ projectId: ws.query.projectId ?? null })}
          className="gap-1.5"
        >
          <Plus className="size-4" aria-hidden="true" />
          New task
          <kbd className="border-primary-foreground/30 text-primary-foreground/70 ms-0.5 hidden rounded border px-1 text-[10px] leading-4 sm:inline">
            c
          </kbd>
        </Button>
      </div>

      {!inDestination && <WorkspaceToolbar />}
      {importing && (
        <ActionItemsImport orgId={org.id} orgSlug={org.slug} open={importing} onOpenChange={setImporting} />
      )}
    </div>
  );
}

function DestinationButton({
  icon: Icon,
  label,
  hint,
  count,
  dot,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
  hint?: string;
  count?: number;
  /** A quiet "there is something to do here" marker. */
  dot?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint}
      aria-label={hint ? `${label}: ${hint}` : label}
      className={cn(
        "border-border text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-ring inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-sm font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
      )}
    >
      <Icon className="size-4" aria-hidden />
      <span className="hidden sm:inline">{label}</span>
      {count !== undefined && count > 0 && (
        <span className="bg-foreground text-background inline-flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold">
          {count}
        </span>
      )}
      {dot && <span className="bg-warning size-1.5 rounded-full" aria-hidden />}
    </button>
  );
}
