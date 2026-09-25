"use client";

import { format } from "date-fns";
import { ExternalLink, UserMinus, UserPlus } from "lucide-react";
import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";

import {
  acknowledgeTaskFlag,
  createTask,
  deleteTask,
  selfAssignTask,
  updateTask,
} from "@/app/app/[orgSlug]/tasks/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/user-avatar";
import { TaskPriority, TaskStatus, TaskVisibility } from "@/generated/prisma/enums";
import { canAcknowledgeFlag, canEditTask, canTriage } from "@/lib/tasks/access";
import { relationFor } from "@/lib/tasks/assignment";
import { addDaysToKey, dueDateKey } from "@/lib/tasks/dates";
import { MAX_BLOCKED_REASON } from "@/lib/tasks/status";
import { canChangeVisibility, namedAudienceIds } from "@/lib/tasks/visibility";

import { LabelPicker } from "./label-picker";
import { CollaboratorsPicker, OwnerPicker } from "./member-picker";
import { MentionTextarea } from "./mention-textarea";
import { PrioritySelect } from "./priority-select";
import { useConfirmFlagged } from "./prompts";
import { StatusSelect } from "./status-select";
import { Subtasks } from "./subtasks";
import { TaskActivity } from "./task-activity";
import { FlagBadge } from "./task-badges";
import { TaskComments } from "./task-comments";
import { TaskMarkdown } from "./task-markdown";
import { accessSubjectOf, useTasks, visibilitySubjectOf } from "./tasks-context";
import type { TaskItem } from "./types";
import { AudienceList, VisibilityControl } from "./visibility-control";

/**
 * The task form, in the dialog and on the task's own page. Create and edit:
 * title, description with @mentions, status (a reason when Blocked),
 * priority, due date, project, labels, the accountable owner and "also
 * involved" collaborators, 'Created by', flags with their acknowledgement,
 * subtasks, comments and history.
 *
 * Without edit rights the fields are read-only and the self-assign
 * carve-out offers Join / Leave / Take ownership. In an intake project only
 * the triage owner or an admin sets the priority and owner. An above-level
 * assignment asks for confirmation before it is saved.
 */

