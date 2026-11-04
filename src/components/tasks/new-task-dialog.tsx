"use client";

import { useRef, useState, useTransition } from "react";

import { createTask } from "@/app/app/[orgSlug]/tasks/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHead,
} from "@/components/ui/dialog";
import { announceCreated } from "@/components/links/pending-link";
import { toast } from "@/components/ui/toaster";
import { TaskPriority, TaskStatus, TaskVisibility } from "@/generated/prisma/enums";
import { relationFor } from "@/lib/tasks/assignment";
import { parentTypesFor } from "@/lib/tasks/epic";
import { allowedTypes, TASK_TYPES, typeLabel, type TaskTypeValue } from "@/lib/tasks/hierarchy";

import { useConfirmFlagged } from "./prompts";
import type { TaskEditorDefaults } from "./task-editor";
import { TaskFormFields } from "./task-form-fields";
import { useTasks } from "./tasks-context";
import { useHashTags } from "./use-hash-tags";

/**
 * New task, as a centred dialog. Editing a task (TaskDetailSheet) is the
 * same window with the same fields (TaskFormFields), so the two read as one
 * form. The window is sized so all of it is on screen on a laptop; on
 * anything shorter it simply scrolls.
 */
export function NewTaskDialog({
  open,
  onOpenChange,
  defaults,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaults?: TaskEditorDefaults;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[min(94vh,880px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
      >
        {open && (
          <NewTaskForm
            key={`${defaults?.parentTaskId ?? "top"}-${defaults?.type ?? ""}-${defaults?.status ?? ""}`}
            defaults={defaults}
            onOpenChange={onOpenChange}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function NewTaskForm({
  defaults,
  onOpenChange,
}: {
  defaults?: TaskEditorDefaults;
  onOpenChange: (open: boolean) => void;
}) {
  const { org, viewer, memberById, labels, parents, parentById, announce } = useTasks();
  const hashTags = useHashTags();
  const [confirmElement, confirmFlagged] = useConfirmFlagged();
  const [isPending, startTransition] = useTransition();
  const saving = useRef(false);

  const [title, setTitle] = useState("");
  const [type, setType] = useState<TaskTypeValue>(defaults?.type ?? "TASK");
  const [parentTaskId, setParentTaskId] = useState<string | null>(defaults?.parentTaskId ?? null);
  const [ownerId, setOwnerId] = useState<string | null>(
    defaults?.ownerId !== undefined && defaults.ownerId !== null ? defaults.ownerId : viewer.userId,
  );
  const [priority, setPriority] = useState<TaskPriority>(TaskPriority.MEDIUM);
  const [dueDate, setDueDate] = useState(defaults?.dueDate ?? "");
  const [startDate, setStartDate] = useState("");
  const [color, setColor] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [status, setStatus] = useState<TaskStatus>(defaults?.status ?? TaskStatus.NOT_STARTED);
  const [blockedReason, setBlockedReason] = useState("");
  const [visibility, setVisibility] = useState<TaskVisibility>(
    defaults?.visibility ?? TaskVisibility.ORG,
  );
  const [error, setError] = useState<string | null>(null);

  const parent = parentTaskId ? parentById.get(parentTaskId) : undefined;
  const parentType = parentTaskId
    ? ((parent?.type as TaskTypeValue | undefined) ?? defaults?.parentType ?? "STORY")
    : null;
  const typeChoices = TASK_TYPES.filter((t) =>
    allowedTypes({ parentType, childTypes: [] }).includes(t.value),
  );
  const isEpic = type === "EPIC";
  const hasStart = type === "EPIC" || type === "STORY";
  const isTopLevel = isEpic || parentTaskId === null;
  const dueRequired = org.requireDueDate && isTopLevel;
  const parentChoices = parents.filter((p) =>
    parentTypesFor(type).includes(p.type as "EPIC" | "STORY"),
  );
  const ownerAbove =
    ownerId !== null && ownerId !== viewer.userId && relationFor(viewer.chart, ownerId) === "ABOVE";
  const noun = typeLabel(type).toLowerCase();

  function pickType(next: TaskTypeValue) {
    setType(next);
    // An epic sits at the top; a story only inside an epic.
    if (next === "EPIC") setParentTaskId(null);
    if (next === "STORY" && parent?.type === "STORY") setParentTaskId(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving.current) return;
    saving.current = true;
    try {
      await save();
    } finally {
      saving.current = false;
    }
  }

  async function save() {
    setError(null);
    if (status === TaskStatus.BLOCKED && !blockedReason.trim()) {
      setError("Say what it's blocked on.");
      return;
    }
    const newcomers = [...(ownerId && ownerId !== viewer.userId ? [ownerId] : []), ...assigneeIds];
    const above = newcomers.filter((id) => relationFor(viewer.chart, id) === "ABOVE");
    let confirmed = false;
    if (above.length > 0) {
      confirmed = await confirmFlagged(above.map((id) => memberById.get(id)?.name ?? "Someone"));
      if (!confirmed) return;
    }
    // `#tag` in the title tags the task (making new tags on the way).
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
    }
    const input = {
      title: finalTitle,
      description: description.trim() ? description : null,
      type,
      status,
      blockedReason: status === TaskStatus.BLOCKED ? blockedReason.trim() : null,
      priority,
      dueDate: dueDate || null,
      ...(hasStart ? { startDate: startDate || null } : {}),
      ...(isEpic ? { color } : {}),
      parentTaskId: isEpic ? null : parentTaskId,
      ownerId,
      openToAnyone: ownerId === null,
      assigneeIds: assigneeIds.filter((id) => id !== ownerId),
      labelIds: finalLabelIds,
      ...(isTopLevel ? { visibility } : {}),
    };
    await new Promise<void>((done) =>
      startTransition(async () => {
        try {
          let result = await createTask(org.id, { ...input, confirmFlagged: confirmed });
          if ("confirm" in result && result.confirm) {
            const ok = await confirmFlagged(result.confirm.flagged.map((f) => f.name ?? "Someone"));
            if (!ok) return;
            result = await createTask(org.id, { ...input, confirmFlagged: true });
          }
          if (result.error) {
            setError(result.error);
            return;
          }
          toast({ title: `Created: ${finalTitle}`, tone: "success" });
          if ("taskId" in result && result.taskId)
            announceCreated({ kind: "task", id: result.taskId });
          if ("droppedMentions" in result && result.droppedMentions?.length) {
            announce(`Not mentioned (can't see this task): ${result.droppedMentions.join(", ")}`);
          }
          onOpenChange(false);
        } finally {
          done();
        }
      }),
    );
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          void submit(e);
        }
      }}
      className="flex min-h-0 flex-1 flex-col"
    >
      <DialogHead
        className="shrink-0 ps-6 pe-4 pt-4 pb-2"
        title={`New ${noun}`}
        subtitle={
          <DialogDescription>
            {isEpic
              ? "A big outcome that spans weeks. Its stories and tasks roll up into it."
              : "A title is all it takes. Everything else has a sensible default."}
          </DialogDescription>
        }
      />

      {/*
        One column, top to bottom, sized to fit on a laptop screen. The
        fields are the edit form's too (TaskFormFields).
      */}
      <div className="min-h-0 flex-1 [scrollbar-width:thin] overflow-x-hidden overflow-y-auto overscroll-contain">
        <TaskFormFields
          title={{ value: title, set: setTitle }}
          type={{ value: type, set: pickType }}
          typeChoices={typeChoices}
          priority={{ value: priority, set: setPriority }}
          owner={{ value: ownerId, set: setOwnerId }}
          ownerAbove={ownerAbove}
          people={{ value: assigneeIds, set: setAssigneeIds }}
          parent={{ value: parentTaskId, set: setParentTaskId }}
          parentChoices={parentChoices}
          color={{ value: color, set: setColor }}
          due={{ value: dueDate, set: setDueDate }}
          dueRequired={dueRequired}
          description={{ value: description, set: setDescription }}
          labels={{ value: labelIds, set: setLabelIds }}
          labelOptions={labels}
          status={{ value: status, set: setStatus }}
          visibility={{ value: visibility, set: setVisibility }}
          visibilityLocked={isTopLevel ? null : "As private as the epic or story it's in."}
          start={{ value: startDate, set: setStartDate }}
          blockedReason={{ value: blockedReason, set: setBlockedReason }}
          error={error}
          autoFocus
        />
      </div>

      {confirmElement}
      <DialogFooter className="m-0 shrink-0 border-t px-6 py-4">
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button type="submit" disabled={isPending || !title.trim()}>
          {isPending ? "Creating…" : `Create ${noun}`}
        </Button>
      </DialogFooter>
    </form>
  );
}
