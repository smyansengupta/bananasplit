"use client";

import { generateJSON, generateText } from "@tiptap/core";
import {
  CalendarDays,
  FileText,
  FileUp,
  FolderPlus,
  LayoutTemplate,
  ListChecks,
  Loader2,
  Lock,
  Target,
  Upload,
  Users,
  type IconComponent,
} from "@/components/icons";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { importNote } from "@/app/app/[orgSlug]/notes/actions";
import { DocumentPreview } from "@/components/notes/file-preview";
import { NewFolderForm } from "@/components/notes/new-folder-form";
import { pickFiles } from "@/components/notes/upload-queue";
import { Button } from "@/components/ui/button";
import { CreateSplitButton } from "@/components/ui/create-split-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { FieldSelect } from "@/components/ui/field-select";
import { uploadNoteFile } from "@/lib/files/upload";
import { noteSchemaExtensions } from "@/lib/notes/schema-extensions";
import { NOTE_TEMPLATES } from "@/lib/notes/templates";
import { cn } from "@/lib/utils";

type Dialogs = "import" | "folder" | null;
type Visibility = "ORGANIZATION" | "PRIVATE";

const TEMPLATE_ICONS: Record<string, IconComponent> = { Users, CalendarDays, Target, ListChecks };

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

function VisibilityPicker({
  value,
  onChange,
}: {
  value: Visibility;
  onChange: (v: Visibility) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Who can see it">
      {(
        [
          ["ORGANIZATION", Users, "Everyone"],
          ["PRIVATE", Lock, "Private"],
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
      <FieldSelect
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="rounded-lg"
        size="sm"
      >
        <option value="">No folder</option>
        {folders.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </FieldSelect>
    </label>
  );
}

/**
 * Files › New: a blank note (the button itself) or one from a template,
 * Upload (straight to the file picker, several at once, through the page's
 * uploader), Import a doc (a .docx or a Google Doc link, previewed before
 * it's made), or a folder. Everything lands in the folder you're looking at
 * unless you pick another. A club's new notes start shared with the club;
 * in Personal there's no one to share with, so nothing asks.
 */
export function NotesNewMenu({
  orgId,
  orgSlug,
  folders,
  currentFolderId,
  personal = false,
}: {
  orgId: string;
  orgSlug: string;
  folders: { id: string; name: string }[];
  currentFolderId: string | null;
  /** The plan's largest file (PLAN_LIMITS). The page's uploader shows it now. */
  maxFileBytes?: number;
  /** A Personal space: everything is private to its owner. */
  personal?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Dialogs>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [googleUrl, setGoogleUrl] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [visibility, setVisibility] = useState<Visibility>(personal ? "PRIVATE" : "ORGANIZATION");
  const [folderId, setFolderId] = useState<string | null>(currentFolderId);
  const [keepOriginal, setKeepOriginal] = useState(true);
  const [pending, start] = useTransition();
  const wordInput = useRef<HTMLInputElement>(null);

  function show(which: Dialogs) {
    setError(null);
    setDraft(null);
    setFolderId(currentFolderId);
    setOpen(which);
  }

  /** Makes a note from HTML (a template or an imported document). */
  async function createFromHtml(
    title: string,
    html: string,
    vis: Visibility | undefined,
    folder: string | null,
  ) {
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
      const today = new Intl.DateTimeFormat("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      }).format(new Date());
      const result = await createFromHtml(
        template ? template.title : "Untitled note",
        template ? template.html(today) : "<p></p>",
        undefined,
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
      await convert(
        await fetch(`/api/orgs/${encodeURIComponent(orgId)}/notes/import`, {
          method: "POST",
          body: form,
        }),
        file,
      );
    } catch {
      setError("The import failed. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  async function importGoogle(url = googleUrl) {
    setBusy(true);
    setError(null);
    try {
      await convert(
        await fetch(`/api/orgs/${encodeURIComponent(orgId)}/notes/import`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ googleUrl: url }),
        }),
        null,
      );
    } catch {
      setError("The import failed. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  async function uploadFile(
    file: File,
    vis: Visibility,
    folder: string | null,
  ): Promise<string | null> {
    // The route or a direct upload by size, with the plan's quota errors.
    const result = await uploadNoteFile(orgId, file, { visibility: vis, folderId: folder });
    if (!result.ok) {
      setError(result.error);
      return null;
    }
    return result.file.id;
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

  const errorLine = error && (
    <p role="alert" className="text-destructive text-sm">
      {error}
    </p>
  );

  // The preview step, shared by Word and Google Docs.
  const preview = draft && (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_14rem]">
      <div className="bg-muted/40 max-h-[55vh] overflow-y-auto rounded-xl border p-3 sm:p-5">
        <div className="bg-background mx-auto max-w-2xl rounded-md border p-6 sm:p-8">
          <DocumentPreview html={draft.html} />
        </div>
      </div>
      <div className="space-y-3">
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground text-xs font-medium">Title</span>
          <Input
            value={draft.title}
            maxLength={300}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
        </label>
        <FolderSelect folders={folders} value={folderId} onChange={setFolderId} />
        {!personal && (
          <div className="grid gap-1">
            <span className="text-muted-foreground text-xs font-medium">Who can see it</span>
            <VisibilityPicker value={visibility} onChange={setVisibility} />
          </div>
        )}
        {draft.file && (
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={keepOriginal}
              onChange={(e) => setKeepOriginal(e.target.checked)}
              className="accent-primary mt-0.5 size-4"
            />
            <span>Keep the .docx</span>
          </label>
        )}
        <p className="text-muted-foreground text-xs">Pictures are left out.</p>
      </div>
    </div>
  );

  const previewFooter = draft && (
    <DialogFooter className="gap-2">
      <Button type="button" variant="ghost" disabled={busy} onClick={() => setDraft(null)}>
        Choose another
      </Button>
      <Button
        type="button"
        disabled={busy || !draft.title.trim()}
        onClick={() => void createDraft()}
      >
        {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
        Create note
      </Button>
    </DialogFooter>
  );

  return (
    <>
      {/* One group on a phone, so the page header keeps Upload beside New note, at the top right. */}
      <div className="contents max-md:flex max-md:items-center max-md:gap-2">
        {/* A phone: Upload one tap away, left of New note (the computer has it under the chevron). */}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="md:hidden"
          onClick={() => pickFiles(currentFolderId)}
        >
          <Upload className="size-4" aria-hidden="true" />
          Upload
        </Button>
        {/* New note, with every other way to add something under its chevron. */}
        <CreateSplitButton
          label="New note"
          pending={pending}
          onClick={() => fromTemplate(null)}
          menuLabel="More ways to add notes and files"
        >
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <LayoutTemplate className="size-4" aria-hidden="true" />
              From a template
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-64">
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
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => pickFiles(currentFolderId)}>
            <Upload className="size-4" aria-hidden="true" />
            Upload files
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => show("import")}>
            <FileText className="size-4" aria-hidden="true" />
            Import a doc
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => show("folder")}>
            <FolderPlus className="size-4" aria-hidden="true" />
            New folder
          </DropdownMenuItem>
        </CreateSplitButton>
      </div>

      <Dialog open={open === "folder"} onOpenChange={(o) => setOpen(o ? "folder" : null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New folder</DialogTitle>
            <DialogDescription className="sr-only">Name the folder.</DialogDescription>
          </DialogHeader>
          <NewFolderForm
            orgId={orgId}
            autoFocus
            onCreated={(folder) => {
              setOpen(null);
              toast({ title: "Folder created", tone: "success", duration: 3_000 });
              router.push(`/app/${orgSlug}/notes?folder=${encodeURIComponent(folder.id)}`);
            }}
          />
        </DialogContent>
      </Dialog>

      {/* One import for both: drop or choose a .docx, or paste a Google Doc link. */}
      <Dialog open={open === "import"} onOpenChange={(o) => !busy && setOpen(o ? "import" : null)}>
        <DialogContent
          className={cn("max-h-[92vh] overflow-y-auto", draft ? "sm:max-w-4xl" : "sm:max-w-md")}
        >
          <DialogHeader>
            <DialogTitle>{draft ? "Preview" : "Import a doc"}</DialogTitle>
            <DialogDescription className={cn(draft && "sr-only")}>
              {draft ? "Check the title and folder." : "A Word file or a Google Doc link."}
            </DialogDescription>
          </DialogHeader>
          {draft ? (
            preview
          ) : (
            <div className="space-y-4">
              <button
                type="button"
                disabled={busy}
                onClick={() => wordInput.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const file = e.dataTransfer.files?.[0];
                  if (file) void importWord(file);
                }}
                className="hover:bg-muted/50 focus-glow flex w-full flex-col items-center gap-2 rounded-xl border border-dashed p-8 text-sm"
              >
                {busy ? (
                  <Loader2
                    className="text-muted-foreground size-6 animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <FileUp className="text-muted-foreground size-6" aria-hidden="true" />
                )}
                {busy ? "Reading it" : "Choose a .docx, or drop it here"}
                <span className="text-muted-foreground text-xs">Up to 4 MB</span>
              </button>
              <form
                className="grid gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (googleUrl.trim()) void importGoogle();
                }}
              >
                <label htmlFor="import-google-url" className="text-sm font-medium">
                  Or paste a Google Doc link
                </label>
                <Input
                  id="import-google-url"
                  type="url"
                  value={googleUrl}
                  disabled={busy}
                  onChange={(e) => setGoogleUrl(e.target.value)}
                  // A pasted link previews straight away; Enter does the same.
                  onPaste={(e) => {
                    const text = e.clipboardData.getData("text").trim();
                    if (!/^https?:\/\//.test(text)) return;
                    e.preventDefault();
                    setGoogleUrl(text);
                    void importGoogle(text);
                  }}
                  placeholder="https://docs.google.com/document/d/…"
                />
                <span className="text-muted-foreground text-xs">
                  Shared as Anyone with the link.
                </span>
              </form>
            </div>
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
    </>
  );
}
