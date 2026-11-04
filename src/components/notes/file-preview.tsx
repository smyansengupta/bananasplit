"use client";

import { generateJSON, generateText } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import {
  Check,
  Download,
  Folder,
  Link2,
  Loader2,
  Lock,
  NotebookPen,
  Table2,
  Trash2,
  Users,
} from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { importNote } from "@/app/app/[orgSlug]/notes/actions";
import {
  removeNoteFileAction,
  restoreNoteFileAction,
  updateNoteFileAction,
} from "@/app/app/[orgSlug]/notes/files-actions";
import { moveToFolderAction } from "@/app/app/[orgSlug]/notes/folder-actions";
import { ItemMenu } from "@/components/item-menu";
import { SavedMark, useSaveOnChange } from "@/components/ui/autosave";
import { Button } from "@/components/ui/button";
import { MetaList } from "@/components/ui/meta-list";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { chipClass, Segmented } from "@/components/ui/segmented";
import { toast, undoable } from "@/components/ui/toaster";
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

/**
 * The file's actions, each one click: Make a note (a Word document),
 * Make a database (a spreadsheet or CSV), Download, then Copy link and
 * Delete as icons. Delete happens at once with Undo.
 */
export function FileActions({
  orgId,
  orgSlug,
  fileId,
  name,
  canRemove,
  noteHtml,
  tableHref,
  backHref,
}: {
  orgId: string;
  orgSlug: string;
  fileId: string;
  name: string;
  canRemove: boolean;
  /** Set for Word documents: the HTML a note can be made from. */
  noteHtml?: string | null;
  /** Set for spreadsheets and CSV: where "Make a database" goes. */
  tableHref?: string | null;
  /** Where to go once it's deleted (the folder it was in). */
  backHref: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

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
    void undoable({
      title: "Deleted",
      run: async () => {
        const result = await removeNoteFileAction(orgId, fileId);
        if (result.error) return result.error;
        router.push(backHref);
        router.refresh();
      },
      undo: async () => {
        const result = await restoreNoteFileAction(orgId, fileId);
        if (result.error) return result.error;
        router.push(`/app/${orgSlug}/notes/files/${fileId}`);
      },
    });
  }

  function copyLink() {
    void navigator.clipboard
      ?.writeText(`${window.location.origin}/app/${orgSlug}/notes/files/${fileId}`)
      .then(() => toast({ title: "Copied", tone: "success", duration: 3_000 }))
      .catch(() => toast({ title: "Couldn't copy the link", tone: "error" }));
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {noteHtml != null && (
        <Button type="button" variant="outline" size="sm" disabled={pending} onClick={makeNote}>
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <NotebookPen className="size-4" aria-hidden="true" />
          )}
          Make a note
        </Button>
      )}
      {tableHref && (
        <Button asChild variant="outline" size="sm">
          <Link href={tableHref}>
            <Table2 className="size-4" aria-hidden="true" />
            Make a database
          </Link>
        </Button>
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
        label={`Actions for ${name}`}
        className="rounded-lg"
        items={[
          { label: "Copy link", icon: Link2, onSelect: copyLink },
          canRemove && {
            label: "Delete",
            icon: Trash2,
            destructive: true,
            disabled: pending,
            onSelect: remove,
          },
        ]}
      />
      {error && (
        <p role="alert" className="text-destructive w-full text-sm">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * The file's name and where it lives, edited in place: click the name to
 * rename it (Enter or clicking away saves, Escape cancels), Everyone or
 * Private as a switch, and the folder as a chip that moves it. Whoever
 * can't change it sees the same facts, read-only.
 */
export function FileDetails({
  orgId,
  fileId,
  name,
  meta,
  visibility,
  folderId,
  folders,
  canEdit,
  personal,
}: {
  orgId: string;
  fileId: string;
  name: string;
  meta: string[];
  visibility: "PRIVATE" | "ORGANIZATION";
  folderId: string | null;
  folders: { id: string; name: string }[];
  canEdit: boolean;
  personal: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [shown, setShown] = useState(name);
  const [vis, setVis] = useState(visibility);
  const [folder, setFolder] = useState(folderId);
  const rename = useSaveOnChange(
    async (next: string) => (await updateNoteFileAction(orgId, fileId, { name: next })).error,
    { initial: name },
  );
  const share = useSaveOnChange(
    async (next: "PRIVATE" | "ORGANIZATION") =>
      (await updateNoteFileAction(orgId, fileId, { visibility: next })).error,
    { initial: visibility },
  );
  const move = useSaveOnChange(
    async (next: string | null) => {
      const result = await moveToFolderAction(orgId, { fileIds: [fileId] }, next);
      if (!result.ok) return result.error;
      router.refresh();
    },
    { initial: folderId },
  );
  const folderName = folders.find((f) => f.id === folder)?.name ?? "Not in a folder";

  async function commit(next: string) {
    setEditing(null);
    const clean = next.trim();
    if (!clean || clean === shown) return;
    const before = shown;
    setShown(clean);
    if (!(await rename.save(clean))) setShown(before);
    else router.refresh();
  }

  return (
    <div className="min-w-0 space-y-2">
      {editing !== null ? (
        <input
          autoFocus
          value={editing}
          maxLength={200}
          aria-label="File name"
          onChange={(e) => setEditing(e.target.value)}
          onBlur={() => void commit(editing)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void commit(editing);
            if (e.key === "Escape") setEditing(null);
          }}
          className="heading border-input bg-card focus-glow w-full rounded-lg border px-2 py-0.5 text-2xl outline-none"
        />
      ) : canEdit ? (
        <h1 className="heading text-2xl break-words">
          <button
            type="button"
            onClick={() => setEditing(shown)}
            title="Rename"
            className="hover:bg-muted -mx-1 rounded-md px-1 text-left"
          >
            {shown}
          </button>
        </h1>
      ) : (
        <h1 className="heading text-2xl break-words">{shown}</h1>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        <MetaList items={meta} />
        {!personal &&
          (canEdit ? (
            <Segmented
              label="Who can see it"
              options={[
                { value: "ORGANIZATION", label: "Everyone", icon: Users },
                { value: "PRIVATE", label: "Private", icon: Lock },
              ]}
              value={vis}
              onSelect={(v) => {
                const next = v as "PRIVATE" | "ORGANIZATION";
                const before = vis;
                setVis(next);
                void share.save(next).then((ok) => {
                  if (!ok) setVis(before);
                });
              }}
            />
          ) : (
            <span className="text-muted-foreground inline-flex items-center gap-1">
              {vis === "PRIVATE" ? (
                <Lock className="size-3.5" aria-hidden="true" />
              ) : (
                <Users className="size-3.5" aria-hidden="true" />
              )}
              {vis === "PRIVATE" ? "Private" : "Everyone"}
            </span>
          ))}
        {canEdit ? (
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" className={chipClass(false)}>
                <Folder aria-hidden="true" />
                {folderName}
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-56 p-1">
              {[{ id: null as string | null, name: "Not in a folder" }, ...folders].map((f) => (
                <button
                  key={f.id ?? "none"}
                  type="button"
                  aria-pressed={folder === f.id}
                  onClick={() => {
                    const before = folder;
                    setFolder(f.id);
                    void move.save(f.id).then((ok) => {
                      if (!ok) setFolder(before);
                    });
                  }}
                  className="hover:bg-muted flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm"
                >
                  <span className="min-w-0 flex-1 break-words">{f.name}</span>
                  {folder === f.id && <Check className="size-4 shrink-0" aria-hidden="true" />}
                </button>
              ))}
            </PopoverContent>
          </Popover>
        ) : (
          folder && (
            <span className="text-muted-foreground inline-flex items-center gap-1">
              <Folder className="size-3.5" aria-hidden="true" />
              {folderName}
            </span>
          )
        )}
        <SavedMark
          status={[rename, share, move].find((x) => x.status !== "idle")?.status ?? "idle"}
          error={rename.error ?? share.error ?? move.error}
        />
      </div>
    </div>
  );
}
