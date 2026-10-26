"use client";

import { generateJSON, generateText } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { Download, Link2, Loader2, NotebookPen, Trash2 } from "@/components/icons";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { importNote } from "@/app/app/[orgSlug]/notes/actions";
import {
  removeNoteFileAction,
  restoreNoteFileAction,
} from "@/app/app/[orgSlug]/notes/files-actions";
import { ItemMenu } from "@/components/item-menu";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toaster";
import { NOTE_TRASH_DAYS } from "@/lib/notes/trash";
import { noteSchemaExtensions } from "@/lib/notes/schema-extensions";

/**
 * A Word document shown in the app: its HTML read into a read-only editor
 * with the note schema, so it looks like a note and nothing outside the
 * schema (scripts, styles, frames) survives.
 */
export function DocumentPreview({ html }: { html: string }) {
  const editor = useEditor({
    editable: false,
    immediatelyRender: false,
    extensions: noteSchemaExtensions(),
    content: html || "<p></p>",
    editorProps: {
      attributes: {
        class: "tiptap prose prose-sm dark:prose-invert max-w-none focus:outline-none",
      },
    },
  });
  if (!editor) return <div className="bg-muted/40 h-64 animate-pulse rounded-lg" />;
  return <EditorContent editor={editor} />;
}

/** Download, and a "…" menu: make a note from it (Word), copy its link, delete it. */
export function FileActions({
  orgId,
  orgSlug,
  fileId,
  name,
  canRemove,
  noteHtml,
}: {
  orgId: string;
  orgSlug: string;
  fileId: string;
  name: string;
  canRemove: boolean;
  /** Set for Word documents: the HTML a note can be made from. */
  noteHtml?: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmEl, confirm] = useConfirm();

  function makeNote() {
    if (noteHtml == null) return;
    start(async () => {
      setError(null);
      const extensions = noteSchemaExtensions();
      const json = generateJSON(noteHtml || "<p></p>", extensions);
      const result = await importNote(orgId, {
        title: name.replace(/\.[a-z0-9]{1,8}$/i, "").slice(0, 300) || "Imported document",
        contentJson: JSON.stringify(json),
        contentText: generateText(json, extensions).slice(0, 200_000),
      });
      if (result.error || !result.noteId) setError(result.error ?? "Couldn't make a note from it.");
      else router.push(`/app/${orgSlug}/notes/${result.noteId}`);
    });
  }

  async function remove() {
    const ok = await confirm({
      title: `Delete “${name}”?`,
      description: `It moves to Recently deleted in Files for ${NOTE_TRASH_DAYS} days, so you can bring it back. Links to it stop working until then.`,
      confirmLabel: "Delete file",
      run: async () => (await removeNoteFileAction(orgId, fileId)).error,
    });
    if (!ok) return;
    router.push(`/app/${orgSlug}/notes`);
    router.refresh();
    toast({
      title: "File deleted",
      description: name,
      action: {
        label: "Undo",
        run: async () => {
          const result = await restoreNoteFileAction(orgId, fileId);
          if (result.error) return result.error;
          router.push(`/app/${orgSlug}/notes/files/${fileId}`);
        },
      },
    });
  }

  function copyLink() {
    void navigator.clipboard
      ?.writeText(`${window.location.origin}/app/${orgSlug}/notes/files/${fileId}`)
      .then(() => toast({ title: "Link copied", tone: "success", duration: 3_000 }))
      .catch(() => toast({ title: "Couldn't copy the link", tone: "error" }));
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {pending && (
        <span
          className="text-muted-foreground inline-flex items-center gap-1 text-xs"
          aria-live="polite"
        >
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          Making a note…
        </span>
      )}
      <Button asChild variant="outline" size="sm">
        <a
          href={`/api/orgs/${encodeURIComponent(orgId)}/files/${encodeURIComponent(fileId)}?download=1`}
        >
          <Download className="size-4" aria-hidden="true" />
          Download
        </a>
      </Button>
      <ItemMenu
        label={`More actions for ${name}`}
        className="rounded-lg"
        items={[
          noteHtml != null && {
            label: "Make a note from this",
            icon: NotebookPen,
            disabled: pending,
            onSelect: makeNote,
          },
          { label: "Copy link", icon: Link2, onSelect: copyLink },
          canRemove && {
            label: "Delete file",
            icon: Trash2,
            destructive: true,
            disabled: pending,
            onSelect: () => void remove(),
          },
        ]}
      />
      {confirmEl}
      {error && (
        <p role="alert" className="text-destructive w-full text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
