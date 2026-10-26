"use client";

import { useRef, useState, useTransition } from "react";

import { createTask } from "@/app/app/[orgSlug]/tasks/actions";
import { Button } from "@/components/ui/button";
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
import { toast } from "@/components/ui/toaster";
import { TaskPriority, TaskStatus, TaskVisibility } from "@/generated/prisma/enums";
import { LABEL_COLOR_PALETTE } from "@/lib/label-colors";
import { relationFor } from "@/lib/tasks/assignment";
import { epicColor, parentTypesFor } from "@/lib/tasks/epic";
import { allowedTypes, TASK_TYPES, typeLabel, type TaskTypeValue } from "@/lib/tasks/hierarchy";
import { MAX_BLOCKED_REASON } from "@/lib/tasks/status";
import { cn } from "@/lib/utils";

import { MentionTextarea } from "./mention-textarea";
import { useConfirmFlagged } from "./prompts";
import { HashTagHint } from "./tag-menu";
import { TitleInput } from "./task-title-field";
import {
  LabelsField,
  OwnerField,
  PeopleField,
  PRIORITY_OPTIONS,
  STATUS_OPTIONS,
} from "./task-fields";
import type { TaskEditorDefaults } from "./task-editor";
import { useTasks } from "./tasks-context";
import { useHashTags } from "./use-hash-tags";

const NONE = "__none";

