"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { AssigneePicker, type OrgMemberOption } from "@/components/tasks/assignee-picker";
import { LabelPicker, type LabelOption } from "@/components/tasks/label-picker";
import { PrioritySelect } from "@/components/tasks/priority-select";
import { StatusSelect } from "@/components/tasks/status-select";
import { toDateInputValue } from "@/components/tasks/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { TaskPriority, TaskStatus } from "@/generated/prisma/enums";

import { createTask, deleteTask, updateTask } from "@/app/app/[orgSlug]/tasks/actions";
import type { TaskWithRelations } from "@/app/app/[orgSlug]/tasks/queries";

export interface TaskDetailTask extends Pick<
  TaskWithRelations,
  "id" | "parentTaskId" | "subtasks"
> {
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: Date | null;
  projectId: string | null;
  assignees: { user: { id: string } }[];
  labels: { label: { id: string } }[];
}

interface Props {
  orgId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: TaskDetailTask | null;
  defaultStatus?: TaskStatus;
  defaultParentTaskId?: string | null;
  members: OrgMemberOption[];
  labels: LabelOption[];
  projects: { id: string; name: string }[];
  onSaved?: () => void;
}

/**
 * Thin wrapper that only decides whether to render a dialog at all.
 * TaskDetailForm is keyed on the task/mode so opening a different task (or
 * switching between edit and create) remounts it and re-initializes local
 * state naturally, instead of syncing state from props via an effect.
 */
