"use client";

import { format } from "date-fns";
import { Maximize2, Plus, Trash2, UserMinus, UserPlus, X } from "@/components/icons";
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
import { useModKey } from "@/components/command-palette/use-mod-key";
import { PinToggle } from "@/components/pins/pins-context";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { UserAvatar } from "@/components/user-avatar";
import { TaskPriority, TaskStatus, TaskVisibility } from "@/generated/prisma/enums";
import { canAcknowledgeFlag, canEditTask } from "@/lib/tasks/access";
import { relationFor } from "@/lib/tasks/assignment";
import { dueDateKey } from "@/lib/tasks/dates";
import { allowedTypes, TASK_TYPES, typeLabel, type TaskTypeValue } from "@/lib/tasks/hierarchy";
import { LABEL_COLOR_PALETTE } from "@/lib/label-colors";
import { epicColor, parentTypesFor } from "@/lib/tasks/epic";
import { MAX_BLOCKED_REASON } from "@/lib/tasks/status";
import { canChangeVisibility, namedAudienceIds } from "@/lib/tasks/visibility";
import { cn } from "@/lib/utils";

import { MentionTextarea } from "./mention-textarea";
import { TaskTitle } from "./task-title";
import { TitleTextarea } from "./task-title-field";
import { useConfirmFlagged } from "./prompts";
import { Subtasks } from "./subtasks";
import { TaskActivity } from "./task-activity";
import { FlagBadge, isTaskPrivate, PrivateBadge } from "./task-badges";
import { TaskComments } from "./task-comments";
import {
  DueField,
  Field,
  FieldLabel,
  LabelsField,
  OwnerField,
  PeopleField,
  PRIORITY_OPTIONS,
  PartOfField,
  SegmentBox,
  STATUS_OPTIONS,
  VISIBILITY_OPTIONS,
} from "./task-fields";
import { TaskMarkdown } from "./task-markdown";
import { TaskTypeChip, TYPE_OPTIONS } from "./task-type";
import { HashTagHint } from "./tag-menu";
import { useHashTags } from "./use-hash-tags";
import { accessSubjectOf, useTasks, visibilitySubjectOf } from "./tasks-context";
import type { TaskItem } from "./types";
import { AudienceList } from "./visibility-control";

