"use client";

import { formatDistanceToNow } from "date-fns";
import {
  ArchiveRestore,
  CalendarDays,
  Check,
  Download,
  ExternalLink,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  Inbox,
  LayoutGrid,
  Library,
  Link2,
  List,
  Lock,
  MoreHorizontal,
  NotebookText,
  Pencil,
  Search,
  Trash2,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

import { deleteNote, restoreNote } from "@/app/app/[orgSlug]/notes/actions";
import { removeNoteFileAction, restoreNoteFileAction } from "@/app/app/[orgSlug]/notes/files-actions";
import {
  createFolderAction,
  deleteFolderAction,
  moveToFolderAction,
  updateFolderAction,
} from "@/app/app/[orgSlug]/notes/folder-actions";
import { EmptyState } from "@/components/empty-state";
import { ItemMenu } from "@/components/item-menu";
import { FILE_ICONS, FILE_LABELS } from "@/components/notes/file-card";
import { PinToggle } from "@/components/pins/pins-context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { familyOf, formatBytes } from "@/lib/files/types";
import { NOTE_TRASH_DAYS } from "@/lib/notes/trash";
import { cn } from "@/lib/utils";

const NOTE_MIME = "application/x-bananasplit-note";
const FILE_MIME = "application/x-bananasplit-file";

const COLORS = ["chart-1", "chart-2", "chart-3", "chart-4", "chart-5"] as const;

export interface LibraryFolder {
  id: string;
  name: string;
  color: string | null;
  noteCount: number;
  fileCount: number;
  canEdit: boolean;
}

export interface LibraryNote {
  id: string;
  title: string;
  snippet: string;
  visibility: "PRIVATE" | "ORGANIZATION";
  updatedAt: Date;
  authorName: string;
  eventTitle: string | null;
  folderId: string | null;
  canMove: boolean;
}

export interface LibraryFile {
  id: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  visibility: "PRIVATE" | "ORGANIZATION";
  createdAt: Date;
  uploaderName: string;
  excerpt: string | null;
  folderId: string | null;
  canMove: boolean;
}

export interface TrashNote {
  id: string;
  title: string;
  visibility: "PRIVATE" | "ORGANIZATION";
  deletedAt: Date;
  authorName: string;
}

export interface TrashFile {
  id: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  deletedAt: Date;
}

/** What a card's menu, a drop on "Recently deleted" or the Move dialog acts on. */
type Item = { kind: "note" | "file"; id: string; name: string; folderId: string | null };

/** Saves a file the API serves as an attachment (a plain link, so no client navigation). */
function downloadFrom(url: string) {
  const link = document.createElement("a");
  link.href = url;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function folderDot(color: string | null) {
  return color ? `var(--${color})` : "var(--muted-foreground)";
}

/**
 * The Notes library: folders down the side (drag a note or file onto one to
 * file it), search, sort, grid or list, Notes and Files. Cards show a
 * preview of what's inside and a pin.
 */
export function NotesLibrary({
  orgId,
  orgSlug,
  tab,
  folders,
  notes,
  files,
  pinnedHrefs,
  totals,
  trash,
  filters,
}: {
  orgId: string;
  orgSlug: string;
  tab: "notes" | "files";
  folders: LibraryFolder[];
  notes: LibraryNote[];
  files: LibraryFile[];
  pinnedHrefs: string[];
  totals: { notes: number; files: number; unfiled: number; trash: number };
  /** The "Recently deleted" view's contents (only when it is open). */
  trash: { notes: TrashNote[]; files: TrashFile[] } | null;
  filters: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [overFolder, setOverFolder] = useState<string | null>(null);
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [moving, setMoving] = useState<Item | null>(null);
  const [overTrash, setOverTrash] = useState(false);
  const [confirmEl, confirm] = useConfirm();
  const [q, setQ] = useState(params.get("q") ?? "");
  const folder = params.get("folder");
  const view = params.get("layout") === "list" ? "list" : "grid";
  const base = `/app/${orgSlug}/notes`;
  const pinned = new Set(pinnedHrefs);

  function go(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function run(task: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    start(async () => {
      const result = await task();
      if (!result.ok) setError(result.error ?? "That didn't work.");
      router.refresh();
    });
  }

  function dropOn(folderId: string | null, data: DataTransfer) {
    setOverFolder(null);
    const noteId = data.getData(NOTE_MIME);
    const fileId = data.getData(FILE_MIME);
    if (!noteId && !fileId) return;
    run(() =>
      moveToFolderAction(orgId, noteId ? { noteIds: [noteId] } : { fileIds: [fileId] }, folderId),
    );
  }

  const dropProps = (id: string | null) => ({
    onDragOver: (e: React.DragEvent) => {
      const types = Array.from(e.dataTransfer.types);
      if (!types.includes(NOTE_MIME) && !types.includes(FILE_MIME)) return;
      e.preventDefault();
      setOverFolder(id ?? "none");
    },
    onDragLeave: () => setOverFolder((f) => (f === (id ?? "none") ? null : f)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      dropOn(id, e.dataTransfer);
    },
  });

  function copyLink(href: string) {
    void navigator.clipboard
      ?.writeText(`${window.location.origin}${href}`)
      .then(() => toast({ title: "Link copied", tone: "success", duration: 3_000 }))
      .catch(() => toast({ title: "Couldn't copy the link", tone: "error" }));
  }

  /** Delete (to "Recently deleted"), with Undo. */
  async function remove(item: Item) {
    const isNote = item.kind === "note";
    const ok = await confirm({
      title: `Delete “${item.name}”?`,
      description: `It moves to Recently deleted for ${NOTE_TRASH_DAYS} days, so you can bring it back.`,
      confirmLabel: isNote ? "Delete note" : "Delete file",
      run: async () =>
        (isNote ? await deleteNote(orgId, item.id) : await removeNoteFileAction(orgId, item.id)).error,
    });
    if (!ok) return;
    router.refresh();
    toast({
      title: isNote ? "Note deleted" : "File deleted",
      description: item.name,
      action: {
        label: "Undo",
        run: async () => {
          const result = isNote ? await restoreNote(orgId, item.id) : await restoreNoteFileAction(orgId, item.id);
          if (result.error) return result.error;
          router.refresh();
        },
      },
    });
  }

  function restore(kind: "note" | "file", id: string, name: string) {
    setError(null);
    start(async () => {
      const result = kind === "note" ? await restoreNote(orgId, id) : await restoreNoteFileAction(orgId, id);
      if (result.error) {
        setError(result.error);
        return;
      }
      toast({ title: `Restored “${name}”`, tone: "success" });
      router.refresh();
    });
  }

  /** Dropping a card on "Recently deleted" deletes it (after the usual question). */
  const trashDropProps = {
    onDragOver: (e: React.DragEvent) => {
      const types = Array.from(e.dataTransfer.types);
      if (!types.includes(NOTE_MIME) && !types.includes(FILE_MIME)) return;
      e.preventDefault();
      setOverTrash(true);
    },
    onDragLeave: () => setOverTrash(false),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setOverTrash(false);
      const noteId = e.dataTransfer.getData(NOTE_MIME);
      const fileId = e.dataTransfer.getData(FILE_MIME);
      const note = noteId ? notes.find((n) => n.id === noteId) : undefined;
      const file = fileId ? files.find((f) => f.id === fileId) : undefined;
      if (note) void remove({ kind: "note", id: note.id, name: note.title || "Untitled note", folderId: note.folderId });
      else if (file) void remove({ kind: "file", id: file.id, name: file.name, folderId: file.folderId });
    },
  };

  const railItem = (
    key: string | null,
    label: string,
    icon: React.ReactNode,
    count: number,
    droppable: boolean,
    extra?: React.ReactNode,
  ) => {
    const active = (folder ?? null) === key;
    return (
      <div
        key={key ?? "all"}
        {...(droppable ? dropProps(key === "none" ? null : key) : {})}
        className={cn(
          "group flex items-center gap-1 rounded-md transition-colors",
          active ? "bg-muted" : "hover:bg-muted/60",
          overFolder === (key ?? "all") && "ring-primary bg-primary/10 ring-2",
        )}
      >
        <button
          type="button"
          onClick={() => go({ folder: key })}
          aria-current={active ? "true" : undefined}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 px-2.5 py-1.5 text-left text-sm",
            active && "font-medium",
          )}
        >
          {icon}
          <span className="truncate">{label}</span>
          <span className="text-muted-foreground ms-auto text-xs tabular-nums">{count}</span>
        </button>
        {extra}
      </div>
    );
  };

  const currentFolder = folders.find((f) => f.id === folder);
  const inTrash = folder === "trash";
  const heading = inTrash
    ? "Recently deleted"
    : folder === "none"
      ? "Not in a folder"
      : (currentFolder?.name ?? "All notes and files");

  const noteCard = (n: LibraryNote) => {
    const href = `${base}/${n.id}`;
    return (
      <li key={n.id} className="group relative">
        <Link
          href={href}
          draggable
          onDragStart={(e) => {
            // The address, so it can be dropped on Pinned; the id, to file it in a folder.
            e.dataTransfer.setData("text/uri-list", `${window.location.origin}${href}`);
            e.dataTransfer.setData("text/plain", `${window.location.origin}${href}`);
            if (n.canMove) e.dataTransfer.setData(NOTE_MIME, n.id);
          }}
          className={cn(
            "bg-card hover:border-foreground/20 focus-visible:ring-ring flex h-full flex-col overflow-hidden rounded-xl border shadow-xs transition-colors focus-visible:ring-2 focus-visible:outline-none",
            view === "list" && "flex-row items-center",
          )}
        >
          {view === "grid" && (
            <div className="bg-muted/40 relative h-32 overflow-hidden border-b px-5 pt-4">
              <div className="bg-background h-full rounded-t-md px-4 pt-3 text-[10px] leading-relaxed shadow-sm ring-1 ring-black/5">
                <p className="mb-1 truncate text-[11px] font-semibold">
                  {n.title || "Untitled note"}
                </p>
                <p className="text-muted-foreground line-clamp-5 whitespace-pre-line">
                  {n.snippet || "Empty note"}
                </p>
              </div>
            </div>
          )}
          <div
            className={cn(
              "flex min-w-0 flex-1 flex-col gap-1 p-3",
              view === "list" && "flex-row items-center gap-3 py-2.5",
            )}
          >
            {view === "list" && (
              <NotebookText className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
            )}
            <p className="flex min-w-0 items-center gap-1.5 pr-16 text-sm font-medium">
              {n.visibility === "PRIVATE" ? (
                <Lock className="text-muted-foreground size-3 shrink-0" aria-label="Private" />
              ) : null}
              <span className="truncate">{n.title || "Untitled note"}</span>
            </p>
            <p
              className={cn(
                "text-muted-foreground flex min-w-0 flex-wrap items-center gap-x-2 text-xs",
                view === "list" && "ms-auto flex-nowrap pe-16",
              )}
            >
              <span className="truncate">{n.authorName}</span>
              <span>{formatDistanceToNow(n.updatedAt, { addSuffix: true })}</span>
              {n.eventTitle && (
                <span className="inline-flex items-center gap-1 truncate">
                  <CalendarDays className="size-3" aria-hidden="true" />
                  {n.eventTitle}
                </span>
              )}
            </p>
          </div>
        </Link>
        <div
          className={cn(
            "absolute right-2 flex items-center gap-1",
            view === "grid" ? "top-2" : "top-1/2 -translate-y-1/2",
          )}
        >
          <PinToggle
            href={href}
            label={n.title || "note"}
            className={cn(
              "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
              pinned.has(href) && "opacity-100",
            )}
          />
          <ItemMenu
            label={`Actions for ${n.title || "Untitled note"}`}
            className="bg-background/90 border shadow-xs"
            items={[
              { label: "Open", icon: ExternalLink, href },
              { label: "Copy link", icon: Link2, onSelect: () => copyLink(href) },
              n.canMove && {
                label: "Move to folder…",
                icon: FolderInput,
                onSelect: () => setMoving({ kind: "note", id: n.id, name: n.title || "Untitled note", folderId: n.folderId }),
              },
              n.canMove && {
                label: "Delete",
                icon: Trash2,
                destructive: true,
                onSelect: () =>
                  void remove({ kind: "note", id: n.id, name: n.title || "Untitled note", folderId: n.folderId }),
              },
            ]}
          />
        </div>
      </li>
    );
  };

  const fileCard = (f: LibraryFile) => {
    const href = `${base}/files/${f.id}`;
    const family = familyOf(f.contentType);
    const Icon = FILE_ICONS[family];
    const src = `/api/orgs/${encodeURIComponent(orgId)}/files/${encodeURIComponent(f.id)}`;
    return (
      <li key={f.id} className="group relative">
        <Link
          href={href}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData("text/uri-list", `${window.location.origin}${href}`);
            e.dataTransfer.setData("text/plain", `${window.location.origin}${href}`);
            if (f.canMove) e.dataTransfer.setData(FILE_MIME, f.id);
          }}
          className={cn(
            "bg-card hover:border-foreground/20 focus-visible:ring-ring flex h-full flex-col overflow-hidden rounded-xl border shadow-xs transition-colors focus-visible:ring-2 focus-visible:outline-none",
            view === "list" && "flex-row items-center",
          )}
        >
          {view === "grid" && (
            <div className="bg-muted/40 relative grid h-32 place-items-center overflow-hidden border-b">
              {family === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element -- a private, permission-checked file
                <img src={src} alt="" loading="lazy" className="size-full object-cover" />
              ) : f.excerpt ? (
                <div className="bg-background absolute inset-x-5 top-4 bottom-0 rounded-t-md px-4 pt-3 text-[10px] leading-relaxed shadow-sm ring-1 ring-black/5">
                  <p className="text-muted-foreground line-clamp-6 whitespace-pre-line">
                    {f.excerpt}
                  </p>
                </div>
              ) : (
                <span
                  className={cn(
                    "grid size-14 place-items-center rounded-2xl",
                    family === "pdf"
                      ? "bg-destructive/10 text-destructive"
                      : "bg-primary/10 text-primary",
                  )}
                >
                  <Icon className="size-7" aria-hidden="true" />
                </span>
              )}
              <span className="bg-background/90 absolute top-2 left-2 rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase shadow-xs">
                {FILE_LABELS[family]}
              </span>
            </div>
          )}
          <div
            className={cn(
              "flex min-w-0 flex-1 flex-col gap-1 p-3",
              view === "list" && "flex-row items-center gap-3 py-2.5",
            )}
          >
            {view === "list" && (
              <Icon className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
            )}
            <p className="flex min-w-0 items-center gap-1.5 pr-16 text-sm font-medium">
              {f.visibility === "PRIVATE" && (
                <Lock className="text-muted-foreground size-3 shrink-0" aria-label="Only you" />
              )}
              <span className="truncate">{f.name}</span>
            </p>
            <p
              className={cn(
                "text-muted-foreground text-xs",
                view === "list" && "ms-auto pe-16 whitespace-nowrap",
              )}
            >
              {formatBytes(f.sizeBytes)} · {f.uploaderName},{" "}
              {formatDistanceToNow(f.createdAt, { addSuffix: true })}
            </p>
          </div>
        </Link>
        <div
          className={cn(
            "absolute right-2 flex items-center gap-1",
            view === "grid" ? "top-2" : "top-1/2 -translate-y-1/2",
          )}
        >
          <PinToggle
            href={href}
            label={f.name}
            className={cn(
              "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
              pinned.has(href) && "opacity-100",
            )}
          />
          <ItemMenu
            label={`Actions for ${f.name}`}
            className="bg-background/90 border shadow-xs"
            items={[
              { label: "Open", icon: ExternalLink, href },
              { label: "Download", icon: Download, onSelect: () => downloadFrom(`${src}?download=1`) },
              { label: "Copy link", icon: Link2, onSelect: () => copyLink(href) },
              f.canMove && {
                label: "Move to folder…",
                icon: FolderInput,
                onSelect: () => setMoving({ kind: "file", id: f.id, name: f.name, folderId: f.folderId }),
              },
              f.canMove && {
                label: "Delete",
                icon: Trash2,
                destructive: true,
                onSelect: () => void remove({ kind: "file", id: f.id, name: f.name, folderId: f.folderId }),
              },
            ]}
          />
        </div>
      </li>
    );
  };

  const items = tab === "notes" ? notes : files;

  return (
    <div className="grid gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
      <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
        <div className="space-y-0.5">
          {railItem(
            null,
            "Everything",
            <Library className="size-4 shrink-0" aria-hidden="true" />,
            totals.notes + totals.files,
            false,
          )}
          {railItem(
            "none",
            "Not in a folder",
            <Inbox className="size-4 shrink-0" aria-hidden="true" />,
            totals.unfiled,
            true,
          )}
        </div>
        <div className="space-y-0.5">
          <div className="flex items-center justify-between px-2.5 pb-1">
            <span className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
              Folders
            </span>
            <button
              type="button"
              onClick={() => setNewFolder("")}
              aria-label="New folder"
              className="text-muted-foreground hover:text-foreground hover:bg-muted rounded p-0.5"
            >
              <FolderPlus className="size-4" aria-hidden="true" />
            </button>
          </div>
          {folders.map((f) =>
            renaming?.id === f.id ? (
              <form
                key={f.id}
                className="px-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  const name = renaming.name;
                  setRenaming(null);
                  run(() => updateFolderAction(orgId, f.id, { name }));
                }}
              >
                <Input
                  autoFocus
                  value={renaming.name}
                  maxLength={80}
                  onChange={(e) => setRenaming({ id: f.id, name: e.target.value })}
                  onBlur={() => setRenaming(null)}
                  aria-label="Folder name"
                  className="h-8"
                />
              </form>
            ) : (
              railItem(
                f.id,
                f.name,
                folder === f.id ? (
                  <FolderOpen
                    className="size-4 shrink-0"
                    style={{ color: folderDot(f.color) }}
                    aria-hidden="true"
                  />
                ) : (
                  <Folder
                    className="size-4 shrink-0"
                    style={{ color: folderDot(f.color) }}
                    aria-hidden="true"
                  />
                ),
                f.noteCount + f.fileCount,
                true,
                <>
                  <PinToggle
                    href={`${base}?folder=${f.id}`}
                    label={`folder ${f.name}`}
                    className="size-6 border-transparent bg-transparent opacity-0 shadow-none group-hover:opacity-100 focus-visible:opacity-100"
                  />
                  {f.canEdit ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          aria-label={`${f.name} options`}
                          className="text-muted-foreground hover:text-foreground me-1 rounded p-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                        >
                          <MoreHorizontal className="size-4" aria-hidden="true" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setRenaming({ id: f.id, name: f.name })}>
                          <Pencil className="size-4" aria-hidden="true" />
                          Rename
                        </DropdownMenuItem>
                        <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
                          Colour
                        </DropdownMenuLabel>
                        <div className="flex gap-1.5 px-2 pb-2">
                          {[null, ...COLORS].map((c) => (
                            <button
                              key={c ?? "none"}
                              type="button"
                              aria-label={c ? `Colour ${c}` : "No colour"}
                              onClick={() =>
                                run(() => updateFolderAction(orgId, f.id, { color: c }))
                              }
                              className="grid size-5 place-items-center rounded-full border"
                              style={{ background: c ? `var(--${c})` : undefined }}
                            >
                              {f.color === c && (
                                <Check className="text-background size-3" aria-hidden="true" />
                              )}
                            </button>
                          ))}
                        </div>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive"
                          onSelect={async () => {
                            const ok = await confirm({
                              title: `Delete the folder “${f.name}”?`,
                              description: "Its notes and files stay, just out of the folder.",
                              confirmLabel: "Delete folder",
                              run: async () => {
                                const result = await deleteFolderAction(orgId, f.id);
                                return result.ok ? undefined : result.error;
                              },
                            });
                            if (!ok) return;
                            if (folder === f.id) go({ folder: null });
                            router.refresh();
                            toast({
                              title: `Folder “${f.name}” deleted`,
                              description: "Everything in it is under Not in a folder.",
                            });
                          }}
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                          Delete folder
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </>,
              )
            ),
          )}
          {newFolder !== null ? (
            <form
              className="px-1"
              onSubmit={(e) => {
                e.preventDefault();
                const name = newFolder;
                setNewFolder(null);
                if (name.trim()) run(() => createFolderAction(orgId, name, null));
              }}
            >
              <Input
                autoFocus
                value={newFolder}
                maxLength={80}
                placeholder="Folder name"
                onChange={(e) => setNewFolder(e.target.value)}
                onBlur={() => {
                  if (!newFolder.trim()) setNewFolder(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setNewFolder(null);
                }}
                aria-label="New folder name"
                className="h-8"
              />
            </form>
          ) : folders.length === 0 ? (
            <button
              type="button"
              onClick={() => setNewFolder("")}
              className="text-muted-foreground hover:text-foreground flex w-full items-center gap-2 rounded-md border border-dashed px-2.5 py-2 text-xs"
            >
              <FolderPlus className="size-4" aria-hidden="true" />
              Make a folder, then drag notes into it
            </button>
          ) : null}
        </div>
        <div
          {...trashDropProps}
          className={cn("rounded-md border-t pt-3", overTrash && "ring-destructive bg-destructive/10 ring-2")}
        >
          {railItem(
            "trash",
            "Recently deleted",
            <Trash2 className="size-4 shrink-0" aria-hidden="true" />,
            totals.trash,
            false,
          )}
          {overTrash && <p className="text-destructive px-2.5 pt-1 text-xs">Drop to delete</p>}
        </div>
        {error && <p className="text-destructive px-2 text-xs">{error}</p>}
      </aside>

      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto flex items-center gap-2 text-lg font-semibold tracking-tight">
            {currentFolder ? (
              <FolderOpen
                className="size-5"
                style={{ color: folderDot(currentFolder.color) }}
                aria-hidden="true"
              />
            ) : null}
            {heading}
          </h2>
          {!inTrash && (
            <>
              <form
                className="relative"
                onSubmit={(e) => {
                  e.preventDefault();
                  go({ q: q.trim() || null });
                }}
              >
                <Search
                  className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
                  aria-hidden="true"
                />
                <Input
                  type="search"
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    if (!e.target.value) go({ q: null });
                  }}
                  placeholder={tab === "notes" ? "Search notes" : "Search files"}
                  aria-label="Search"
                  className="h-9 w-48 pl-8"
                />
              </form>
              {filters}
              <div className="bg-muted flex rounded-md p-0.5" role="group" aria-label="Layout">
                {(
                  [
                    ["grid", LayoutGrid, "Grid"],
                    ["list", List, "List"],
                  ] as const
                ).map(([v, Icon, label]) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={view === v}
                    aria-label={label}
                    onClick={() => go({ layout: v === "grid" ? null : v })}
                    className={cn(
                      "rounded px-2 py-1",
                      view === v ? "bg-background shadow-xs" : "text-muted-foreground",
                    )}
                  >
                    <Icon className="size-4" aria-hidden="true" />
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {inTrash ? (
          <TrashView trash={trash} pending={pending} onRestore={restore} />
        ) : (
          <>
            <nav aria-label="Notes sections" className="border-b">
              <ul className="-mb-px flex gap-1">
                {(
                  [
                    ["notes", "Notes", NotebookText, totals.notes],
                    ["files", "Files", FolderOpen, totals.files],
                  ] as const
                ).map(([id, label, Icon, count]) => (
                  <li key={id}>
                    <button
                      type="button"
                      onClick={() => go({ tab: id === "notes" ? null : id })}
                      aria-current={tab === id ? "page" : undefined}
                      className={cn(
                        "inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                        tab === id
                          ? "border-primary text-foreground"
                          : "text-muted-foreground hover:text-foreground border-transparent",
                      )}
                    >
                      <Icon className="size-4" aria-hidden="true" />
                      {label}
                      <span className="bg-muted text-muted-foreground rounded-full px-1.5 text-[11px] tabular-nums">
                        {count}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </nav>

            {items.length === 0 ? (
              <EmptyState
                icon={tab === "notes" ? NotebookText : FolderOpen}
                title={
                  params.get("q")
                    ? "Nothing matches that search"
                    : folder
                      ? tab === "notes"
                        ? "No notes in here yet"
                        : "No files in here yet"
                      : tab === "notes"
                        ? "No notes yet"
                        : "No files yet"
                }
                description={
                  tab === "notes"
                    ? "Start one from a template, or bring in a Word document or Google Doc with “New”. Drag notes onto a folder to file them."
                    : "Upload PDFs, slides, spreadsheets and images with “New” › Upload a file. They open right here."
                }
              />
            ) : (
              <ul
                className={cn(
                  view === "grid"
                    ? "grid [grid-template-columns:repeat(auto-fill,minmax(14rem,1fr))] gap-3"
                    : "space-y-2",
                  pending && "opacity-70",
                )}
              >
                {tab === "notes" ? notes.map(noteCard) : files.map(fileCard)}
              </ul>
            )}
            <p className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs">
              <FolderInput className="size-3.5" aria-hidden="true" />
              Drag a card onto a folder to move it, or onto Recently deleted to delete it.
              <Users className="ms-2 size-3.5" aria-hidden="true" />
              Folders are shared with the club; private notes stay private inside them.
            </p>
          </>
        )}
      </div>
      {confirmEl}
      <MoveDialog
        item={moving}
        folders={folders}
        onClose={() => setMoving(null)}
        onMove={(item, folderId) => {
          setMoving(null);
          run(() =>
            moveToFolderAction(orgId, item.kind === "note" ? { noteIds: [item.id] } : { fileIds: [item.id] }, folderId),
          );
          const name = folderId ? (folders.find((f) => f.id === folderId)?.name ?? "the folder") : "Not in a folder";
          toast({ title: `Moved to ${name}`, description: item.name, duration: 4_000 });
        }}
      />
    </div>
  );
}

function MoveDialog({
  item,
  folders,
  onClose,
  onMove,
}: {
  item: Item | null;
  folders: LibraryFolder[];
  onClose: () => void;
  onMove: (item: Item, folderId: string | null) => void;
}) {
  const choices: { id: string | null; name: string; color: string | null }[] = [
    { id: null, name: "Not in a folder", color: null },
    ...folders.map((f) => ({ id: f.id, name: f.name, color: f.color })),
  ];
  return (
    <Dialog open={item !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Move to a folder</DialogTitle>
          <DialogDescription className="truncate">{item?.name}</DialogDescription>
        </DialogHeader>
        <ul className="-mx-1 max-h-72 space-y-0.5 overflow-y-auto">
          {choices.map((c) => {
            const current = (item?.folderId ?? null) === c.id;
            return (
              <li key={c.id ?? "none"}>
                <button
                  type="button"
                  disabled={current}
                  onClick={() => item && onMove(item, c.id)}
                  className="hover:bg-muted flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm disabled:opacity-60"
                >
                  {c.id ? (
                    <Folder className="size-4 shrink-0" style={{ color: folderDot(c.color) }} aria-hidden="true" />
                  ) : (
                    <Inbox className="size-4 shrink-0" aria-hidden="true" />
                  )}
                  <span className="truncate">{c.name}</span>
                  {current && <span className="text-muted-foreground ms-auto text-xs">Here now</span>}
                </button>
              </li>
            );
          })}
        </ul>
        {folders.length === 0 && (
          <p className="text-muted-foreground text-xs">No folders yet: make one with the + next to Folders.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TrashView({
  trash,
  pending,
  onRestore,
}: {
  trash: { notes: TrashNote[]; files: TrashFile[] } | null;
  pending: boolean;
  onRestore: (kind: "note" | "file", id: string, name: string) => void;
}) {
  const rows = [
    ...(trash?.notes ?? []).map((n) => ({
      kind: "note" as const,
      id: n.id,
      name: n.title || "Untitled note",
      detail: n.authorName,
      deletedAt: n.deletedAt,
      Icon: NotebookText,
    })),
    ...(trash?.files ?? []).map((f) => ({
      kind: "file" as const,
      id: f.id,
      name: f.name,
      detail: formatBytes(f.sizeBytes),
      deletedAt: f.deletedAt,
      Icon: FILE_ICONS[familyOf(f.contentType)],
    })),
  ].sort((a, b) => b.deletedAt.getTime() - a.deletedAt.getTime());

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm">
        Notes and files deleted in the last {NOTE_TRASH_DAYS} days. Restore puts them back where they were;
        after {NOTE_TRASH_DAYS} days deleted files are gone for good.
      </p>
      {rows.length === 0 ? (
        <EmptyState
          icon={Trash2}
          title="Nothing here"
          description="When you delete a note or a file, it waits here for a while in case you change your mind."
        />
      ) : (
        <ul className={cn("divide-y rounded-xl border", pending && "opacity-70")}>
          {rows.map((r) => (
            <li key={`${r.kind}-${r.id}`} className="flex items-center gap-3 px-3 py-2.5">
              <r.Icon className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{r.name}</p>
                <p className="text-muted-foreground truncate text-xs">
                  {r.kind === "note" ? "Note" : "File"} · {r.detail} · deleted{" "}
                  {formatDistanceToNow(r.deletedAt, { addSuffix: true })}
                </p>
              </div>
              <button
                type="button"
                disabled={pending}
                onClick={() => onRestore(r.kind, r.id, r.name)}
                className="hover:bg-muted inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium"
              >
                <ArchiveRestore className="size-3.5" aria-hidden="true" />
                Restore
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