export interface TaskEditorDefaults {
  status?: TaskStatus;
  parentTaskId?: string | null;
  projectId?: string | null;
  dueDate?: string | null;
  /** Pre-set the owner (handing work down from a Team lane). */
  ownerId?: string | null;
  /** Pre-set who can see it (a subtask inherits its parent). */
  visibility?: TaskVisibility;
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
  mode?: "dialog" | "page";
  initialComments?: React.ComponentProps<typeof TaskComments>["initial"];
}) {
  const { org, viewer, actor, labels, projects, projectById, memberById, announce } = useTasks();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmElement, confirmFlagged] = useConfirmFlagged();

  const initialProjectId = task?.projectId ?? defaults?.projectId ?? null;
  const initialProject = initialProjectId ? projectById.get(initialProjectId) : undefined;
  const isNew = task === null;
  const parentTaskId = task?.parentTaskId ?? defaults?.parentTaskId ?? null;

  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [status, setStatus] = useState<TaskStatus>(
    task?.status ?? defaults?.status ?? TaskStatus.NOT_STARTED,
  );
  const [blockedReason, setBlockedReason] = useState(task?.blockedReason ?? "");
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? TaskPriority.MEDIUM);
  const [dueDate, setDueDate] = useState(() => {
    if (task?.dueDate) return dueDateKey(task.dueDate);
    if (defaults?.dueDate) return defaults.dueDate;
    if (isNew && initialProject?.isIntake && initialProject.defaultDueInDays) {
      return addDaysToKey(org.todayKey, initialProject.defaultDueInDays);
    }
    return "";
  });
  const [projectId, setProjectId] = useState<string | null>(initialProjectId);
  const project = projectId ? projectById.get(projectId) : undefined;
  const intake = project?.isIntake ?? false;
  const triage = canTriage(actor, {
    isIntake: intake,
    triageUserId: project?.triageUserId ?? null,
  });
  const [visibility, setVisibility] = useState<TaskVisibility>(
    task?.visibility ?? defaults?.visibility ?? TaskVisibility.ORG,
  );
  const [ownerId, setOwnerId] = useState<string | null>(() => {
    if (task) return task.ownerId;
    if (defaults?.ownerId !== undefined && defaults.ownerId !== null) return defaults.ownerId;
    // New tasks default to the creator ("anyone can assign to themselves"),
    // except requests, which the triage owner assigns.
    return initialProject?.isIntake &&
      !canTriage(actor, { isIntake: true, triageUserId: initialProject.triageUserId })
      ? null
      : viewer.userId;
  });
  const [assigneeIds, setAssigneeIds] = useState<string[]>(
    task?.assignees.map((a) => a.userId) ?? [],
  );
  const [labelIds, setLabelIds] = useState<string[]>(task?.labels.map((l) => l.label.id) ?? []);

  const canEdit = task ? canEditTask(actor, accessSubjectOf(task)) : true;
  const readOnly = !canEdit;
  const isTopLevel = parentTaskId === null;
  // C4: a collaborator may edit a private task but must not be able to
  // publish it, and a subtask never decides on its own.
  const canSetVisibility = task
    ? canChangeVisibility(actor, visibilitySubjectOf(task)) && isTopLevel
    : isTopLevel && !intake;
  const visibilityLocked = !isTopLevel
    ? "A subtask is as private as the task it belongs to."
    : intake
      ? "Requests stay open: a queue nobody can see is not a queue."
      : task && !canSetVisibility
        ? "Only the owner, the creator or an admin changes who can see this."
        : null;
  const audience = namedAudienceIds({
    visibility,
    ownerId,
    createdById: task?.createdById ?? viewer.userId,
    assigneeIds,
  });
  const ownerRequired = org.requireOwner && isTopLevel && !intake;
  const dueRequired = org.requireDueDate && isTopLevel;

  async function save() {
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
    const input = {
      title,
      description: description.trim() ? description : null,
      status,
      blockedReason: status === TaskStatus.BLOCKED ? blockedReason.trim() : null,
      ...(intake && !triage ? {} : { priority }),
      dueDate: dueDate || null,
      projectId,
      ...(intake && !triage ? {} : { ownerId }),
      assigneeIds: assigneeIds.filter((id) => id !== ownerId),
      labelIds,
      ...(canSetVisibility ? { visibility } : {}),
      confirmFlagged: confirmed,
    };
    startTransition(async () => {
      const send = (extra: { confirmFlagged: boolean }) =>
        task
          ? updateTask(org.id, task.id, { ...input, ...extra, expectedVersion: task.version })
          : createTask(org.id, { ...input, ...extra, parentTaskId });
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
    });
  }

  function remove() {
    if (!task) return;
    startTransition(async () => {
      const result = await deleteTask(org.id, task.id);
      if (result.error) {
        setError(result.error);
        return;
      }
      (onDeleted ?? onDone)?.();
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

  return (
    <div className="space-y-5">
      {confirmElement}
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
        <div className="border-warning/40 bg-warning/10 space-y-2 rounded-md border p-3 text-sm">
          {flaggedPeople.map((f) => (
            <div key={`${f.role}-${f.userId}`} className="flex flex-wrap items-center gap-2">
              <FlagBadge />
              <span className="min-w-0 flex-1">
                {memberById.get(f.userId)?.name ?? "Someone"} was assigned as {f.role} from below
                their level in the org chart.
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
        <div className="bg-muted/50 flex flex-wrap items-center gap-2 rounded-md p-3 text-sm">
          <span className="text-muted-foreground min-w-0 flex-1">
            Only the creator, owner, collaborators, their managers and admins edit this task. You
            can still add yourself.
          </span>
          {self.owner && <span className="text-sm font-medium">You own this task.</span>}
          {self.joined && <span className="text-sm font-medium">You&apos;re on this task.</span>}
          {!task.ownerId && !self.owner && !intake && (
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
      {task && !readOnly && isAssignee && (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="ghost"
            disabled={isPending}
            onClick={() => selfAssign("leave")}
          >
            <UserMinus className="size-4" /> Leave this task
          </Button>
        </div>
      )}

      <div className="grid gap-1.5">
        <Label htmlFor="task-title">Title</Label>
        <Input
          id="task-title"
          value={title}
          disabled={readOnly}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus={isNew}
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="task-description">Description</Label>
        {readOnly ? (
          description ? (
            <TaskMarkdown className="rounded-md border p-3">{description}</TaskMarkdown>
          ) : (
            <p className="text-muted-foreground text-sm">No description.</p>
          )
        ) : (
          <Tabs defaultValue="write">
            <TabsList>
              <TabsTrigger value="write">Write</TabsTrigger>
              <TabsTrigger value="preview">Preview</TabsTrigger>
            </TabsList>
            <TabsContent value="write">
              <MentionTextarea
                id="task-description"
                value={description}
                onChange={setDescription}
                rows={5}
                placeholder="Markdown works. Type @ to mention someone."
              />
            </TabsContent>
            <TabsContent value="preview">
              {description ? (
                <TaskMarkdown className="min-h-24 rounded-md border p-3">
                  {description}
                </TaskMarkdown>
              ) : (
                <p className="text-muted-foreground min-h-24 rounded-md border p-3 text-sm">
                  Nothing to preview yet.
                </p>
              )}
            </TabsContent>
          </Tabs>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="task-owner">
            Owner{ownerRequired && <span className="text-destructive"> *</span>}
          </Label>
          <OwnerPicker
            id="task-owner"
            value={ownerId}
            onChange={setOwnerId}
            disabled={readOnly || (intake && !triage)}
          />
          {intake && !triage && (
            <p className="text-muted-foreground text-xs">
              {project?.triageUserId
                ? (memberById.get(project.triageUserId)?.name ?? "The triage owner")
                : "An admin"}{" "}
              sets the owner and priority of requests.
            </p>
          )}
          {ownerId &&
            relationFor(viewer.chart, ownerId) === "ABOVE" &&
            ownerId !== task?.ownerId && (
              <p className="text-warning text-xs">
                Above your level: this assignment will be flagged.
              </p>
            )}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="task-involved">Also involved</Label>
          <CollaboratorsPicker
            id="task-involved"
            value={assigneeIds}
            onChange={setAssigneeIds}
            exclude={ownerId}
            disabled={readOnly}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="task-status">Status</Label>
          <StatusSelect id="task-status" value={status} onChange={setStatus} disabled={readOnly} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="task-priority">Priority</Label>
          <PrioritySelect
            id="task-priority"
            value={priority}
            onChange={setPriority}
            disabled={readOnly || (intake && !triage)}
          />
        </div>
      </div>

      {status === TaskStatus.BLOCKED && (
        <div className="grid gap-1.5">
          <Label htmlFor="task-blocked-reason">Blocked on</Label>
          <Textarea
            id="task-blocked-reason"
            value={blockedReason}
            maxLength={MAX_BLOCKED_REASON}
            rows={2}
            disabled={readOnly}
            placeholder="What is it waiting on?"
            onChange={(e) => setBlockedReason(e.target.value)}
          />
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="task-due-date">
            Due date{dueRequired && <span className="text-destructive"> *</span>}
          </Label>
          <Input
            id="task-due-date"
            type="date"
            value={dueDate}
            disabled={readOnly}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="task-project">Project</Label>
          <Select
            value={projectId ?? "none"}
            onValueChange={(v) => setProjectId(v === "none" ? null : v)}
            disabled={readOnly}
          >
            <SelectTrigger id="task-project" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No project</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                  {p.isIntake ? " (requests)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="task-labels">Labels</Label>
        <LabelPicker
          id="task-labels"
          labels={labels}
          selectedIds={labelIds}
          onChange={setLabelIds}
          disabled={readOnly}
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="task-visibility">Who can see it</Label>
        <VisibilityControl
          id="task-visibility"
          value={visibility}
          onChange={setVisibility}
          disabled={readOnly || !canSetVisibility}
          lockedReason={visibilityLocked}
        />
        {visibility === TaskVisibility.PRIVATE && (
          <div className="bg-muted/50 mt-1 rounded-lg p-3">
            <AudienceList
              ownerId={ownerId}
              createdById={task?.createdById ?? viewer.userId}
              assigneeIds={assigneeIds}
            />
            <p className="text-muted-foreground mt-2 text-xs">
              {audience.length === 1
                ? "Only you, and the club owners and admins."
                : `${audience.length} people plus owners and admins.`}{" "}
              Comments, history and @mentions on it are hidden too — to mention somebody else, add
              them here first.
            </p>
          </div>
        )}
      </div>

      {task && (
        <p className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs">
          Created by
          <UserAvatar user={task.createdBy} size="xs" />
          <span className="text-foreground">{task.createdBy.name ?? "a former member"}</span>
          on {format(new Date(task.createdAt), "MMM d, yyyy")}
          {mode === "dialog" && (
            <Link
              href={`/app/${org.slug}/tasks/${task.id}`}
              className="ml-auto inline-flex items-center gap-1 hover:underline"
            >
              Open page <ExternalLink className="size-3" aria-hidden="true" />
            </Link>
          )}
        </p>
      )}

      {error && (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between gap-2">
        {task && canEdit ? (
          <Button type="button" variant="ghost" onClick={remove} disabled={isPending}>
            Delete
          </Button>
        ) : (
          <span />
        )}
        {canEdit && (
          <Button type="button" onClick={() => void save()} disabled={isPending || !title.trim()}>
            {isPending ? "Saving…" : "Save"}
          </Button>
        )}
      </div>

      {task && isTopLevel && (
        <Subtasks
          parentId={task.id}
          subtasks={task.subtasks}
          canAdd={canEdit}
          onOpen={onOpenTask}
        />
      )}

      {task && (
        <div className="space-y-2 border-t pt-4">
          <h3 className="text-sm font-medium">Comments</h3>
          <TaskComments taskId={task.id} initial={initialComments} />
        </div>
      )}

      {task && (
        <div className="space-y-2 border-t pt-4">
          <h3 className="text-sm font-medium">History</h3>
          <TaskActivity taskId={task.id} />
        </div>
      )}
    </div>
  );
}
