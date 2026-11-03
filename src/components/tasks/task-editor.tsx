"use client";

import { format } from "date-fns";
import { Maximize2, Trash2, UserMinus, UserPlus, X } from "@/components/icons";
import Link from "next/link";
import { useOptimistic, useRef, useState, useTransition } from "react";

import {
  acknowledgeTaskFlag,
  createTask,
  deleteTask,
  restoreTask,
  selfAssignTask,
  updateTask,
} from "@/app/app/[orgSlug]/tasks/actions";
import { PinToggle } from "@/components/pins/pins-context";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toaster";
import { UserAvatar } from "@/components/user-avatar";
import { TaskPriority, TaskStatus, TaskVisibility } from "@/generated/prisma/enums";
import { canAcknowledgeFlag, canEditTask } from "@/lib/tasks/access";
import { relationFor } from "@/lib/tasks/assignment";
import { dueDateKey } from "@/lib/tasks/dates";
import { allowedTypes, TASK_TYPES, typeLabel, type TaskTypeValue } from "@/lib/tasks/hierarchy";
import { epicColor, parentTypesFor } from "@/lib/tasks/epic";
import { canChangeVisibility, namedAudienceIds } from "@/lib/tasks/visibility";
import { cn } from "@/lib/utils";

import { useConfirmFlagged } from "./prompts";
import { Subtasks } from "./subtasks";
import { TaskActivity } from "./task-activity";
import { FlagBadge, isTaskPrivate, PrivateBadge } from "./task-badges";
import { TaskComments } from "./task-comments";
import { useHashTags } from "./use-hash-tags";
import { accessSubjectOf, useTasks, visibilitySubjectOf } from "./tasks-context";
import type { TaskItem } from "./types";
import { TaskFormFields } from "./task-form-fields";
import { AudienceList } from "./visibility-control";

/**
 * The task form, in the task window and on the task's own page. Its head,
 * fields (TaskFormFields) and foot are New task's, so creating and editing
 * read as one form; editing adds subtasks, comments and history below.
 * Create and edit:
 * title, description with @mentions, status (a reason when Blocked),
 * priority, due date (and a start date for epics and stories), what it's
 * part of (an epic, or a task's story; an epic gets a colour instead), labels, the accountable owner and "also
 * involved" collaborators, 'Created by', flags with their acknowledgement,
 * subtasks, comments and history.
 *
 * Without edit rights the fields are read-only and the self-assign
 * carve-out offers Join / Leave / Take ownership. An above-level assignment
 * asks for confirmation before it is saved.
 */

export interface TaskEditorDefaults {
  status?: TaskStatus;
  parentTaskId?: string | null;
  dueDate?: string | null;
  /** Pre-set the owner (handing work down from a Team lane). */
  ownerId?: string | null;
  /** Pre-set who can see it (a subtask inherits its parent). */
  visibility?: TaskVisibility;
  /** Epic, story or task (a plain task unless said). */
  type?: TaskTypeValue;
  /** The parent's type, when `parentTaskId` is set (which types may go under it). */
  parentType?: TaskTypeValue;
}

