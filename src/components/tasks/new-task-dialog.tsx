"use client";

import { ChevronRight } from "@/components/icons";
import { useMemo, useRef, useState, useTransition } from "react";

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
import { Switch } from "@/components/ui/switch";
import { announceCreated } from "@/components/links/pending-link";
import { toast } from "@/components/ui/toaster";
import { TaskPriority, TaskStatus, TaskVisibility } from "@/generated/prisma/enums";
import { LABEL_COLOR_PALETTE } from "@/lib/label-colors";
import { relationFor } from "@/lib/tasks/assignment";
import { parentTypesFor } from "@/lib/tasks/epic";
import { allowedTypes, TASK_TYPES, typeLabel, type TaskTypeValue } from "@/lib/tasks/hierarchy";
import { parseQuickAdd } from "@/lib/tasks/quick-add";
import { MAX_BLOCKED_REASON } from "@/lib/tasks/status";
import { cn } from "@/lib/utils";

import { MentionTextarea } from "./mention-textarea";
import { useConfirmFlagged } from "./prompts";
import { HashTagHint } from "./tag-menu";
import { TitleInput } from "./task-title-field";
import {
  DueField,
  LabelsField,
  OwnerField,
  PartOfField,
  PeopleField,
  PRIORITY_OPTIONS,
  SegmentBox,
  STATUS_OPTIONS,
  VISIBILITY_OPTIONS,
} from "./task-fields";
import type { TaskEditorDefaults } from "./task-editor";
import { useTasks } from "./tasks-context";
import { useHashTags } from "./use-hash-tags";