export function TaskDetailDialog({
  open,
  onOpenChange,
  task,
  defaultStatus,
  defaultParentTaskId,
  ...rest
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        {open && (
          <TaskDetailForm
            key={task?.id ?? `new-${defaultParentTaskId ?? "top"}-${defaultStatus ?? ""}`}
            task={task}
            defaultStatus={defaultStatus}
            defaultParentTaskId={defaultParentTaskId}
            onOpenChange={onOpenChange}
            {...rest}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function TaskDetailForm({
  orgId,
  onOpenChange,
  task,
  defaultStatus,
  defaultParentTaskId,
  members,
  labels,
  projects,
  onSaved,
}: Omit<Props, "open">) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [status, setStatus] = useState<TaskStatus>(
    task?.status ?? defaultStatus ?? TaskStatus.NOT_STARTED,
  );
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? TaskPriority.MEDIUM);
  const [dueDate, setDueDate] = useState(task?.dueDate ? toDateInputValue(task.dueDate) : "");
  const [projectId, setProjectId] = useState<string | null>(task?.projectId ?? null);
  const [assigneeIds, setAssigneeIds] = useState<string[]>(
    task?.assignees.map((a) => a.user.id) ?? [],
  );
  const [labelIds, setLabelIds] = useState<string[]>(task?.labels.map((l) => l.label.id) ?? []);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");

  const isSubtask = Boolean(task?.parentTaskId ?? defaultParentTaskId);
  const canHaveSubtasks = Boolean(task) && !isSubtask;

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const input = {
        title,
        description: description || null,
        status,
        priority,
        dueDate: dueDate || null,
        projectId,
        assigneeIds,
        labelIds,
      };

      const result = task
        ? await updateTask(orgId, task.id, input)
        : await createTask(orgId, { ...input, parentTaskId: defaultParentTaskId ?? null });

      if (result?.error) {
        setError(result.error);
        return;
      }
      onOpenChange(false);
      onSaved?.();
      router.refresh();
    });
  }

  function handleDelete() {
    if (!task) return;
    startTransition(async () => {
      await deleteTask(orgId, task.id);
      onOpenChange(false);
      onSaved?.();
      router.refresh();
    });
  }

  function handleAddSubtask() {
    if (!task || !newSubtaskTitle.trim()) return;
    startTransition(async () => {
      const result = await createTask(orgId, {
        title: newSubtaskTitle.trim(),
        parentTaskId: task.id,
      });
      if (result?.error) {
        setError(result.error);
        return;
      }
      setNewSubtaskTitle("");
      router.refresh();
    });
  }

  function handleToggleSubtask(subtaskId: string, currentlyDone: boolean) {
    startTransition(async () => {
      await updateTask(orgId, subtaskId, {
        status: currentlyDone ? TaskStatus.NOT_STARTED : TaskStatus.COMPLETED,
      });
      router.refresh();
    });
  }

  const completedSubtasks =
    task?.subtasks.filter((s) => s.status === TaskStatus.COMPLETED).length ?? 0;

  return (
    <>
      <DialogHeader>
        <DialogTitle>{task ? "Edit task" : isSubtask ? "New subtask" : "New task"}</DialogTitle>
        <DialogDescription className="sr-only">Task details</DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="grid gap-1.5">
          <Label htmlFor="task-title">Title</Label>
          <Input
            id="task-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="task-description">Description (markdown supported)</Label>
          <Tabs defaultValue="write">
            <TabsList>
              <TabsTrigger value="write">Write</TabsTrigger>
              <TabsTrigger value="preview">Preview</TabsTrigger>
            </TabsList>
            <TabsContent value="write">
              <Textarea
                id="task-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={5}
              />
            </TabsContent>
            <TabsContent value="preview">
              <div className="prose prose-sm dark:prose-invert min-h-24 max-w-none rounded-md border p-3">
                {description ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{description}</ReactMarkdown>
                ) : (
                  <p className="text-muted-foreground text-sm">Nothing to preview yet.</p>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label>Status</Label>
            <StatusSelect value={status} onChange={setStatus} />
          </div>
          <div className="grid gap-1.5">
            <Label>Priority</Label>
            <PrioritySelect value={priority} onChange={setPriority} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="task-due-date">Due date</Label>
            <Input
              id="task-due-date"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Project</Label>
            <Select
              value={projectId ?? "none"}
              onValueChange={(v) => setProjectId(v === "none" ? null : v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No project</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-1.5">
          <Label>Assignees</Label>
          <AssigneePicker members={members} selectedIds={assigneeIds} onChange={setAssigneeIds} />
        </div>

        <div className="grid gap-1.5">
          <Label>Labels</Label>
          <LabelPicker labels={labels} selectedIds={labelIds} onChange={setLabelIds} />
        </div>

        {canHaveSubtasks && (
          <div className="grid gap-1.5">
            <Label>
              Subtasks
              {task && task.subtasks.length > 0 && (
                <span className="text-muted-foreground ml-1 font-normal">
                  ({completedSubtasks}/{task.subtasks.length} complete)
                </span>
              )}
            </Label>
            <div className="space-y-1">
              {task?.subtasks.map((s) => (
                <SubtaskRow
                  key={s.id}
                  subtaskId={s.id}
                  title={s.title}
                  done={s.status === TaskStatus.COMPLETED}
                  onToggle={handleToggleSubtask}
                />
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="Add a subtask…"
                value={newSubtaskTitle}
                onChange={(e) => setNewSubtaskTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddSubtask();
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                onClick={handleAddSubtask}
                disabled={isPending}
              >
                Add
              </Button>
            </div>
          </div>
        )}

        {error && <p className="text-destructive text-sm">{error}</p>}
      </div>

      <DialogFooter className="flex-row justify-between sm:justify-between">
        {task ? (
          <Button type="button" variant="ghost" onClick={handleDelete} disabled={isPending}>
            Delete
          </Button>
        ) : (
          <span />
        )}
        <Button type="button" onClick={handleSave} disabled={isPending || !title.trim()}>
          {isPending ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </>
  );
}

function SubtaskRow({
  subtaskId,
  title,
  done,
  onToggle,
}: {
  subtaskId: string;
  title: string;
  done: boolean;
  onToggle: (id: string, done: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm">
      <Checkbox checked={done} onCheckedChange={() => onToggle(subtaskId, done)} />
      <span className={done ? "text-muted-foreground line-through" : ""}>{title}</span>
    </div>
  );
}
