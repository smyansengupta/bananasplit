"use client";

import { generateJSON, generateText } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { Download, Loader2, NotebookPen, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { importNote } from "@/app/app/[orgSlug]/notes/actions";
import { removeNoteFileAction } from "@/app/app/[orgSlug]/notes/files-actions";
import { Button } from "@/components/ui/button";
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
      attributes: { class: "tiptap prose prose-sm dark:prose-invert max-w-none focus:outline-none" },
    },
  });
  if (!editor) return <div className="bg-muted/40 h-64 animate-pulse rounded-lg" />;
  return <EditorContent editor={editor} />;
}

/** Download, "Make a note from this" (Word), and remove. */
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
  const [confirming, setConfirming] = useState(false);

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

  function remove() {
    start(async () => {
      setError(null);
      const result = await removeNoteFileAction(orgId, fileId);
      if (result.error) setError(result.error);
      else {
        router.push(`/app/${orgSlug}/notes?tab=files`);
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {noteHtml != null && (
        <Button type="button" variant="outline" size="sm" disabled={pending} onClick={makeNote}>
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <NotebookPen className="size-4" aria-hidden="true" />}
          Make a note from this
        </Button>
      )}
      <Button asChild variant="outline" size="sm">
        <a href={`/api/orgs/${encodeURIComponent(orgId)}/files/${encodeURIComponent(fileId)}?download=1`}>
          <Download className="size-4" aria-hidden="true" />
          Download
        </a>
      </Button>
      {canRemove &&
        (confirming ? (
          <>
            <Button type="button" variant="destructive" size="sm" disabled={pending} onClick={remove}>
              Remove for everyone
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              Keep it
            </Button>
          </>
        ) : (
          <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => setConfirming(true)}>
            <Trash2 className="size-4" aria-hidden="true" />
            Remove
          </Button>
        ))}
      {error && (
        <p role="alert" className="text-destructive w-full text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
