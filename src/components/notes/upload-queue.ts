"use client";

/**
 * Files has ONE way to upload: the page's uploader (FilesDropZone), which
 * shows each file's progress. Everything else hands files to it here, so
 * New › Upload, the phone's Upload button, a drop on the page, a drop on a
 * folder card and a drop on a folder in the sidebar all behave the same:
 * several files at once, no dialog, and you stay where you are.
 *
 *   uploadFiles(files, folderId)   // a drop on a folder
 *   pickFiles(folderId)            // opens the file picker
 */

export interface Uploader {
  /** `folderId` undefined = the folder being viewed; null = no folder. */
  upload: (files: File[], folderId?: string | null) => void;
  pick: (folderId?: string | null) => void;
}

let current: Uploader | null = null;

export function registerUploader(uploader: Uploader) {
  current = uploader;
  return () => {
    if (current === uploader) current = null;
  };
}

export function uploadFiles(files: File[], folderId?: string | null): boolean {
  if (!current || files.length === 0) return false;
  current.upload(files, folderId);
  return true;
}

export function pickFiles(folderId?: string | null): boolean {
  if (!current) return false;
  current.pick(folderId);
  return true;
}

/** Files from the computer are being dragged (not a card from this page). */
export function isFileDrag(e: { dataTransfer: DataTransfer | null }) {
  return Array.from(e.dataTransfer?.types ?? []).includes("Files");
}