/**
 * The task form, in the side panel and on the task's own page, laid out as
 * the task drawer design has it: the title and description set straight on
 * the panel, then labelled fields (dropdown wells, and segments for status,
 * priority and who can see it), with Cancel and Create (⌘↵) along the
 * bottom.
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
  const { org, viewer, actor, labels, memberById, members, announce, parentById } = useTasks();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmElement, confirmFlagged] = useConfirmFlagged();
  const [confirmEl, confirm] = useConfirm();
  const hashTags = useHashTags();
  const mod = useModKey();
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
  const typeOptions = TYPE_OPTIONS.filter((o) =>
    allowedTypes({ parentType, childTypes: task?.subtasks.map((s) => s.type) ?? [] }).includes(
      o.value,
    ),
  );
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
  const ownerRequired = org.requireOwner && isTopLevel;
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

  const heading = isNew ? `New ${typeLabel(type).toLowerCase()}` : typeLabel(type);
  const visibilityHint =
    visibility === TaskVisibility.PRIVATE
      ? "Only the people on it, plus the club's owners and admins, can see this task."
      : "Anyone in the club can find and open this task.";

  const footer = (
    <div
      className={cn("flex items-center gap-2", mode === "dialog" ? "border-t px-5 py-3.5" : "pt-1")}
    >
      {task && canEdit && (
        <Button
          type="button"
          variant="destructive"
          onClick={() => void remove()}
          disabled={isPending}
        >
          <Trash2 className="size-4" aria-hidden="true" />
          Delete {typeLabel(type).toLowerCase()}
        </Button>
      )}
      <span className="flex-1" />
      {mode === "dialog" && onDone && (
        <Button type="button" variant="outline" size="lg" className="px-4" onClick={onDone}>
          {canEdit ? "Cancel" : "Close"}
        </Button>
      )}
      {canEdit && (
        <Button
          type="button"
          size="lg"
          className="gap-3 ps-[18px] pe-2"
          onClick={() => void save()}
          disabled={isPending || !title.trim()}
        >
          {isPending ? "Saving…" : isNew ? `Create ${typeLabel(type).toLowerCase()}` : "Save"}
          <span aria-hidden="true" className="hidden gap-0.5 sm:inline-flex">
            <kbd className="bg-primary-foreground/15 inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] px-1 font-mono text-[11px] font-semibold">
              {mod}
            </kbd>
            <kbd className="bg-primary-foreground/15 inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] font-mono text-[11px] font-semibold">
              ↵
            </kbd>
          </span>
        </Button>
      )}
    </div>
  );

  const form = (
    <div className="flex flex-col gap-[18px]">
      {/* Title and description, set straight onto the panel. */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="task-title" className="sr-only">
          Title
        </label>
        {readOnly ? (
          // Nothing to type into: the title reads as text, and its file
          // references are the links through to the files.
          <p className="text-[26px] leading-[1.25] font-semibold tracking-[-0.015em]">
            <TaskTitle linked>{title || "Untitled task"}</TaskTitle>
          </p>
        ) : (
          <TitleTextarea
            id="task-title"
            rows={1}
            value={title}
            autoFocus={isNew}
            placeholder="Untitled task"
            onChange={(next) => setTitle(next.replace(/\n/g, " "))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) e.preventDefault();
            }}
            className="placeholder:text-muted-foreground/70 field-sizing-content w-full resize-none border-0 bg-transparent p-0 text-[26px] leading-[1.25] font-semibold tracking-[-0.015em] outline-none disabled:opacity-100"
          />
        )}
        {!readOnly && <HashTagHint title={title} />}
        <label htmlFor="task-description" className="sr-only">
          Description
        </label>
        {readOnly ? (
          description ? (
            <TaskMarkdown className="text-foreground/80 text-sm">{description}</TaskMarkdown>
          ) : (
            <p className="text-muted-foreground text-sm">No description.</p>
          )
        ) : (
          <MentionTextarea
            id="task-description"
            audience={visibility === TaskVisibility.PRIVATE ? mentionAudience : null}
            value={description}
            onChange={setDescription}
            onSubmitShortcut={() => void save()}
            rows={2}
            placeholder="Add a description. Markdown, @mentions and /file links work."
            className="text-foreground/80 placeholder:text-muted-foreground/70 field-sizing-content min-h-0 resize-none rounded-none border-0 bg-transparent p-0 text-sm leading-[1.55] shadow-none focus-visible:ring-0 md:text-sm dark:bg-transparent"
          />
        )}
      </div>

      {typeOptions.length > 1 && (
        <Field>
          <FieldLabel htmlFor="task-type">Type</FieldLabel>
          <SegmentBox
            id="task-type"
            label="Type"
            value={type}
            onChange={setType}
            options={typeOptions}
            disabled={readOnly}
          />
          <p className="text-muted-foreground text-xs">
            {TASK_TYPES.find((t) => t.value === type)?.hint}
            {type === "EPIC" && ". Its progress rolls up from the stories and tasks inside it."}
          </p>
        </Field>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="task-owner" required={ownerRequired}>
            Owner
          </FieldLabel>
          <OwnerField
            id="task-owner"
            value={ownerId}
            onChange={setOwnerId}
            disabled={readOnly}
            allowNone={!ownerRequired}
          />
          {ownerId &&
            relationFor(viewer.chart, ownerId) === "ABOVE" &&
            ownerId !== task?.ownerId && (
              <p className="text-warning text-xs">
                Above your level: this assignment will be flagged.
              </p>
            )}
        </Field>
        <Field>
          <FieldLabel htmlFor="task-involved" optional>
            Involved people
          </FieldLabel>
          <PeopleField
            id="task-involved"
            value={assigneeIds}
            onChange={setAssigneeIds}
            exclude={ownerId}
            disabled={readOnly}
          />
        </Field>
      </div>

      {hasStart && (
        <Field>
          <FieldLabel htmlFor="task-start-date" optional>
            Start date
          </FieldLabel>
          <DueField
            id="task-start-date"
            label="Start date"
            emptyLabel="No start date"
            value={startDate}
            onChange={setStartDate}
            disabled={readOnly}
          />
        </Field>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="task-due-date" required={dueRequired}>
            Due date
          </FieldLabel>
          <DueField id="task-due-date" value={dueDate} onChange={setDueDate} disabled={readOnly} />
        </Field>
        {type === "EPIC" ? (
          <Field>
            <FieldLabel htmlFor="task-color" optional>
              Colour
            </FieldLabel>
            <div
              id="task-color"
              role="radiogroup"
              aria-label="Epic colour"
              className="flex flex-wrap items-center gap-1.5 py-1.5"
            >
              <button
                type="button"
                role="radio"
                aria-checked={color === null}
                aria-label="Theme colour"
                title="Theme colour"
                disabled={readOnly}
                onClick={() => setColor(null)}
                className={cn(
                  "focus-glow hatch bg-muted size-6 rounded-full transition-transform active:scale-[0.94]",
                  color === null && "ring-foreground ring-offset-card ring-2 ring-offset-2",
                )}
              />
              {LABEL_COLOR_PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={color === c}
                  aria-label={`Colour ${c}`}
                  disabled={readOnly}
                  onClick={() => setColor(c)}
                  className={cn(
                    "focus-glow size-6 rounded-full transition-transform active:scale-[0.94]",
                    color === c && "ring-foreground ring-offset-card ring-2 ring-offset-2",
                  )}
                  style={{ background: c }}
                />
              ))}
            </div>
          </Field>
        ) : (
          <Field>
            <FieldLabel htmlFor="task-parent" optional>
              Part of
            </FieldLabel>
            <PartOfField
              id="task-parent"
              value={parentTaskId}
              onChange={setParentTaskId}
              types={parentTypesFor(type)}
              disabled={readOnly}
              current={task?.parentTask ?? null}
              excludeId={task?.id}
            />
          </Field>
        )}
      </div>

      <Field>
        <FieldLabel htmlFor="task-status">Status</FieldLabel>
        <SegmentBox
          id="task-status"
          label="Status"
          value={status}
          onChange={setStatus}
          options={STATUS_OPTIONS}
          disabled={readOnly}
        />
        {status === TaskStatus.BLOCKED && (
          <Textarea
            id="task-blocked-reason"
            aria-label="Blocked on"
            value={blockedReason}
            maxLength={MAX_BLOCKED_REASON}
            rows={2}
            disabled={readOnly}
            placeholder="What is it blocked on?"
            onChange={(e) => setBlockedReason(e.target.value)}
            className="bg-card dark:bg-card min-h-0 rounded-[11px] text-[13px]"
          />
        )}
      </Field>

      <Field>
        <FieldLabel htmlFor="task-priority">Priority</FieldLabel>
        <SegmentBox
          id="task-priority"
          label="Priority"
          value={priority}
          onChange={setPriority}
          options={PRIORITY_OPTIONS}
          disabled={readOnly}
        />
      </Field>

      <Field>
        <FieldLabel htmlFor="task-labels" optional>
          Tags
        </FieldLabel>
        <LabelsField
          id="task-labels"
          labels={labels}
          value={labelIds}
          onChange={setLabelIds}
          disabled={readOnly}
        />
      </Field>

      <Field>
        <FieldLabel htmlFor="task-visibility">Who can see it</FieldLabel>
        <SegmentBox
          id="task-visibility"
          label="Who can see this task"
          value={visibility}
          onChange={setVisibility}
          options={VISIBILITY_OPTIONS}
          disabled={readOnly || !canSetVisibility}
        />
        <p className="text-muted-foreground text-xs">{visibilityLocked ?? visibilityHint}</p>
        {visibility === TaskVisibility.PRIVATE && (
          <div className="bg-card rounded-[11px] border p-3">
            <AudienceList
              ownerId={ownerId}
              createdById={task?.createdById ?? viewer.userId}
              assigneeIds={assigneeIds}
            />
            <p className="text-muted-foreground mt-2 text-xs">
              {audience.length === 1
                ? "Only you, and the club owners and admins."
                : `${audience.length} people plus owners and admins.`}{" "}
              Comments, history and @mentions on it are hidden too. To mention somebody else, add
              them here first.
            </p>
          </div>
        )}
      </Field>

      {task && (
        <p className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs">
          Created by
          <UserAvatar user={task.createdBy} size="xs" />
          <span className="text-foreground">{task.createdBy.name ?? "a former member"}</span>
          on {format(new Date(task.createdAt), "MMM d, yyyy")}
        </p>
      )}
    </div>
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
    <div className="space-y-6">
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
        mode === "dialog" ? "h-full" : "bg-background rounded-xl border",
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

      <header className="flex shrink-0 items-center justify-between gap-2 py-3.5 ps-6 pe-3.5">
        <div className="flex min-w-0 items-center gap-2.5">
          {isNew ? (
            <span
              aria-hidden="true"
              className="bg-muted grid size-6 shrink-0 place-items-center rounded-full"
            >
              <Plus className="size-3.5" strokeWidth={2.2} />
            </span>
          ) : (
            <TaskTypeChip type={type} iconOnly />
          )}
          <span className="truncate text-sm font-semibold">{heading}</span>
          {task && isTaskPrivate(task) && <PrivateBadge />}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
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
          "min-h-0 flex-1 space-y-[18px] px-6 pb-6",
          mode === "dialog" && "overflow-y-auto",
        )}
      >
        {notices}
        {form}
        {error && (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        )}
        {mode === "page" && footer}
        {extras}
      </div>

      {mode === "dialog" && footer}
    </div>
  );
}
