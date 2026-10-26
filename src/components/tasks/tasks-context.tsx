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

import { NewTaskDialog } from "./new-task-dialog";
import { TaskDetailSheet } from "./task-detail-sheet";
import type { TaskEditorDefaults } from "./task-editor";
import type {
  FileOption,
  LabelOption,
  MemberOption,
  ParentOption,
  TaskItem,
  TasksCan,
  TasksOrg,
  TasksViewer,
} from "./types";

/**
 * Everything the task layouts share: the org, the viewer (role, chart view
 * for hand-down warnings), members, labels, the epics and stories work can
 * sit in, one status message
 * area for optimistic actions that fail, and ONE task detail surface.
 *
 * The detail surface living here is the point: every layout — the week, the
 * board, the table, the list, the dashboard — opens
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
  /** The club's files, for the `/` picker in a title or a description. */
  files: FileOption[];
  /** Live epics and stories (what work can be part of). */
  parents: ParentOption[];
  /** The epics alone, done ones last. */
  epics: ParentOption[];
  parentById: Map<string, ParentOption>;
  /** What the viewer may make on the spot (the club's creation rules). */
  can: TasksCan;
  /** An epic just made inline (a picker's "Create epic"): usable at once. */
  addParent: (parent: ParentOption) => void;
  /** A tag just made inline: usable at once, before the page refreshes. */
  addLabel: (label: LabelOption) => void;
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
  files = [],
  parents,
  can,
  children,
}: {
  org: TasksOrg;
  viewer: TasksViewer;
  members: MemberOption[];
  labels: LabelOption[];
  /** The club's files (none passed: the `/` picker has nothing to offer). */
  files?: FileOption[];
  parents: ParentOption[];
  /** The club's creation rules for this viewer (admins only when left out). */
  can?: TasksCan;
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

  // Made inline in a picker: shown at once, and dropped again once the
  // server's list (after refresh) carries them.
  const [madeLabels, setMadeLabels] = useState<LabelOption[]>([]);
  const [madeParents, setMadeParents] = useState<ParentOption[]>([]);
  const addParent = useCallback(
    (p: ParentOption) => setMadeParents((xs) => [...xs.filter((x) => x.id !== p.id), p]),
    [],
  );
  const allParents = useMemo(() => {
    const known = new Set(parents.map((p) => p.id));
    const extra = madeParents.filter((p) => !known.has(p.id));
    return extra.length === 0 ? parents : [...parents, ...extra];
  }, [parents, madeParents]);
  const addLabel = useCallback(
    (l: LabelOption) => setMadeLabels((xs) => [...xs.filter((x) => x.id !== l.id), l]),
    [],
  );
  const epics = useMemo(() => allParents.filter((p) => p.type === "EPIC"), [allParents]);
  const allLabels = useMemo(() => {
    const known = new Set(labels.map((l) => l.id));
    const extra = madeLabels.filter((l) => !known.has(l.id));
    return extra.length === 0
      ? labels
      : [...labels, ...extra].sort((a, b) => a.name.localeCompare(b.name));
  }, [labels, madeLabels]);

  const value = useMemo<TasksContextValue>(
    () => ({
      org,
      viewer,
      actor: { userId: viewer.userId, isAdmin: viewer.isAdmin, subtree: viewer.chart.subtree },
      members,
      memberById: new Map(members.map((m) => [m.id, m])),
      labels: allLabels,
      files,
      parents: allParents,
      epics,
      parentById: new Map(allParents.map((p) => [p.id, p])),
      can: can ?? { createTags: true },
      addParent,
      addLabel,
      announce,
      openTask,
      showTask,
      newTask,
      isLoadingTask,
    }),
    [
      org,
      viewer,
      members,
      allLabels,
      files,
      allParents,
      epics,
      can,
      addParent,
      addLabel,
      announce,
      openTask,
      showTask,
      newTask,
      isLoadingTask,
    ],
  );

  return (
    <TasksContext.Provider value={value}>
      {children}
      <TaskDetailSheet
        open={open && task !== null}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setTask(null);
        }}
        task={task}
        defaults={defaults}
        onOpenTask={openTask}
        busy={isLoadingTask}
      />
      {/* A new task opens centred, like New event; an existing one in the side panel. */}
      <NewTaskDialog
        open={open && task === null}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setTask(null);
        }}
        defaults={defaults}
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
  task: Pick<TaskItem, "createdById" | "ownerId" | "assignees">,
): TaskAccessSubject {
  return {
    createdById: task.createdById,
    ownerId: task.ownerId,
    assigneeIds: task.assignees.map((a) => a.userId),
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
