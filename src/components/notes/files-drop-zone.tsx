"use client";

import { CheckCircle2, CircleAlert, CloudUpload, Loader2 } from "@/components/icons";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { NOTE_FILE_ACCEPT } from "@/lib/files/types";
import { formatStorage, storageLevel } from "@/lib/billing/storage";
import { uploadNoteFile } from "@/lib/files/upload";
import { cn } from "@/lib/utils";

/**
 * The Files page's drop zone (redesign guide 11.2, "Drop files to
 * upload"): a big target at the top of the library, and the whole page
 * while files are dragged over it. Any number of files at once, one after
 * another, each with its own line. The space's storage sits in the page
 * header beside New note (StorageChip); here, only the largest file the
 * plan takes, and a full space turns the zone off. Uploads are shared with
 * the club, or in Personal private to its owner.
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

const hasFiles = (e: DragEvent | React.DragEvent) =>
  Array.from(e.dataTransfer?.types ?? []).includes("Files");

export function FilesDropZone({
  orgId,
  folderId,
  storage,
  personal = false,
}: {
  orgId: string;
  /** Uploads land in the folder being viewed. */
  folderId: string | null;
  storage: DropZoneStorage;
  /** A Personal space: uploads are private, like everything there. */
  personal?: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [pageDrag, setPageDrag] = useState(false);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const busy = uploads.some((u) => u.state === "waiting" || u.state === "uploading");
  // A drag that began on this page (a card being filed in a folder) is never
  // an upload, even when the browser attaches a file to it.
  const fromPage = useRef(false);
  const isUpload = (e: DragEvent | React.DragEvent) => !fromPage.current && hasFiles(e);

  const level = storageLevel(storage.usedBytes, storage.limitBytes);
  const full = level === "full";

  const patch = (key: string, change: Partial<Upload>) =>
    setUploads((list) => list.map((u) => (u.key === key ? { ...u, ...change } : u)));

  async function uploadAll(files: File[]) {
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
      const result = await uploadNoteFile(orgId, file, {
        folderId,
        visibility: personal ? "PRIVATE" : undefined,
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
  }

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
      if (!isUpload(e)) return;
      e.preventDefault();
      depth = 0;
      setPageDrag(false);
      setOver(false);
      void uploadAll(Array.from(e.dataTransfer?.files ?? []));
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
    // uploadAll reads the latest props through its closure on each drop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, folderId]);

  return (
    <section aria-label="Upload files" className="space-y-3">
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragEnter={(e) => {
          if (isUpload(e)) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        disabled={full}
        className={cn(
          "group rounded-block focus-glow flex min-h-44 w-full cursor-pointer flex-col items-center justify-center gap-3 border-2 border-dashed px-6 py-8 text-center transition-[background-color,border-color,transform] duration-200 ease-(--ease-ink) disabled:cursor-not-allowed disabled:opacity-60",
          over || pageDrag
            ? "border-foreground/40 bg-muted scale-[1.01]"
            : "border-border hover:border-foreground/25 hover:bg-muted/50",
        )}
      >
        <span
          className={cn(
            "bg-muted grid size-14 place-items-center rounded-full transition-transform duration-300 ease-(--ease-spring)",
            (over || pageDrag) && "-translate-y-1 scale-110",
          )}
        >
          {busy ? (
            <Loader2 className="size-6 animate-spin" aria-hidden="true" />
          ) : (
            <CloudUpload className="size-6" strokeWidth={1.75} aria-hidden="true" />
          )}
        </span>
        <span className="display-title text-[22px]">
          {full
            ? "Storage is full"
            : over || pageDrag
              ? "Drop to upload"
              : "Drop files here to upload"}
        </span>
        <span className="text-muted-foreground text-[14px]">
          {full ? (
            "Uploads have stopped. Empty the trash or change plan for more room."
          ) : (
            <>
              Or{" "}
              <span className="text-foreground font-semibold underline underline-offset-4">
                browse
              </span>{" "}
              for files. PDFs, slides, documents, spreadsheets and images, up to{" "}
              {formatStorage(storage.maxFileBytes)} each.
            </>
          )}
        </span>
      </button>
      <input
        ref={input}
        type="file"
        multiple
        accept={NOTE_FILE_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          void uploadAll(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />

      {uploads.length > 0 && (
        <ul aria-live="polite" className="m-0 flex list-none flex-col gap-1.5 p-0">
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
              <span className="min-w-0 flex-1 truncate font-medium">{u.name}</span>
              <span className="text-muted-foreground flex-none text-[13px]">
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
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
