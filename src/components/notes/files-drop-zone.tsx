"use client";

import { CheckCircle2, CircleAlert, CloudUpload, Loader2, X } from "@/components/icons";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { NOTE_FILE_ACCEPT } from "@/lib/files/types";
import { formatStorage, storageLevel } from "@/lib/billing/storage";
import { uploadNoteFile } from "@/lib/files/upload";
import { PageDropFrame } from "@/components/ui/page-drop-frame";
import { toast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";

import { isFileDrag, registerUploader } from "./upload-queue";

/**
 * The Files page's uploader. There is no drop box taking up the top of the
 * page any more: the whole page is the target. Drag files anywhere and a
 * frame around the page (beside the sidebar, never under it) says "Drop to
 * upload"; drop them on a folder card or a folder in the
 * sidebar and they go into that folder (upload-queue.ts). New › Upload
 * opens the picker for several files at once. Each file gets a line with
 * its progress, and you never leave the page.
 *
 * Uploads are shared with the organization, or in Personal private to its owner;
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
          if (latest.current.full) {
            toast({ title: "Storage is full", tone: "error" });
            return;
          }
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
  // The frame shows while dragover keeps arriving (every few hundred ms at
  // most, even with the pointer still) and goes a moment after it stops, so
  // it can't get stuck on: counting dragenter against dragleave did, whenever
  // the element under the pointer was redrawn mid-drag and its leave never came.
  useEffect(() => {
    let hide: ReturnType<typeof setTimeout> | undefined;
    const off = () => {
      clearTimeout(hide);
      setPageDrag(false);
    };
    const start = () => {
      fromPage.current = true;
    };
    const end = () => {
      fromPage.current = false;
      off();
    };
    const over = (e: DragEvent) => {
      if (isUpload(e)) {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = latest.current.full ? "none" : "copy";
        setPageDrag(true);
        clearTimeout(hide);
        hide = setTimeout(off, 400);
        return;
      }
      // A card from this page let go anywhere but a folder or Pinned does
      // nothing: without this the browser drops its address into the search
      // box or opens it.
      if (fromPage.current && !e.defaultPrevented) {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "none";
      }
    };
    const leave = (e: DragEvent) => {
      // Out of the window: hide at once rather than after the pause.
      if (
        isUpload(e) &&
        (e.clientX <= 0 ||
          e.clientY <= 0 ||
          e.clientX >= window.innerWidth ||
          e.clientY >= window.innerHeight)
      ) {
        off();
      }
    };
    const drop = (e: DragEvent) => {
      off();
      // A folder card or sidebar folder took it already (and said where).
      if (e.defaultPrevented || !isUpload(e)) return;
      e.preventDefault();
      if (latest.current.full) return;
      void uploadAll(Array.from(e.dataTransfer?.files ?? []), latest.current.folderId);
    };
    window.addEventListener("dragstart", start);
    window.addEventListener("dragend", end);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      clearTimeout(hide);
      window.removeEventListener("dragstart", start);
      window.removeEventListener("dragend", end);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
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

      {/* The page, while files from the computer are over it. */}
      {pageDrag && (
        <PageDropFrame>
          <span className="bg-muted grid size-8 shrink-0 place-items-center rounded-full">
            <CloudUpload className="size-4" aria-hidden="true" />
          </span>
          {full ? (
            "Storage is full"
          ) : (
            <span>
              Drop to upload, or onto a folder{" "}
              <span className="text-muted-foreground font-normal">
                up to {formatStorage(storage.maxFileBytes)} each
              </span>
            </span>
          )}
        </PageDropFrame>
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