/**
 * New task, as a centred dialog (editing a task is centred too, in
 * TaskDetailSheet). One form, in one column, in this order: title, type and
 * priority, owner and who else, the epic and the due date, then the
 * description, tags, status and who can see it. The window is sized so all
 * of it is on screen on a laptop; on anything shorter it simply scrolls.
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
      <DialogContent className="flex max-h-[min(94vh,880px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
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
  const ownerRequired = org.requireOwner && isTopLevel;
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
      <DialogHeader className="shrink-0 px-6 pt-6 pb-2">
        <DialogTitle>New {noun}</DialogTitle>
        <DialogDescription>
          {isEpic
            ? "A big outcome that spans weeks. Its stories and tasks roll up into it."
            : "A title is all it takes. Everything else has a sensible default."}
        </DialogDescription>
      </DialogHeader>

      {/*
        One column, top to bottom, sized to fit on a laptop screen: the
        essentials first, then the description, tags, status and who can see
        it. It used to hide the second half behind a rubber-band scroll,
        which asked people to discover a gesture to find fields that fit on
        the screen anyway.
      */}
      <div className="min-h-0 flex-1 [scrollbar-width:thin] overflow-x-hidden overflow-y-auto overscroll-contain">
        <div>
          <div className="flex flex-col gap-4 px-6 pt-2 pb-4">
            <div className="grid content-start gap-1.5">
              <Label htmlFor="task-title">Title</Label>
              <TitleInput
                id="task-title"
                value={title}
                onChange={setTitle}
                autoFocus
                required
                maxLength={200}
                placeholder={
                  isEpic ? "e.g. Fall Showcase" : "e.g. Book the room (#tag, /file to link one)"
                }
              />
              <HashTagHint title={title} />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 [&>*]:min-w-0">
              <div className="grid content-start gap-1.5">
                <Label htmlFor="task-type">Type</Label>
                <Select value={type} onValueChange={(v) => pickType(v as TaskTypeValue)}>
                  <SelectTrigger id="task-type" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {typeChoices.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid content-start gap-1.5">
                <Label htmlFor="task-priority">Priority</Label>
                <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
                  <SelectTrigger id="task-priority" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITY_OPTIONS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 [&>*]:min-w-0">
              <div className="grid content-start gap-1.5">
                <Label htmlFor="task-owner">Owner</Label>
                {/*
                  The same picker as Who else, so both read the same: faces,
                  names and how each person relates to you in the org chart.
                */}
                <OwnerField
                  id="task-owner"
                  value={ownerId}
                  onChange={setOwnerId}
                  allowNone={!ownerRequired}
                />
                {ownerAbove && (
                  <p className="text-warning text-xs">Above your level: this will be flagged.</p>
                )}
              </div>
              <div className="grid content-start gap-1.5">
                <Label htmlFor="task-involved">Who else</Label>
                <PeopleField
                  id="task-involved"
                  value={assigneeIds}
                  onChange={setAssigneeIds}
                  exclude={ownerId}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 [&>*]:min-w-0">
              {isEpic ? (
                <div className="grid content-start gap-1.5">
                  <span className="text-sm leading-none font-medium">Colour</span>
                  <div
                    role="radiogroup"
                    aria-label="Epic colour"
                    className="flex flex-wrap gap-1.5 pt-1"
                  >
                    <button
                      type="button"
                      role="radio"
                      aria-checked={color === null}
                      aria-label="Theme colour"
                      onClick={() => setColor(null)}
                      className={cn(
                        "focus-glow hatch bg-muted size-6 rounded-full",
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
                        onClick={() => setColor(c)}
                        className={cn(
                          "focus-glow size-6 rounded-full",
                          color === c && "ring-foreground ring-offset-card ring-2 ring-offset-2",
                        )}
                        style={{ background: c }}
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <div className="grid content-start gap-1.5">
                  <Label htmlFor="task-parent">Epic</Label>
                  <Select
                    value={parentTaskId ?? NONE}
                    onValueChange={(v) => setParentTaskId(v === NONE ? null : v)}
                  >
                    <SelectTrigger id="task-parent" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Not in an epic</SelectItem>
                      {parentChoices
                        .filter((p) => p.type === "EPIC")
                        .flatMap((epic) => [
                          epic,
                          ...parentChoices.filter(
                            (s) => s.type === "STORY" && s.parentTaskId === epic.id,
                          ),
                        ])
                        .map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.type === "EPIC" ? (
                              <span
                                aria-hidden
                                className="size-2 shrink-0 rounded-full"
                                style={{ background: epicColor(p) }}
                              />
                            ) : (
                              <span aria-hidden className="w-2 shrink-0" />
                            )}
                            <span
                              className={cn(
                                "truncate",
                                p.type === "STORY" && "text-muted-foreground",
                              )}
                            >
                              {p.title}
                            </span>
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="grid content-start gap-1.5">
                <Label htmlFor="task-due">Due</Label>
                <Input
                  id="task-due"
                  type="date"
                  value={dueDate}
                  min={startDate || undefined}
                  required={dueRequired}
                  onChange={(e) => setDueDate(e.target.value)}
                />
                {dueRequired && (
                  <p className="text-muted-foreground text-xs">
                    Every task in this club needs a due date.
                  </p>
                )}
              </div>
            </div>

            {error && (
              <p className="text-destructive text-sm" role="alert">
                {error}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-4 px-6 pb-5">
            <div className="grid content-start gap-1.5">
              <Label htmlFor="task-description">Description</Label>
              {/* @ mentions a member, / links a club file, markdown works. */}
              <MentionTextarea
                id="task-description"
                value={description}
                onChange={setDescription}
                rows={4}
                maxLength={20000}
                placeholder="Markdown, @mentions and /file links work"
              />
            </div>
            <div className="grid content-start gap-1.5">
              <Label htmlFor="task-labels">Tags</Label>
              <LabelsField
                id="task-labels"
                labels={labels}
                value={labelIds}
                onChange={setLabelIds}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 [&>*]:min-w-0">
              <div className="grid content-start gap-1.5">
                <Label htmlFor="task-status">Status</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as TaskStatus)}>
                  <SelectTrigger id="task-status" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.icon}
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid content-start gap-1.5">
                <Label htmlFor="task-visibility">Who can see it</Label>
                <Select
                  value={visibility}
                  disabled={!isTopLevel}
                  onValueChange={(v) => setVisibility(v as TaskVisibility)}
                >
                  <SelectTrigger id="task-visibility" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={TaskVisibility.ORG}>Everyone in the club</SelectItem>
                    <SelectItem value={TaskVisibility.PRIVATE}>Only its people</SelectItem>
                  </SelectContent>
                </Select>
                {!isTopLevel && (
                  <p className="text-muted-foreground text-xs">
                    As private as the epic or story it&apos;s in.
                  </p>
                )}
              </div>
            </div>
            {hasStart && (
              <div className="grid content-start gap-1.5 sm:max-w-[50%]">
                <Label htmlFor="task-start">Starts</Label>
                <Input
                  id="task-start"
                  type="date"
                  value={startDate}
                  max={dueDate || undefined}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
            )}
            {status === TaskStatus.BLOCKED && (
              <div className="grid content-start gap-1.5">
                <Label htmlFor="task-blocked">Blocked on</Label>
                <Input
                  id="task-blocked"
                  value={blockedReason}
                  maxLength={MAX_BLOCKED_REASON}
                  placeholder="What is it waiting for?"
                  onChange={(e) => setBlockedReason(e.target.value)}
                />
              </div>
            )}
            {error && (
              <p className="text-destructive text-sm" role="alert">
                {error}
              </p>
            )}
          </div>
        </div>
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