/**
 * New task, as a centred dialog (editing a task is centred too, in
 * TaskDetailSheet). The essentials first (title, type, owner, due date and
 * what it's part of), the rest under More. Every small choice is a row of
 * buttons, not a menu. With Keep adding on, Create clears the title and
 * stays open for the next one.
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
  const { org, viewer, members, memberById, labels, parentById, announce } = useTasks();
  const hashTags = useHashTags();
  const [confirmElement, confirmFlagged] = useConfirmFlagged();
  const [isPending, startTransition] = useTransition();
  const saving = useRef(false);
  const titleRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState("");
  const [type, setType] = useState<TaskTypeValue>(defaults?.type ?? "TASK");
  const [parentTaskId, setParentTaskId] = useState<string | null>(defaults?.parentTaskId ?? null);
  const [ownerId, setOwnerId] = useState<string | null>(
    defaults?.ownerId !== undefined && defaults.ownerId !== null ? defaults.ownerId : viewer.userId,
  );
  // Whether owner and date were picked by hand: an @name or a date typed in
  // the title only fills them while they're still at their defaults.
  const [ownerTouched, setOwnerTouched] = useState(false);
  const [dueTouched, setDueTouched] = useState(Boolean(defaults?.dueDate));
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
  const [more, setMore] = useState(defaults?.status === TaskStatus.BLOCKED);
  const [keepAdding, setKeepAdding] = useState(readKeepAdding);
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
  const noun = typeLabel(type).toLowerCase();

  // "Order bolts @priya fri" in the title fills the owner and the date.
  const parsed = useMemo(
    () => parseQuickAdd(title, org.todayKey, members),
    [title, org.todayKey, members],
  );
  const shownOwner = !ownerTouched && parsed.ownerId ? parsed.ownerId : ownerId;
  const shownDue = !dueTouched && parsed.dueKey ? parsed.dueKey : dueDate;
  const ownerAbove =
    shownOwner !== null &&
    shownOwner !== viewer.userId &&
    relationFor(viewer.chart, shownOwner) === "ABOVE";

  function pickType(next: TaskTypeValue) {
    setType(next);
    // An epic sits at the top; a story only inside an epic.
    if (next === "EPIC") setParentTaskId(null);
    if (next === "STORY" && parent?.type === "STORY") setParentTaskId(null);
  }

  async function submit(e: React.FormEvent, again = keepAdding) {
    e.preventDefault();
    if (saving.current) return;
    saving.current = true;
    try {
      await save(again);
    } finally {
      saving.current = false;
    }
  }

  async function save(again: boolean) {
    setError(null);
    if (status === TaskStatus.BLOCKED && !blockedReason.trim()) {
      setMore(true);
      setError("Say what it's blocked on.");
      return;
    }
    if (dueRequired && !shownDue) {
      setError("Pick a due date.");
      return;
    }
    const owner = shownOwner;
    const newcomers = [...(owner && owner !== viewer.userId ? [owner] : []), ...assigneeIds];
    const above = newcomers.filter((id) => relationFor(viewer.chart, id) === "ABOVE");
    let confirmed = false;
    if (above.length > 0) {
      confirmed = await confirmFlagged(above.map((id) => memberById.get(id)?.name ?? "Someone"));
      if (!confirmed) return;
    }
    // The title without the @owner and date it was read for.
    let finalTitle = parsed.ownerId || parsed.dueKey ? parsed.title : title;
    let finalLabelIds = labelIds;
    // `#tag` in the title tags the task (making new tags on the way).
    if (hashTags.preview(finalTitle).length > 0) {
      const resolved = await hashTags.resolve(finalTitle);
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
      dueDate: shownDue || null,
      ...(hasStart ? { startDate: startDate || null } : {}),
      ...(isEpic ? { color } : {}),
      parentTaskId: isEpic ? null : parentTaskId,
      ownerId: owner,
      assigneeIds: assigneeIds.filter((id) => id !== owner),
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
          toast({ title: "Created", tone: "success", duration: 3_000 });
          if ("taskId" in result && result.taskId)
            announceCreated({ kind: "task", id: result.taskId });
          if ("droppedMentions" in result && result.droppedMentions?.length) {
            announce(`Not mentioned (can't see this task): ${result.droppedMentions.join(", ")}`);
          }
          if (again) {
            // The next one: same epic, type and status; a fresh title.
            setTitle("");
            setDescription("");
            setLabelIds([]);
            setAssigneeIds([]);
            setOwnerTouched(false);
            setDueTouched(false);
            setOwnerId(viewer.userId);
            setDueDate(defaults?.dueDate ?? "");
            titleRef.current?.focus();
          } else {
            onOpenChange(false);
          }
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
        <DialogDescription className="sr-only">
          Title, owner and due date; the rest under More.
        </DialogDescription>
      </DialogHeader>

      {/*
        The essentials, then More. A title is usually all it takes: an @name
        and a date in it fill the owner and due date, and the form shows what
        it read. Type, owner, date and epic are on screen; who else, priority,
        description, tags, status and who can see it wait under More.
      */}
      <div className="min-h-0 flex-1 [scrollbar-width:thin] overflow-x-hidden overflow-y-auto overscroll-contain">
        <div className="flex flex-col gap-4 px-6 pt-2 pb-5">
          <div className="grid content-start gap-1.5">
            <Label htmlFor="task-title">Title</Label>
            <TitleInput
              id="task-title"
              ref={titleRef}
              value={title}
              onChange={setTitle}
              autoFocus
              required
              maxLength={200}
              placeholder={isEpic ? "Fall Showcase" : "Order bolts @priya fri #venue"}
            />
            <HashTagHint title={title} />
          </div>

          {typeChoices.length > 1 && (
            <div className="grid content-start gap-1.5">
              <span className="text-sm leading-none font-medium">Type</span>
              <SegmentBox
                label="Type"
                value={type}
                onChange={pickType}
                options={typeChoices.map((t) => ({ value: t.value, label: t.label }))}
              />
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 [&>*]:min-w-0">
            <div className="grid content-start gap-1.5">
              <Label htmlFor="task-owner">Owner</Label>
              <OwnerField
                id="task-owner"
                value={shownOwner}
                onChange={(id) => {
                  setOwnerTouched(true);
                  setOwnerId(id);
                }}
                allowNone={!ownerRequired}
              />
              {ownerAbove && <p className="text-warning text-xs">Will be flagged (above you)</p>}
            </div>
            <div className="grid content-start gap-1.5">
              <Label htmlFor="task-due">
                Due{dueRequired && <span aria-hidden="true"> *</span>}
              </Label>
              <DueField
                id="task-due"
                value={shownDue}
                onChange={(key) => {
                  setDueTouched(true);
                  setDueDate(key);
                }}
              />
            </div>
          </div>

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
              <Label htmlFor="task-parent">Part of</Label>
              <PartOfField
                id="task-parent"
                value={parentTaskId}
                onChange={setParentTaskId}
                types={parentTypesFor(type)}
              />
            </div>
          )}

          <button
            type="button"
            aria-expanded={more}
            onClick={() => setMore((v) => !v)}
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 self-start text-sm font-medium transition-colors"
          >
            <ChevronRight
              className={cn("size-4 transition-transform duration-150", more && "rotate-90")}
              aria-hidden="true"
            />
            More
          </button>

          {more && (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 [&>*]:min-w-0">
                <div className="grid content-start gap-1.5">
                  <Label htmlFor="task-involved">Involved</Label>
                  <PeopleField
                    id="task-involved"
                    value={assigneeIds}
                    onChange={setAssigneeIds}
                    exclude={shownOwner}
                  />
                </div>
                <div className="grid content-start gap-1.5">
                  <span className="text-sm leading-none font-medium">Priority</span>
                  <SegmentBox
                    label="Priority"
                    value={priority}
                    onChange={setPriority}
                    options={PRIORITY_OPTIONS}
                  />
                </div>
              </div>
              <div className="grid content-start gap-1.5">
                <Label htmlFor="task-description">Description</Label>
                <MentionTextarea
                  id="task-description"
                  value={description}
                  onChange={setDescription}
                  rows={4}
                  maxLength={20000}
                  placeholder="Description"
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
              <div className="grid content-start gap-1.5">
                <span className="text-sm leading-none font-medium">Status</span>
                <SegmentBox
                  label="Status"
                  value={status}
                  onChange={setStatus}
                  options={STATUS_OPTIONS}
                />
              </div>
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
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 [&>*]:min-w-0">
                <div className="grid content-start gap-1.5">
                  <span className="text-sm leading-none font-medium">Who can see it</span>
                  <SegmentBox
                    label="Who can see it"
                    value={visibility}
                    onChange={setVisibility}
                    options={VISIBILITY_OPTIONS}
                    disabled={!isTopLevel}
                  />
                </div>
                {hasStart && (
                  <div className="grid content-start gap-1.5">
                    <Label htmlFor="task-start">Starts</Label>
                    <DueField
                      id="task-start"
                      label="Start date"
                      emptyLabel="No start date"
                      value={startDate}
                      onChange={setStartDate}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {error && (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>

      {confirmElement}
      <DialogFooter className="m-0 shrink-0 flex-row items-center border-t px-6 py-4 sm:justify-between">
        <label className="text-muted-foreground flex items-center gap-2 text-sm">
          <Switch
            checked={keepAdding}
            onCheckedChange={(on) => {
              setKeepAdding(on);
              writeKeepAdding(on);
            }}
          />
          Keep adding
        </label>
        <Button type="submit" disabled={isPending || !title.trim()}>
          {isPending ? "Creating" : `Create ${noun}`}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** "Keep adding" is remembered in this browser (one person's habit). */
const KEEP_ADDING_KEY = "bs-new-task-keep-adding";
function readKeepAdding(): boolean {
  try {
    return window.localStorage.getItem(KEEP_ADDING_KEY) === "1";
  } catch {
    return false;
  }
}
function writeKeepAdding(on: boolean) {
  try {
    window.localStorage.setItem(KEEP_ADDING_KEY, on ? "1" : "0");
  } catch {
    // Private windows refuse storage; it just isn't remembered.
  }
}
