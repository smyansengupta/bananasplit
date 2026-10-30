"use client";

import { CheckCircle2, CircleAlert, CloudUpload, Loader2, X } from "@/components/icons";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { NOTE_FILE_ACCEPT } from "@/lib/files/types";
import { formatStorage, storageLevel } from "@/lib/billing/storage";
import { uploadNoteFile } from "@/lib/files/upload";
import { cn } from "@/lib/utils";

import { isFileDrag, registerUploader } from "./upload-queue";

/**
 * The Files page's uploader. There is no drop box taking up the top of the
 * page any more: the whole page is the target. Drag files anywhere and it
 * says "Drop to upload"; drop them on a folder card or a folder in the
 * sidebar and they go into that folder (upload-queue.ts). New › Upload
 * opens the picker for several files at once. Each file gets a line with
 * its progress, and you never leave the page.
 *
 * Uploads are shared with the club, or in Personal private to its owner;
 * who can see one is changed on its page afterwards. A full space says so
 * here and takes nothing.
 */

export interface DropZoneStorage {
  usedBytes: number;
  limitBytes: number;
  maxFileBytes: number;
  canManage?: boolean;
}

interface Upload {
  key: string;
  name: string;
  state: "waiting" | "uploading" | "done" | "failed";
  percent: number;
  error?: string;
}

