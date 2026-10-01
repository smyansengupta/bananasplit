"use client";

/**
 * A copy of the note being saved, kept in this browser until the server has
 * it. If a save never lands (offline, the tab closed mid-save, a server
 * error), reopening the note offers it back. Per browser and per note;
 * cleared on every successful save. Storage can be missing or full
 * (private windows, quotas): every call is best-effort.
 */

export interface NoteBackup {
  title: string;
  /** JSON.stringify'd ProseMirror doc. */
  contentJson: string;
  contentText: string;
  /** The note version the edit was made on. */
  baseVersion: number;
  savedAt: number;
}

const key = (noteId: string) => `bananasplit:note-backup:${noteId}`;

export function writeNoteBackup(noteId: string, backup: NoteBackup): void {
  try {
    window.localStorage.setItem(key(noteId), JSON.stringify(backup));
  } catch {
    // Full or blocked storage: the server save is still the real one.
  }
}

export function clearNoteBackup(noteId: string): void {
  try {
    window.localStorage.removeItem(key(noteId));
  } catch {
    // Nothing to clear.
  }
}

/** The raw stored string (stable for useSyncExternalStore), or null. */
export function readNoteBackupRaw(noteId: string): string | null {
  try {
    return window.localStorage.getItem(key(noteId));
  } catch {
    return null;
  }
}

export function parseNoteBackup(raw: string | null): NoteBackup | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<NoteBackup>;
    if (
      typeof value.title !== "string" ||
      typeof value.contentJson !== "string" ||
      typeof value.contentText !== "string" ||
      typeof value.baseVersion !== "number" ||
      typeof value.savedAt !== "number"
    ) {
      return null;
    }
    return value as NoteBackup;
  } catch {
    return null;
  }
}
