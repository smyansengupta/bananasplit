"use client";

import { generateJSON, generateText } from "@tiptap/core";
import {
  CalendarDays,
  ChevronDown,
  FileText,
  FileUp,
  Globe,
  ListChecks,
  Loader2,
  Lock,
  NotebookPen,
  Plus,
  Target,
  Upload,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { importNote } from "@/app/app/[orgSlug]/notes/actions";
import { DocumentPreview } from "@/components/notes/file-preview";
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
import { NOTE_TEMPLATES } from "@/lib/notes/templates";
import { cn } from "@/lib/utils";

type Dialogs = "word" | "google" | "upload" | null;
type Visibility = "ORGANIZATION" | "PRIVATE";

const TEMPLATE_ICONS: Record<string, LucideIcon> = { Users, CalendarDays, Target, ListChecks };

interface Draft {
  title: string;
  html: string;
  /** The Word file it came from, to keep beside the note if wanted. */
  file: File | null;
}

async function readError(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
  return typeof body?.error === "string" ? body.error : fallback;
}

function VisibilityPicker({ value, onChange }: { value: Visibility; onChange: (v: Visibility) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Who can see it">
      {(
        [
          ["ORGANIZATION", Users, "Everyone in the club"],
          ["PRIVATE", Lock, "Only me"],
        ] as const
      ).map(([v, Icon, label]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={cn(
            "flex items-center gap-2 rounded-lg border p-2 text-sm",
            value === v ? "border-primary bg-primary/5 font-medium" : "hover:bg-muted/50",
          )}
        >
          <Icon className="size-4" aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  );
}

function FolderSelect({
  folders,
  value,
  onChange,
}: {
  folders: { id: string; name: string }[];
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  if (folders.length === 0) return null;
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-muted-foreground text-xs font-medium">Folder</span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="border-input h-9 rounded-md border bg-transparent px-2 text-sm"
      >
        <option value="">No folder</option>
        {folders.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Notes › New: a blank note or one from a template, a Word document or
 * Google Doc turned into a note (with a preview first, so you see what
 * came across before it's made), or a file for the Files tab. Everything
 * lands in the folder you're looking at unless you pick another.
 */
export function NotesNewMenu({
  orgId,
  orgSlug,
  folders,
  currentFolderId,
}: {
  orgId: string;
  orgSlug: string;
  folders: { id: string; name: string }[];
  currentFolderId: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Dialogs>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [googleUrl, setGoogleUrl] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [visibility, setVisibility] = useState<Visibility>("ORGANIZATION");
  const [folderId, setFolderId] = useState<string | null>(currentFolderId);
  const [keepOriginal, setKeepOriginal] = useState(true);
  const [pending, start] = useTransition();
  const wordInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  function show(which: Dialogs) {
    setError(null);
    setDraft(null);
    setFolderId(currentFolderId);
    setOpen(which);
  }

  /** Makes a note from HTML (a template or an imported document). */
  async function createFromHtml(title: string, html: string, vis: Visibility, folder: string | null) {
    const extensions = noteSchemaExtensions();
    const json = generateJSON(html || "<p></p>", extensions);
    return importNote(orgId, {
      title: title.trim().slice(0, 300) || "Untitled note",
      contentJson: JSON.stringify(json),
      contentText: generateText(json, extensions).slice(0, 200_000),
      folderId: folder,
      visibility: vis,
    });
  }

  function fromTemplate(templateId: string | null) {
    start(async () => {
      const template = NOTE_TEMPLATES.find((t) => t.id === templateId);
      const today = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(new Date());
      const result = await createFromHtml(
        template ? template.title : "Untitled note",
        template ? template.html(today) : "<p></p>",
        "PRIVATE",
        currentFolderId,
      );
      if (result.noteId) router.push(`/app/${orgSlug}/notes/${result.noteId}`);
    });
  }

  async function convert(res: Response, file: File | null) {
    if (!res.ok) {
      setError(await readError(res, "That document couldn't be imported."));
      return;
    }
    const { title, html } = (await res.json()) as { title: string; html: string };
    setDraft({ title, html, file });
  }

  async function importWord(file: File) {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      await convert(await fetch(`/api/orgs/${encodeURIComponent(orgId)}/notes/import`, { method: "POST", body: form }), file);
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
      await convert(
        await fetch(`/api/orgs/${encodeURIComponent(orgId)}/notes/import`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ googleUrl }),
        }),
        null,
      );
    } catch {
      setError("The import failed. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  async function uploadFile(file: File, vis: Visibility, folder: string | null): Promise<string | null> {
    const form = new FormData();
    form.set("file", file);
    form.set("visibility", vis);
    if (folder) form.set("folderId", folder);
    const res = await fetch(`/api/orgs/${encodeURIComponent(orgId)}/files`, { method: "POST", body: form });
    if (!res.ok) {
      setError(await readError(res, "The upload failed."));
      return null;
    }
    return ((await res.json()) as { file: { id: string } }).file.id;
  }

  async function createDraft() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      const result = await createFromHtml(draft.title, draft.html, visibility, folderId);
      if (result.error || !result.noteId) {
        setError(result.error ?? "That document couldn't be turned into a note.");
        return;
      }
      if (draft.file && keepOriginal) await uploadFile(draft.file, visibility, folderId);
      setOpen(null);
      router.push(`/app/${orgSlug}/notes/${result.noteId}`);
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const id = await uploadFile(file, visibility, folderId);
      if (!id) return;
      setOpen(null);
      router.push(`/app/${orgSlug}/notes/files/${id}`);
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

  // The preview step, shared by Word and Google Docs.
  const preview = draft && (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_14rem]">
      <div className="bg-muted/40 max-h-[55vh] overflow-y-auto rounded-xl border p-3 sm:p-5">
        <div className="bg-background mx-auto max-w-2xl rounded-md p-6 shadow-sm ring-1 ring-black/5 sm:p-8">
          <DocumentPreview html={draft.html} />
        </div>
      </div>
      <div className="space-y-3">
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground text-xs font-medium">Title</span>
          <Input value={draft.title} maxLength={300} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        </label>
        <FolderSelect folders={folders} value={folderId} onChange={setFolderId} />
        <div className="grid gap-1">
          <span className="text-muted-foreground text-xs font-medium">Who can see it</span>
          <VisibilityPicker value={visibility} onChange={setVisibility} />
        </div>
        {draft.file && (
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={keepOriginal}
              onChange={(e) => setKeepOriginal(e.target.checked)}
              className="accent-primary mt-0.5 size-4"
            />
            <span>
              Keep the original .docx in Files too
              <span className="text-muted-foreground block text-xs">So it can be downloaded as it was.</span>
            </span>
          </label>
        )}
        <p className="text-muted-foreground text-xs">
          Headings, lists, tables, links and formatting come across. Pictures are left out.
        </p>
      </div>
    </div>
  );

  const previewFooter = draft && (
    <DialogFooter className="gap-2">
      <Button type="button" variant="ghost" disabled={busy} onClick={() => setDraft(null)}>
        Choose another
      </Button>
      <Button type="button" disabled={busy || !draft.title.trim()} onClick={() => void createDraft()}>
        {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
        Create note
      </Button>
    </DialogFooter>
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
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuItem onSelect={() => fromTemplate(null)}>
            <NotebookPen className="size-4" aria-hidden="true" />
            Blank note
          </DropdownMenuItem>
          <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">From a template</DropdownMenuLabel>
          {NOTE_TEMPLATES.map((t) => {
            const Icon = TEMPLATE_ICONS[t.icon] ?? FileText;
            return (
              <DropdownMenuItem key={t.id} onSelect={() => fromTemplate(t.id)}>
                <Icon className="size-4" aria-hidden="true" />
                <span className="flex flex-col">
                  {t.title}
                  <span className="text-muted-foreground text-xs">{t.description}</span>
                </span>
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">Turn a document into a note</DropdownMenuLabel>
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
        <DialogContent className={cn("max-h-[92vh] overflow-y-auto", draft ? "sm:max-w-4xl" : "sm:max-w-md")}>
          <DialogHeader>
            <DialogTitle>{draft ? "Here's how it came across" : "Import a Word document"}</DialogTitle>
            <DialogDescription>
              {draft
                ? "Check the text, pick a title and folder, then create the note."
                : "You'll see a preview before anything is created."}
            </DialogDescription>
          </DialogHeader>
          {draft ? (
            preview
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => wordInput.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files?.[0];
                if (file) void importWord(file);
              }}
              className="hover:bg-muted/50 flex flex-col items-center gap-2 rounded-xl border border-dashed p-8 text-sm"
            >
              {busy ? (
                <Loader2 className="text-muted-foreground size-6 animate-spin" aria-hidden="true" />
              ) : (
                <FileUp className="text-muted-foreground size-6" aria-hidden="true" />
              )}
              {busy ? "Reading it…" : "Choose a .docx file, or drop it here"}
              <span className="text-muted-foreground text-xs">Up to 4 MB</span>
            </button>
          )}
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
          {previewFooter}
        </DialogContent>
      </Dialog>

      <Dialog open={open === "google"} onOpenChange={(o) => !busy && setOpen(o ? "google" : null)}>
        <DialogContent className={cn("max-h-[92vh] overflow-y-auto", draft ? "sm:max-w-4xl" : "sm:max-w-md")}>
          <DialogHeader>
            <DialogTitle>{draft ? "Here's how it came across" : "Import a Google Doc"}</DialogTitle>
            <DialogDescription>
              {draft
                ? "Check the text, pick a title and folder, then create the note."
                : "Paste the doc's link. It needs to be shared as “Anyone with the link can view”; if it can't be, use File › Download › Microsoft Word and import that instead."}
            </DialogDescription>
          </DialogHeader>
          {draft ? (
            preview
          ) : (
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
                  {busy ? "Reading it…" : "Preview"}
                </Button>
              </DialogFooter>
            </form>
          )}
          {draft && errorLine}
          {previewFooter}
        </DialogContent>
      </Dialog>

      <Dialog open={open === "upload"} onOpenChange={(o) => !busy && setOpen(o ? "upload" : null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Upload a file</DialogTitle>
            <DialogDescription>
              PDFs, Word, PowerPoint, Excel, images, text and CSV, up to 4 MB. It opens right here in
              the app.
            </DialogDescription>
          </DialogHeader>
          <VisibilityPicker value={visibility} onChange={setVisibility} />
          <FolderSelect folders={folders} value={folderId} onChange={setFolderId} />
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

