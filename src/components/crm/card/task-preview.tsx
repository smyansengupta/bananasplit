"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { createNoteTaskAction, undoNoteTaskAction } from "@/app/app/[orgSlug]/crm/note-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import type { NoteTaskDraft, NoteTaskPriority } from "@/lib/crm/note-task";
import { ORG_KEYS_PLACE } from "@/lib/crm/org-keys";
import { runAction } from "@/lib/run-action";
import { cn } from "@/lib/utils";

/**
 * A task the organization's AI wrote from a note (or the composer's Task
 * channel), shown right in the card to change before it's made: title,
 * who, when, priority and description, then Create task. It's a real task
 * in Tasks, linked to the record; Undo in the toast takes it back.
 */

const NOBODY = "nobody";
const PRIORITY_WORDS: Record<NoteTaskPriority, string> = {
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
};

export function TaskPreview({
  orgId,
  orgSlug,
  target,
  draft,
  members,
  onDone,
  onCancel,
  className,
}: {
  orgId: string;
  orgSlug: string;
  target: { kind: "person" | "company"; id: string };
  draft: NoteTaskDraft;
  members: readonly { id: string; name: string }[];
  /** Made (or taken back): close the preview. */
  onDone: () => void;
  onCancel: () => void;
  className?: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(draft.title);
  const [ownerId, setOwnerId] = useState<string | null>(draft.ownerId);
  const [dueDate, setDueDate] = useState(draft.dueDate ?? "");
  const [priority, setPriority] = useState<NoteTaskPriority>(draft.priority);
  const [description, setDescription] = useState(draft.description);
  const [busy, setBusy] = useState(false);
  const why = ownerId && ownerId === draft.ownerId ? draft.ownerWhy : null;

  async function create() {
    if (!title.trim() || busy) return;
    setBusy(true);
    const r = await runAction(() =>
      createNoteTaskAction(orgId, {
        target,
        noteId: draft.noteId,
        title,
        description,
        ownerId,
        dueDate: dueDate || null,
        priority,
      }),
    );
    setBusy(false);
    if (!r) return;
    if (!r.ok) return toast({ title: r.error, tone: "error" });
    onDone();
    router.refresh();
    toast({
      title: r.ownerName ? `Task created for ${r.ownerName}` : "Task created",
      description: (
        <a href={`/app/${orgSlug}/tasks/${r.taskId}`} className="underline underline-offset-2">
          Open the task
        </a>
      ),
      action: {
        label: "Undo",
        run: async () => {
          const u = await runAction(() => undoNoteTaskAction(orgId, r.taskId, r.activityId));
          if (!u) return "That didn't go through. Try again.";
          if (!u.ok) return u.error;
          router.refresh();
        },
      },
    });
  }

  return (
    <div
      className={cn("bg-card ring-foreground/8 space-y-2.5 rounded-2xl p-3.5 ring-1", className)}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        aria-label="Task title"
        placeholder="What to do"
        className="h-9 font-semibold"
        autoFocus
      />
      <div className="grid gap-2 sm:grid-cols-[1fr_9.5rem_7.5rem]">
        <div className="flex min-w-0 items-center gap-2">
          <Select
            value={ownerId ?? NOBODY}
            onValueChange={(v) => setOwnerId(v === NOBODY ? null : v)}
          >
            <SelectTrigger aria-label="Assign to" className="h-9 min-w-0 flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NOBODY}>Nobody yet</SelectItem>
              {members.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {why && <span className="text-muted-foreground shrink-0 truncate text-xs">{why}</span>}
        </div>
        <Input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          aria-label="Due"
          className="h-9"
        />
        <Select value={priority} onValueChange={(v) => setPriority(v as NoteTaskPriority)}>
          <SelectTrigger aria-label="Priority" className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(PRIORITY_WORDS) as NoteTaskPriority[]).map((p) => (
              <SelectItem key={p} value={p}>
                {PRIORITY_WORDS[p]} priority
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={3}
        aria-label="Description"
        className="text-sm"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => void create()} disabled={busy || !title.trim()}>
          {busy ? "Creating…" : "Create task"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <span className="text-muted-foreground min-w-0 flex-1 text-end text-xs">
          {draft.noKey
            ? `Read from the note. AI can write it once a key is added in ${ORG_KEYS_PLACE}.`
            : draft.ai
              ? "Written by AI. Change anything first."
              : null}
        </span>
      </div>
    </div>
  );
}