export function TaskEditor({
  task,
  defaults,
  onDone,
  onDeleted,
  onOpenTask,
  mode = "dialog",
  initialComments,
}: {
  task: TaskItem | null;
  defaults?: TaskEditorDefaults;
  onDone?: () => void;
  /** After a delete (defaults to onDone). */
  onDeleted?: () => void;
  onOpenTask?: (taskId: string) => void;
  /** "dialog": the side panel (its own header, scrolling body, footer). "page": a task's page. */
  mode?: "dialog" | "page";
  initialComments?: React.ComponentProps<typeof TaskComments>["initial"];
}) {
  const { org, viewer, actor, labels, memberById, members, announce, parents, parentById } =
    useTasks();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmElement, confirmFlagged] = useConfirmFlagged();
  const [confirmEl, confirm] = useConfirm();
  const hashTags = useHashTags();
  const saving = useRef(false);

  const isNew = task === null;
  const initialParentId = task?.parentTaskId ?? defaults?.parentTaskId ?? null;

  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [status, setStatus] = useState<TaskStatus>(
    task?.status ?? defaults?.status ?? TaskStatus.NOT_STARTED,
  );
  const [blockedReason, setBlockedReason] = useState(task?.blockedReason ?? "");
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? TaskPriority.MEDIUM);
  const [dueDate, setDueDate] = useState(() =>
    task?.dueDate ? dueDateKey(task.dueDate) : (defaults?.dueDate ?? ""),
  );
  const [startDate, setStartDate] = useState(() =>
    task?.startDate ? dueDateKey(task.startDate) : "",
  );
  // What it's part of (an epic, or for a task a story); picking one moves it.
  const [parentTaskId, setParentTaskId] = useState<string | null>(initialParentId);
  const [color, setColor] = useState<string | null>(task?.color ?? null);
  const [visibility, setVisibility] = useState<TaskVisibility>(
    task?.visibility ?? defaults?.visibility ?? TaskVisibility.ORG,
  );
  const [ownerId, setOwnerId] = useState<string | null>(() => {
    if (task) return task.ownerId;
    if (defaults?.ownerId !== undefined && defaults.ownerId !== null) return defaults.ownerId;
    // New tasks default to the creator ("anyone can assign to themselves").
    return viewer.userId;
  });
  const [assigneeIds, setAssigneeIds] = useState<string[]>(
    task?.assignees.map((a) => a.userId) ?? [],
  );
  const [labelIds, setLabelIds] = useState<string[]>(task?.labels.map((l) => l.label.id) ?? []);
  const [type, setType] = useState<TaskTypeValue>(task?.type ?? defaults?.type ?? "TASK");
  // Which types fit where it stands (a parent hidden from the viewer counts
  // as a story, the stricter case; the server decides anyway).
  const parentType: TaskTypeValue | null = parentTaskId
    ? ((parentById.get(parentTaskId)?.type as TaskTypeValue | undefined) ??
      (task?.parentTask?.id === parentTaskId ? task.parentTask.type : undefined) ??
      defaults?.parentType ??
      "STORY")
    : null;
  const typeChoices = TASK_TYPES.filter((o) =>
    allowedTypes({ parentType, childTypes: task?.subtasks.map((s) => s.type) ?? [] }).includes(
      o.value,
    ),
  );
  const parentChoices = parents.filter(
    (p) => p.id !== task?.id && parentTypesFor(type).includes(p.type as "EPIC" | "STORY"),
  );

  function pickType(next: TaskTypeValue) {
    setType(next);
    // An epic sits at the top; a story only inside an epic.
    if (next === "EPIC") setParentTaskId(null);
    if (next === "STORY" && parentType === "STORY") setParentTaskId(null);
  }
  // Whether it can hold subtasks: an epic or a story, or a plain task that
  // breaking down would make a story (not one already inside a story).
  const canHoldChildren = type !== "TASK" || parentType === null || parentType === "EPIC";

  const canEdit = task ? canEditTask(actor, accessSubjectOf(task)) : true;
  const readOnly = !canEdit;
  const isTopLevel = parentTaskId === null;
  // C4: a collaborator may edit a private task but must not be able to
  // publish it, and a subtask never decides on its own.
  const canSetVisibility = task
    ? canChangeVisibility(actor, visibilitySubjectOf(task)) && isTopLevel
    : isTopLevel;
  const visibilityLocked = !isTopLevel
    ? "A subtask is as private as the task it belongs to."
    : task && !canSetVisibility
      ? "Only the owner, the creator or an admin changes who can see this."
      : null;
  const audience = namedAudienceIds({
    visibility,
    ownerId,
    createdById: task?.createdById ?? viewer.userId,
    assigneeIds,
  });
  // Owners and admins are a standing audience of every private task, so
  // they stay mentionable on one even when nobody put them on it.
  const mentionAudience = [
    ...new Set([
      ...audience,
      ...members.filter((m) => m.role === "OWNER" || m.role === "ADMIN").map((m) => m.id),
    ]),
  ];
  const dueRequired = org.requireDueDate && isTopLevel;
  const hasStart = type === "EPIC" || type === "STORY";

  async function save() {
    // One save at a time: ⌘↵ held down, or pressed while the first is in flight.
    if (saving.current) return;
    saving.current = true;
    try {
      await saveOnce();
    } finally {
      saving.current = false;
    }
  }

  async function saveOnce() {
    setError(null);
    if (status === TaskStatus.BLOCKED && !blockedReason.trim()) {
      setError("Say what the task is blocked on.");
      return;
    }
    // Warn before an above-level assignment (the server checks again).
    const before = new Set([
      ...(task?.ownerId ? [task.ownerId] : []),
      ...(task?.assignees.map((a) => a.userId) ?? []),
    ]);
    const newcomers = [
      ...(ownerId && ownerId !== task?.ownerId ? [ownerId] : []),
      ...assigneeIds.filter((id) => !before.has(id)),
    ];
    const above = newcomers.filter((id) => relationFor(viewer.chart, id) === "ABOVE");
    let confirmed = false;
    if (above.length > 0) {
      confirmed = await confirmFlagged(above.map((id) => memberById.get(id)?.name ?? "Someone"));
      if (!confirmed) return;
    }
    // `#tag` in the title tags the task (making new tags as the club allows).
    let finalTitle = title;
    let finalLabelIds = labelIds;
    if (hashTags.preview(title).length > 0) {
      const resolved = await hashTags.resolve(title);
      if (resolved.error) {
        setError(resolved.error);
        return;
      }
      finalTitle = resolved.title;
      finalLabelIds = [...new Set([...labelIds, ...resolved.labelIds])];
      setTitle(finalTitle);
      setLabelIds(finalLabelIds);
    }
    const input = {
      title: finalTitle,
      description: description.trim() ? description : null,
      status,
      blockedReason: status === TaskStatus.BLOCKED ? blockedReason.trim() : null,
      priority,
      dueDate: dueDate || null,
      // Epics and stories have a start (the Roadmap); a plain task doesn't.
      ...(hasStart || task?.startDate ? { startDate: hasStart ? startDate || null : null } : {}),
      // An epic sits at the top; anything else goes where "Part of" says.
      ...(isNew || parentTaskId !== task?.parentTaskId || type === "EPIC"
        ? { parentTaskId: type === "EPIC" ? null : parentTaskId }
        : {}),
      ...(type === "EPIC" ? { color } : {}),
      ownerId,
      openToAnyone: ownerId === null,
      assigneeIds: assigneeIds.filter((id) => id !== ownerId),
      labelIds: finalLabelIds,
      ...(isNew || type !== task?.type ? { type } : {}),
      ...(canSetVisibility ? { visibility } : {}),
      confirmFlagged: confirmed,
    };
    // Resolves once the save is over, so the guard in save() holds until then.
    await new Promise<void>((done) =>
      startTransition(async () => {
        try {
          const send = (extra: { confirmFlagged: boolean }) =>
            task
              ? updateTask(org.id, task.id, { ...input, ...extra, expectedVersion: task.version })
              : createTask(org.id, { ...input, ...extra });
          let result = await send({ confirmFlagged: confirmed });
          if ("confirm" in result && result.confirm) {
            const ok = await confirmFlagged(result.confirm.flagged.map((f) => f.name ?? "Someone"));
            if (!ok) return;
            result = await send({ confirmFlagged: true });
          }
          if (result.error) {
            setError(result.error);
            return;
          }
          onDone?.();
        } finally {
          done();
        }
      }),
    );
  }

  async function remove() {
    if (!task) return;
    const subtasks = task.subtasks?.length ?? 0;
    const ok = await confirm({
      title: `Delete “${task.title}”?`,
      description:
        subtasks > 0
          ? `Its ${subtasks} subtask${subtasks === 1 ? "" : "s"} go${subtasks === 1 ? "es" : ""} with it. You can undo this right after.`
          : "You can undo this right after.",
      confirmLabel: `Delete ${typeLabel(type).toLowerCase()}`,
      run: async () => (await deleteTask(org.id, task.id)).error,
    });
    if (!ok) return;
    (onDeleted ?? onDone)?.();
    toast({
      title: `${typeLabel(type)} deleted`,
      description: task.title,
      action: {
        label: "Undo",
        run: async () => (await restoreTask(org.id, task.id)).error,
      },
    });
  }

  function selfAssign(action: "join" | "leave" | "claim") {
    if (!task) return;
    startTransition(async () => {
      setSelf(action);
      const result = await selfAssignTask(org.id, task.id, action);
      if (result.error) {
        announce(result.error);
        return;
      }
      if (action === "join") setAssigneeIds((ids) => [...ids, viewer.userId]);
      if (action === "leave") setAssigneeIds((ids) => ids.filter((id) => id !== viewer.userId));
      if (action === "claim") setOwnerId(viewer.userId);
    });
  }

  function acknowledge(userId: string) {
    if (!task) return;
    startTransition(async () => {
      const result = await acknowledgeTaskFlag(org.id, task.id, userId);
      if (result.error) announce(result.error);
    });
  }

  const flaggedPeople = task
    ? [
        ...(task.ownerFlagged && task.ownerId
          ? [{ userId: task.ownerId, role: "owner" as const }]
          : []),
        ...task.assignees
          .filter((a) => a.flagged && !a.flagAcknowledgedAt)
          .map((a) => ({ userId: a.userId, role: "collaborator" as const })),
      ]
    : [];
  // Self-assignment shows at once (useOptimistic) while the action runs.
  const [self, setSelf] = useOptimistic(
    {
      owner: task?.ownerId === viewer.userId,
      joined: task?.assignees.some((a) => a.userId === viewer.userId) ?? false,
    },
    (state, action: "join" | "leave" | "claim") =>
      action === "claim" ? { ...state, owner: true } : { ...state, joined: action === "join" },
  );
  const involved = self.owner || self.joined;
  const isAssignee = self.joined;

  const noun = typeLabel(type).toLowerCase();
  const heading = isNew ? `New ${noun}` : readOnly ? typeLabel(type) : `Edit ${noun}`;

  // The same foot as New task: Cancel and the save button on the right,
  // with Delete on the left once there's something to delete.
  const footer = (
    <div
      className={cn(
        "flex shrink-0 items-center gap-2",
        mode === "dialog" ? "border-t px-6 py-4" : "px-6 pb-2",
      )}
    >
      {task && canEdit && (
        <Button
          type="button"
          variant="destructive"
          onClick={() => void remove()}
          disabled={isPending}
        >
          <Trash2 className="size-4" aria-hidden="true" />
          Delete {noun}
        </Button>
      )}
      <span className="flex-1" />
      {mode === "dialog" && onDone && (
        <Button type="button" variant="outline" onClick={onDone}>
          {canEdit ? "Cancel" : "Close"}
        </Button>
      )}
      {canEdit && (
        <Button type="button" onClick={() => void save()} disabled={isPending || !title.trim()}>
          {isPending ? "Saving…" : isNew ? `Create ${noun}` : "Save"}
        </Button>
      )}
    </div>
  );

  const form = (
    <TaskFormFields
      title={{ value: title, set: (next) => setTitle(next.replace(/\n/g, " ")) }}
      type={{ value: type, set: pickType }}
      typeChoices={typeChoices}
      priority={{ value: priority, set: setPriority }}
      owner={{ value: ownerId, set: setOwnerId }}
      ownerAbove={
        ownerId !== null &&
        ownerId !== task?.ownerId &&
        relationFor(viewer.chart, ownerId) === "ABOVE"
      }
      people={{ value: assigneeIds, set: setAssigneeIds }}
      parent={{ value: parentTaskId, set: setParentTaskId }}
      parentChoices={parentChoices}
      color={{ value: color, set: setColor }}
      due={{ value: dueDate, set: setDueDate }}
      dueRequired={dueRequired}
      description={{ value: description, set: setDescription }}
      descriptionAudience={visibility === TaskVisibility.PRIVATE ? mentionAudience : null}
      linkFrom={task ? { kind: "task", id: task.id } : null}
      onSubmitShortcut={() => void save()}
      labels={{ value: labelIds, set: setLabelIds }}
      labelOptions={labels}
      status={{ value: status, set: setStatus }}
      visibility={{ value: visibility, set: setVisibility }}
      visibilityLocked={visibilityLocked}
      visibilityExtra={
        visibility === TaskVisibility.PRIVATE && (
          <div className="bg-card rounded-[11px] border p-3">
            <AudienceList
              ownerId={ownerId}
              createdById={task?.createdById ?? viewer.userId}
              assigneeIds={assigneeIds}
            />
            <p className="text-muted-foreground mt-2 text-xs">
              {audience.length === 1
                ? "Only you, and the organization's owners and admins."
                : `${audience.length} people plus owners and admins.`}{" "}
              Comments, history and @mentions on it are hidden too. To mention somebody else, add
              them here first.
            </p>
          </div>
        )
      }
      start={{ value: startDate, set: setStartDate }}
      blockedReason={{ value: blockedReason, set: setBlockedReason }}
      error={error}
      readOnly={readOnly}
      autoFocus={isNew}
    />
  );

  const notices = (
    <>
      {task?.parentTask && (
        <p className="text-muted-foreground text-sm">
          Subtask of{" "}
          {onOpenTask ? (
            <button
              type="button"
              className="text-foreground underline-offset-4 hover:underline"
              onClick={() => onOpenTask(task.parentTask!.id)}
            >
              {task.parentTask.title}
            </button>
          ) : (
            <Link
              className="text-foreground underline-offset-4 hover:underline"
              href={`/app/${org.slug}/tasks/${task.parentTask.id}`}
            >
              {task.parentTask.title}
            </Link>
          )}
        </p>
      )}

      {flaggedPeople.length > 0 && (
        <div className="border-warning/40 bg-warning/10 space-y-2 rounded-[11px] border p-3 text-sm">
          {flaggedPeople.map((f) => (
            <div key={`${f.role}-${f.userId}`} className="flex flex-wrap items-center gap-2">
              <FlagBadge />
              <span className="min-w-0 flex-1">
                {memberById.get(f.userId)?.name ?? "Someone"} was given this task by someone below
                them on the org chart.
              </span>
              {canAcknowledgeFlag(actor, f.userId) && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isPending}
                  onClick={() => acknowledge(f.userId)}
                >
                  Acknowledge
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {task && readOnly && (
        <div className="bg-card flex flex-wrap items-center gap-2 rounded-[11px] border p-3 text-sm">
          <span className="text-muted-foreground min-w-0 flex-1">
            Only the creator, owner, collaborators, their managers and admins edit this task. You
            can still add yourself.
          </span>
          {self.owner && <span className="text-sm font-medium">You own this task.</span>}
          {self.joined && <span className="text-sm font-medium">You&apos;re on this task.</span>}
          {!task.ownerId && !self.owner && (
            <Button
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() => selfAssign("claim")}
            >
              Take ownership
            </Button>
          )}
          {!involved && (
            <Button
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() => selfAssign("join")}
            >
              <UserPlus className="size-4" /> Join
            </Button>
          )}
        </div>
      )}
    </>
  );

  const extras = task && (
    <div className="space-y-6 border-t pt-5">
      {canHoldChildren && (
        <Subtasks
          parentId={task.id}
          parentType={task.type}
          subtasks={task.subtasks}
          canAdd={canEdit}
          onOpen={onOpenTask}
          projectColor={task.type === "EPIC" ? epicColor(task) : "var(--chart-1)"}
        />
      )}
      <section className="space-y-2 border-t pt-5">
        <h3 className="heading text-sm">Comments</h3>
        <TaskComments
          taskId={task.id}
          initial={initialComments}
          audience={visibility === TaskVisibility.PRIVATE ? mentionAudience : null}
        />
      </section>
      <section className="space-y-2 border-t pt-5">
        <h3 className="heading text-sm">History</h3>
        <TaskActivity taskId={task.id} />
      </section>
    </div>
  );

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col",
        mode === "dialog" ? "flex-1" : "bg-card rounded-xl border",
      )}
      onKeyDown={(e) => {
        // A field that already handled ⌘↵ (the description) marks it.
        if (e.defaultPrevented) return;
        if (
          (e.metaKey || e.ctrlKey) &&
          e.key === "Enter" &&
          canEdit &&
          title.trim() &&
          !isPending
        ) {
          e.preventDefault();
          void save();
        }
      }}
    >
      {confirmElement}
      {confirmEl}

      {/* The same head as New task, with the task's own buttons on the right. */}
      <header className="flex shrink-0 items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div className="flex min-w-0 flex-col gap-2">
          <h2 className="heading flex items-center gap-2 text-lg leading-tight">
            {heading}
            {task && isTaskPrivate(task) && <PrivateBadge />}
          </h2>
          <p className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-sm">
            {task ? (
              <>
                Created by
                <UserAvatar user={task.createdBy} size="xs" />
                <span className="text-foreground">{task.createdBy.name ?? "a former member"}</span>
                on {format(new Date(task.createdAt), "MMM d, yyyy")}
              </>
            ) : type === "EPIC" ? (
              "A big outcome that spans weeks. Its stories and tasks roll up into it."
            ) : (
              "A title is all it takes. Everything else has a sensible default."
            )}
          </p>
        </div>
        <div className="-me-2 -mt-1.5 flex shrink-0 items-center gap-1">
          {task && <PinToggle path={`/tasks/${task.id}`} label={task.title} />}
          {task && mode === "dialog" && (
            <Button asChild variant="ghost" size="icon-sm">
              <Link
                href={`/app/${org.slug}/tasks/${task.id}`}
                aria-label="Open as a page"
                title="Open as a page"
              >
                <Maximize2 className="size-4" aria-hidden="true" />
              </Link>
            </Button>
          )}
          {task && !readOnly && isAssignee && (
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={isPending}
              onClick={() => selfAssign("leave")}
              aria-label="Leave this task"
              title="Leave this task"
            >
              <UserMinus className="size-4" aria-hidden="true" />
            </Button>
          )}
          {mode === "dialog" && onDone && (
            <Button variant="ghost" size="icon-sm" onClick={onDone} aria-label="Close">
              <X className="size-4" aria-hidden="true" />
            </Button>
          )}
        </div>
      </header>

      <div
        className={cn(
          "min-h-0 flex-1",
          mode === "dialog" &&
            "[scrollbar-width:thin] overflow-x-hidden overflow-y-auto overscroll-contain",
        )}
      >
        {(task?.parentTask || flaggedPeople.length > 0 || (task && readOnly)) && (
          <div className="flex flex-col gap-3 px-6 pt-2">{notices}</div>
        )}
        {form}
        {mode === "page" && footer}
        {extras && <div className="px-6 pb-6">{extras}</div>}
      </div>

      {mode === "dialog" && footer}
    </div>
  );
}
