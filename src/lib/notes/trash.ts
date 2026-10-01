/**
 * Deleted notes and Notes files wait this long in "Recently deleted"
 * (restorable) before the maintenance job removes a file's bytes. Deleted
 * notes keep their row, so this is also how far back the list looks.
 */
export const NOTE_TRASH_DAYS = 30;

/** The oldest deletion time still listed under "Recently deleted". */
export function trashCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - NOTE_TRASH_DAYS * 24 * 60 * 60 * 1000);
}
