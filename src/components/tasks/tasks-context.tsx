"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import { loadTaskDetail } from "@/app/app/[orgSlug]/tasks/actions";
import type { TaskAccessSubject, TaskActor } from "@/lib/tasks/access";
import type { TaskVisibilitySubject } from "@/lib/tasks/visibility";
import { cn } from "@/lib/utils";

import { TaskDetailSheet } from "./task-detail-sheet";
import type { TaskEditorDefaults } from "./task-editor";
import type {
  LabelOption,
  MemberOption,
  ProjectOption,
  TaskItem,
  TasksOrg,
  TasksViewer,
} from "./types";

/**
 * Everything the task layouts share: the org, the viewer (role, chart view
 * for hand-down warnings), members, labels and projects, one status message
 * area for optimistic actions that fail, and ONE task detail surface.
 *
 * The detail surface living here is the point: every layout — the week, the
 * board, the table, the calendar, the team lanes, the request queue — opens
 * the same panel with the same controls, so a task looks and behaves the
 * same wherever you found it.
 */

interface TasksContextValue {
  org: TasksOrg;
  viewer: TasksViewer;
  actor: TaskActor;
  members: MemberOption[];
  memberById: Map<string, MemberOption>;
  labels: LabelOption[];
  projects: ProjectOption[];
  projectById: Map<string, ProjectOption>;
  /** Shows a short message (e.g. a refused optimistic change). */
  announce: (message: string) => void;
  /** Opens a task's detail panel from anywhere. */
  openTask: (taskId: string) => void;
  /** Opens the panel on a task already loaded by this layout (no round trip). */
  showTask: (task: TaskItem) => void;
  /** Opens the panel ready to create one. */
  newTask: (defaults?: TaskEditorDefaults) => void;
  isLoadingTask: boolean;
}

const TasksContext = createContext<TasksContextValue | null>(null);

export function TasksProvider({
  org,
  viewer,
  members,
  labels,
  projects,
  children,
}: {
  org: TasksOrg;
  viewer: TasksViewer;
  members: MemberOption[];
  labels: LabelOption[];
  projects: ProjectOption[];
  children: React.ReactNode;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const announce = useCallback((text: string) => {
    setMessage(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), 6000);
  }, []);

  const [open, setOpen] = useState(false);
  const [task, setTask] = useState<TaskItem | null>(null);
  const [defaults, setDefaults] = useState<TaskEditorDefaults | undefined>(undefined);
  const [isLoadingTask, startLoad] = useTransition();

  const showTask = useCallback((next: TaskItem) => {
    setDefaults(undefined);
    setTask(next);
    setOpen(true);
  }, []);

  const openTask = useCallback(
    (taskId: string) => {
      startLoad(async () => {
        const loaded = await loadTaskDetail(org.id, taskId);
        if (!loaded) {
          announce("That task is no longer available to you.");
          return;
        }
        setDefaults(undefined);
        setTask(loaded);
        setOpen(true);
      });
    },
    [org.id, announce],
  );

  const newTask = useCallback((next?: TaskEditorDefaults) => {
    setTask(null);
    setDefaults(next);
    setOpen(true);
  }, []);

  const value = useMemo<TasksContextValue>(
    () => ({
      org,
      viewer,
      actor: { userId: viewer.userId, isAdmin: viewer.isAdmin, subtree: viewer.chart.subtree },
      members,
      memberById: new Map(members.map((m) => [m.id, m])),
      labels,
      projects,
      projectById: new Map(projects.map((p) => [p.id, p])),
      announce,
      openTask,
      showTask,
      newTask,
      isLoadingTask,
    }),
    [org, viewer, members, labels, projects, announce, openTask, showTask, newTask, isLoadingTask],
  );

  return (
    <TasksContext.Provider value={value}>
      {children}
      <TaskDetailSheet
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setTask(null);
        }}
        task={task}
        defaults={defaults}
        onOpenTask={openTask}
        busy={isLoadingTask}
      />
      <div
        role="status"
        aria-live="polite"
        className={cn(
          "bg-foreground text-background fixed right-4 bottom-4 z-50 max-w-sm rounded-md px-4 py-3 text-sm shadow-lg transition-opacity duration-200",
          message ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        {message}
      </div>
    </TasksContext.Provider>
  );
}

export function useTasks(): TasksContextValue {
  const ctx = useContext(TasksContext);
  if (!ctx) throw new Error("useTasks must be used inside <TasksProvider>");
  return ctx;
}

/** The access-rule view of a loaded task. */
export function accessSubjectOf(
  task: Pick<TaskItem, "createdById" | "ownerId" | "assignees" | "project">,
): TaskAccessSubject {
  return {
    createdById: task.createdById,
    ownerId: task.ownerId,
    assigneeIds: task.assignees.map((a) => a.userId),
    isIntake: task.project?.isIntake ?? false,
    triageUserId: task.project?.triageUserId ?? null,
  };
}

/** The visibility-rule view of a loaded task (C4). */
export function visibilitySubjectOf(
  task: Pick<TaskItem, "visibility" | "createdById" | "ownerId" | "assignees">,
): TaskVisibilitySubject {
  return {
    visibility: task.visibility,
    ownerId: task.ownerId,
    createdById: task.createdById,
    assigneeIds: task.assignees.map((a) => a.userId),
  };
}

/** The layout / scope / filter state (C4). Re-exported so layouts import once. */
export { useWorkspaceState as useWorkspace } from "./workspace-context";
