"use client";

import { Pencil, Trash2 } from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  deleteNoteAction,
  draftNoteTaskAction,
  restoreNoteAction,
  updateNoteAction,
} from "@/app/app/[orgSlug]/crm/note-actions";
import { AMBIENT_BUTTON, AmbientWhy } from "@/components/ambient/ambient-button";
import { useCrmOpen } from "@/components/crm/card/use-crm-open";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast, undoable } from "@/components/ui/toaster";
import type { NoteTaskDraft } from "@/lib/crm/note-task";
import { runAction } from "@/lib/run-action";
import { cn } from "@/lib/utils";

import { TaskPreview } from "./task-preview";

/**
 * A person's or company's notes (docs/features/crm.md, "Notes and tasks"):
 * the NOTE entries of its timeline, newest first, no copy of their own.
 * Each one can be changed or deleted (Undo puts it back) by whoever wrote
 * it or an owner or admin, and "Make it a task" has the organization's AI
 * write a task from it, previewed right under it. New notes are written in
 * the card's composer (its Note channel).
 */

export interface NoteItem {
  id: string;
  subject: string | null;
  body: string | null;
  occurredAt: string;
  by: string | null;
  /** Its author, or an owner or admin, may change it (row-level rules decide too). */
  canEdit: boolean;
  /** On a company's card: the person it's about, when it's one of its people's. */
  about: { id: string; label: string } | null;
}

function when(iso: string): string {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: days > 300 ? "numeric" : undefined,
  });
}

const QUIET_BUTTON =
  "text-muted-foreground hover:text-foreground hover:bg-muted grid size-7 shrink-0 place-items-center rounded-full";

export function NotesList({
  orgId,
  orgSlug,
  target,
  notes,
  members,
  recordName,
  readOnly = false,
}: {
  orgId: string;
  orgSlug: string;
  target: { kind: "person" | "company"; id: string };
  notes: NoteItem[];
  members: readonly { id: string; name: string }[];
  recordName: string;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const { hrefFor } = useCrmOpen();
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [drafting, setDrafting] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ noteId: string; draft: NoteTaskDraft } | null>(null);
  const first = recordName.split(" ")[0] ?? recordName;

  // New server data (a note just written below) replaces what was changed here.
  const [shown, setShown] = useState(notes);
  if (shown !== notes) {
    setShown(notes);
    setEdits({});
  }

  const list = notes.filter((n) => !hidden.has(n.id));

  async function save() {
    if (!editing || saving) return;
    const text = editing.text.trim();
    if (!text) return toast({ title: "Write something, or delete the note.", tone: "error" });
    setSaving(true);
    const r = await runAction(() => updateNoteAction(orgId, editing.id, text));
    setSaving(false);
    if (!r) return;
    if (!r.ok) return toast({ title: r.error, tone: "error" });
    setEdits((e) => ({ ...e, [editing.id]: text }));
    setEditing(null);
    toast({ title: "Saved" });
    router.refresh();
  }

  async function remove(id: string) {
    setHidden((h) => new Set(h).add(id));
    const ok = await undoable({
      title: "Note deleted",
      run: async () => {
        const r = await runAction(() => deleteNoteAction(orgId, id));
        if (!r) return "That didn't go through. Try again.";
        if (!r.ok) return r.error;
        router.refresh();
      },
      undo: async () => {
        const r = await runAction(() => restoreNoteAction(orgId, id));
        if (!r) return "That didn't go through. Try again.";
        if (!r.ok) return r.error;
        setHidden((h) => {
          const next = new Set(h);
          next.delete(id);
          return next;
        });
        router.refresh();
      },
    });
    if (!ok) {
      setHidden((h) => {
        const next = new Set(h);
        next.delete(id);
        return next;
      });
    }
  }

  async function makeTask(noteId: string) {
    if (drafting) return;
    setDrafting(noteId);
    const r = await runAction(() => draftNoteTaskAction(orgId, { target, noteId }));
    setDrafting(null);
    if (!r) return;
    if (!r.ok) return toast({ title: r.error, tone: "error" });
    setPreview({ noteId, draft: r.draft });
  }

  if (list.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No notes on {first} yet. Write one below with Note, and turn any note into a task for
        someone.
      </p>
    );
  }

  return (
    <ol className="grid gap-2">
      {list.map((n) => {
        const body = edits[n.id] ?? n.body ?? "";
        const isEditing = editing?.id === n.id;
        return (
          <li
            key={n.id}
            className="bg-card ring-foreground/6 space-y-2 rounded-2xl px-4 py-3 ring-1"
          >
            <div className="flex items-baseline gap-2">
              <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
                {[n.by, when(n.occurredAt)].filter(Boolean).join(", ")}
                {n.about && (
                  <>
                    {", about "}
                    <Link
                      href={hrefFor({ kind: "person", id: n.about.id })}
                      scroll={false}
                      className="hover:text-foreground underline-offset-2 hover:underline"
                    >
                      {n.about.label}
                    </Link>
                  </>
                )}
              </span>
              {!readOnly && n.canEdit && !isEditing && (
                <span className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    className={QUIET_BUTTON}
                    aria-label="Change the note"
                    title="Change"
                    onClick={() => setEditing({ id: n.id, text: body })}
                  >
                    <Pencil className="size-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className={QUIET_BUTTON}
                    aria-label="Delete the note"
                    title="Delete"
                    onClick={() => void remove(n.id)}
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </button>
                </span>
              )}
            </div>
            {isEditing ? (
              <div className="space-y-2">
                <Textarea
                  value={editing.text}
                  onChange={(e) => setEditing({ id: n.id, text: e.target.value })}
                  rows={3}
                  aria-label="The note"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.stopPropagation();
                      setEditing(null);
                    }
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void save();
                  }}
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => void save()} disabled={saving}>
                    {saving ? "Saving…" : "Save"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditing(null)}
                    disabled={saving}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {n.subject && <b className="block text-[15px]">{n.subject}</b>}
                {body && <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{body}</p>}
              </>
            )}
            {!readOnly && !isEditing && preview?.noteId !== n.id && (
              <div className="flex flex-nowrap items-center gap-2">
                <button
                  type="button"
                  className={cn(
                    AMBIENT_BUTTON,
                    "text-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklab,currentColor_28%,transparent)] hover:bg-current/8",
                  )}
                  disabled={drafting !== null}
                  onClick={() => void makeTask(n.id)}
                >
                  {drafting === n.id ? "Writing the task…" : "Make it a task"}
                </button>
                <AmbientWhy className="min-w-0 truncate">Hand it to someone here</AmbientWhy>
              </div>
            )}
            {preview?.noteId === n.id && (
              <TaskPreview
                orgId={orgId}
                orgSlug={orgSlug}
                target={target}
                draft={preview.draft}
                members={members}
                onDone={() => setPreview(null)}
                onCancel={() => setPreview(null)}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
