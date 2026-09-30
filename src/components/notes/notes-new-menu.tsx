"use client";

import { generateJSON, generateText } from "@tiptap/core";
import {
  ChevronDown,
  FileText,
  FileUp,
  Globe,
  Loader2,
  Lock,
  NotebookPen,
  Plus,
  Upload,
  Users,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { createNote, importNote } from "@/app/app/[orgSlug]/notes/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { NOTE_FILE_ACCEPT } from "@/lib/files/types";
import { noteSchemaExtensions } from "@/lib/notes/schema-extensions";
import { cn } from "@/lib/utils";

type Dialogs = "word" | "google" | "upload" | null;

async function readError(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
  return typeof body?.error === "string" ? body.error : fallback;
}

/**
 * The Notes page's "New" button: a blank note, a Word document or Google Doc
 * turned into a note, or a file (PDF, slides, images...) kept on the Notes
 * page. An imported document is converted here, in the browser, into the
 * editor's own document, so only what a note can hold is kept.
 */
export function NotesNewMenu({ orgId, orgSlug }: { orgId: string; orgSlug: string }) {
  const router = useRouter();
  const [open, setOpen] = useState<Dialogs>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [googleUrl, setGoogleUrl] = useState("");
  const [visibility, setVisibility] = useState<"ORGANIZATION" | "PRIVATE">("ORGANIZATION");
  const [pending, start] = useTransition();
  const wordInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  function show(which: Dialogs) {
    setError(null);
    setOpen(which);
  }

  function blankNote() {
    start(async () => {
      const result = await createNote(orgId);
      if (result.noteId) router.push(`/app/${orgSlug}/notes/${result.noteId}`);
    });
  }

  async function makeNote(res: Response) {
    if (!res.ok) {
      setError(await readError(res, "That document couldn't be imported."));
      return;
    }
    const { title, html } = (await res.json()) as { title: string; html: string };
    const extensions = noteSchemaExtensions();
    const json = generateJSON(html || "<p></p>", extensions);
    const text = generateText(json, extensions);
    const result = await importNote(orgId, {
      title: title.slice(0, 300) || "Imported document",
      contentJson: JSON.stringify(json),
      contentText: text.slice(0, 200_000),
    });
    if (result.error || !result.noteId) {
      setError(result.error ?? "That document couldn't be imported.");
      return;
    }
    setOpen(null);
    router.push(`/app/${orgSlug}/notes/${result.noteId}`);
  }

  async function importWord(file: File) {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      await makeNote(await fetch(`/api/orgs/${encodeURIComponent(orgId)}/notes/import`, { method: "POST", body: form }));
    } catch {
      setError("The import failed. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  async function importGoogle() {
    setBusy(true);
    setError(null);
    try {
      await makeNote(
        await fetch(`/api/orgs/${encodeURIComponent(orgId)}/notes/import`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ googleUrl }),
        }),
      );
    } catch {
      setError("The import failed. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("visibility", visibility);
      const res = await fetch(`/api/orgs/${encodeURIComponent(orgId)}/files`, { method: "POST", body: form });
      if (!res.ok) {
        setError(await readError(res, "The upload failed."));
        return;
      }
      const { file: stored } = (await res.json()) as { file: { id: string } };
      setOpen(null);
      router.push(`/app/${orgSlug}/notes/files/${stored.id}`);
      router.refresh();
    } catch {
      setError("The upload failed. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  const errorLine = error && (
    <p role="alert" className="text-destructive text-sm">
      {error}
    </p>
  );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Plus className="size-4" aria-hidden="true" />}
            New
            <ChevronDown className="size-3.5 opacity-70" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuItem onSelect={blankNote}>
            <NotebookPen className="size-4" aria-hidden="true" />
            Blank note
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
            Turn a document into a note
          </DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => show("word")}>
            <FileText className="size-4" aria-hidden="true" />
            Word document (.docx)
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => show("google")}>
            <Globe className="size-4" aria-hidden="true" />
            Google Doc
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => show("upload")}>
            <Upload className="size-4" aria-hidden="true" />
            Upload a file (PDF, slides, images…)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={open === "word"} onOpenChange={(o) => !busy && setOpen(o ? "word" : null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Import a Word document</DialogTitle>
            <DialogDescription>
              Headings, lists, tables, links and text formatting come across. Pictures are left
              out. The new note starts private.
            </DialogDescription>
          </DialogHeader>
          <button
            type="button"
            disabled={busy}
            onClick={() => wordInput.current?.click()}
            className="hover:bg-muted/50 flex flex-col items-center gap-2 rounded-xl border border-dashed p-8 text-sm"
          >
            {busy ? (
              <Loader2 className="text-muted-foreground size-6 animate-spin" aria-hidden="true" />
            ) : (
              <FileUp className="text-muted-foreground size-6" aria-hidden="true" />
            )}
            {busy ? "Converting…" : "Choose a .docx file"}
            <span className="text-muted-foreground text-xs">Up to 4 MB</span>
          </button>
          <input
            ref={wordInput}
            type="file"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void importWord(file);
            }}
          />
          {errorLine}
        </DialogContent>
      </Dialog>

      <Dialog open={open === "google"} onOpenChange={(o) => !busy && setOpen(o ? "google" : null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Import a Google Doc</DialogTitle>
            <DialogDescription>
              Paste the doc&apos;s link. It needs to be shared as “Anyone with the link can view”;
              if it can&apos;t be, use File › Download › Microsoft Word in Google Docs and import
              that instead.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void importGoogle();
            }}
          >
            <Input
              autoFocus
              type="url"
              value={googleUrl}
              onChange={(e) => setGoogleUrl(e.target.value)}
              placeholder="https://docs.google.com/document/d/…"
              aria-label="Google Docs link"
            />
            {errorLine}
            <DialogFooter>
              <Button type="submit" disabled={busy || !googleUrl.trim()}>
                {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                {busy ? "Importing…" : "Import"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={open === "upload"} onOpenChange={(o) => !busy && setOpen(o ? "upload" : null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Upload a file</DialogTitle>
            <DialogDescription>
              PDFs, Word, PowerPoint, Excel, images, text and CSV, up to 4 MB. It&apos;s kept on
              the Notes page and opens right here.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Who can see it">
            {(
              [
                ["ORGANIZATION", Users, "Everyone in the club"],
                ["PRIVATE", Lock, "Only me"],
              ] as const
            ).map(([value, Icon, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={visibility === value}
                onClick={() => setVisibility(value)}
                className={cn(
                  "flex items-center gap-2 rounded-lg border p-2.5 text-sm",
                  visibility === value ? "border-primary bg-primary/5 font-medium" : "hover:bg-muted/50",
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files?.[0];
              if (file) void upload(file);
            }}
            className="hover:bg-muted/50 flex flex-col items-center gap-2 rounded-xl border border-dashed p-8 text-sm"
          >
            {busy ? (
              <Loader2 className="text-muted-foreground size-6 animate-spin" aria-hidden="true" />
            ) : (
              <Upload className="text-muted-foreground size-6" aria-hidden="true" />
            )}
            {busy ? "Uploading…" : "Choose a file, or drop it here"}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept={NOTE_FILE_ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void upload(file);
            }}
          />
          {errorLine}
        </DialogContent>
      </Dialog>
    </>
  );
}
