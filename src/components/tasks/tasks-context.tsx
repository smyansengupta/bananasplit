"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

import type { TaskAccessSubject, TaskActor } from "@/lib/tasks/access";
import { cn } from "@/lib/utils";

import type { LabelOption, MemberOption, ProjectOption, TaskItem, TasksOrg, TasksViewer } from "./types";

/**
 * Everything the task views share: the org, the viewer (role, chart view for
 * hand-down warnings), members, labels and projects, plus a small status
 * message area for optimistic actions that fail.
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
    }),
    [org, viewer, members, labels, projects, announce],
  );

  return (
    <TasksContext.Provider value={value}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className={cn(
          "bg-foreground text-background fixed right-4 bottom-4 z-50 max-w-sm rounded-md px-4 py-3 text-sm shadow-lg transition-opacity",
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
export function accessSubjectOf(task: Pick<TaskItem, "createdById" | "ownerId" | "assignees" | "project">): TaskAccessSubject {
  return {
    createdById: task.createdById,
    ownerId: task.ownerId,
    assigneeIds: task.assignees.map((a) => a.userId),
    isIntake: task.project?.isIntake ?? false,
    triageUserId: task.project?.triageUserId ?? null,
  };
}