export function FilesDropZone({
  orgId,
  folderId,
  storage,
  personal = false,
}: {
  orgId: string;
  /** Uploads land in the folder being viewed unless dropped on another. */
  folderId: string | null;
  storage: DropZoneStorage;
  /** A Personal space: uploads are private, like everything there. */
  personal?: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  // The folder the open picker uploads into (the one asked for, or the view's).
  const pickFolder = useRef<string | null>(folderId);
  const [pageDrag, setPageDrag] = useState(false);
  const [uploads, setUploads] = useState<Upload[]>([]);
  // A drag that began on this page (a card being filed in a folder) is never
  // an upload, even when the browser attaches a file to it.
  const fromPage = useRef(false);
  const isUpload = (e: DragEvent) => !fromPage.current && isFileDrag(e);

  const full = storageLevel(storage.usedBytes, storage.limitBytes) === "full";

  const patch = (key: string, change: Partial<Upload>) =>
    setUploads((list) => list.map((u) => (u.key === key ? { ...u, ...change } : u)));

  // The latest props, for the uploader registered once below.
  const latest = useRef({ orgId, folderId, personal, full });
  useEffect(() => {
    latest.current = { orgId, folderId, personal, full };
  });

  async function uploadAll(files: File[], into: string | null) {
    if (files.length === 0) return;
    const batch = files.map((file, i) => ({
      file,
      item: {
        key: `${Date.now()}-${i}-${file.name}`,
        name: file.name,
        state: "waiting" as const,
        percent: 0,
      },
    }));
    setUploads((list) => [...batch.map((b) => b.item), ...list.filter((u) => u.state !== "done")]);
    let any = false;
    for (const { file, item } of batch) {
      patch(item.key, { state: "uploading" });
      const result = await uploadNoteFile(latest.current.orgId, file, {
        folderId: into,
        visibility: latest.current.personal ? "PRIVATE" : undefined,
        onProgress: (p) => patch(item.key, { percent: p }),
      });
      if (result.ok) {
        any = true;
        patch(item.key, { state: "done", percent: 100 });
      } else {
        patch(item.key, { state: "failed", error: result.error });
      }
    }
    if (any) router.refresh();
    // Finished lines clear themselves; a failed one stays until dismissed.
    setTimeout(() => setUploads((list) => list.filter((u) => u.state !== "done")), 4_000);
  }

  // Everyone else (New › Upload, folder cards, sidebar folders) uploads through here.
  useEffect(
    () =>
      registerUploader({
        upload: (files, into) => {
          if (latest.current.full) return;
          void uploadAll(files, into === undefined ? latest.current.folderId : into);
        },
        pick: (into) => {
          if (latest.current.full) return;
          pickFolder.current = into === undefined ? latest.current.folderId : into;
          input.current?.click();
        },
      }),
    // uploadAll reads the latest props through `latest`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Files dragged anywhere over the page: the whole page becomes the target.
  useEffect(() => {
    let depth = 0;
    const start = () => {
      fromPage.current = true;
    };
    const end = () => {
      fromPage.current = false;
    };
    const enter = (e: DragEvent) => {
      if (!isUpload(e)) return;
      depth += 1;
      setPageDrag(true);
    };
    const leave = (e: DragEvent) => {
      if (!isUpload(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setPageDrag(false);
    };
    const overPage = (e: DragEvent) => {
      if (isUpload(e)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      depth = 0;
      setPageDrag(false);
      // A folder card or sidebar folder took it already (and said where).
      if (e.defaultPrevented || !isUpload(e)) return;
      e.preventDefault();
      if (latest.current.full) return;
      void uploadAll(Array.from(e.dataTransfer?.files ?? []), latest.current.folderId);
    };
    window.addEventListener("dragstart", start);
    window.addEventListener("dragend", end);
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", overPage);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragstart", start);
      window.removeEventListener("dragend", end);
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", overPage);
      window.removeEventListener("drop", drop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        accept={NOTE_FILE_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          void uploadAll(Array.from(e.target.files ?? []), pickFolder.current);
          e.target.value = "";
        }}
      />

      {full && (
        <p className="bg-tint-accent text-tint-accent-foreground rounded-tile px-4 py-2.5 text-[14px]">
          Storage is full. Empty the trash or change plan to upload more.
        </p>
      )}

      {/* The whole page, while files from the computer are over it. */}
      {pageDrag && !full && (
        <div
          aria-hidden="true"
          className="bg-background/70 pointer-events-none fixed inset-0 z-40 grid place-items-center backdrop-blur-[2px]"
        >
          <span className="bg-card edge shadow-e2 rounded-block animate-in fade-in-0 zoom-in-95 flex flex-col items-center gap-3 px-10 py-8 duration-200 motion-reduce:animate-none">
            <span className="bg-muted grid size-14 place-items-center rounded-full">
              <CloudUpload className="size-6" strokeWidth={1.75} aria-hidden="true" />
            </span>
            <span className="display-title text-[22px]">Drop to upload</span>
            <span className="text-muted-foreground text-[14px]">
              Up to {formatStorage(storage.maxFileBytes)} each. Drop on a folder to file it there.
            </span>
          </span>
        </div>
      )}

      {uploads.length > 0 && (
        <ul
          aria-live="polite"
          aria-label="Uploads"
          className="m-0 flex list-none flex-col gap-1.5 p-0"
        >
          {uploads.map((u) => (
            <li
              key={u.key}
              className="bg-muted/60 rounded-tile flex items-center gap-3 px-4 py-2.5 text-[14px]"
            >
              {u.state === "done" ? (
                <CheckCircle2 className="text-success size-4 flex-none" aria-hidden="true" />
              ) : u.state === "failed" ? (
                <CircleAlert className="text-destructive size-4 flex-none" aria-hidden="true" />
              ) : (
                <Loader2 className="size-4 flex-none animate-spin" aria-hidden="true" />
              )}
              <span className="min-w-0 flex-1 font-medium break-words">{u.name}</span>
              <span
                className={cn(
                  "flex-none text-[13px]",
                  u.state === "failed" ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {u.state === "failed"
                  ? u.error
                  : u.state === "done"
                    ? "Uploaded"
                    : u.state === "waiting"
                      ? "Waiting"
                      : u.percent > 0
                        ? `${u.percent}%`
                        : "Uploading"}
              </span>
              {u.state === "failed" && (
                <button
                  type="button"
                  aria-label={`Dismiss ${u.name}`}
                  onClick={() => setUploads((list) => list.filter((x) => x.key !== u.key))}
                  className="text-muted-foreground hover:text-foreground hover:bg-muted grid size-7 flex-none place-items-center rounded-full"
                >
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
