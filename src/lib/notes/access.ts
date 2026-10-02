// The enums entry, not the client: this module stays free of server code.
import { NoteVisibility } from "@/generated/prisma/enums";
import { can, type RoleHolder } from "@/lib/auth/permissions";

/**
 * Who may see and edit a note (spec 3.3, policy 6.8). The note actions, the
 * note page, the collaboration token and the collaboration bridge all ask
 * here; RLS on "Note" enforces the same two rules in the database.
 */

/** Private notes are invisible to everyone but their author, regardless of role. */
export function isNoteVisibleTo(
  userId: string,
  note: { visibility: NoteVisibility; authorId: string },
): boolean {
  return note.visibility === NoteVisibility.ORGANIZATION || note.authorId === userId;
}

/** Anyone can edit their own note; OWNER/ADMIN can edit any note they can see. */
export function canEditNote(
  actor: RoleHolder & { userId: string },
  note: { authorId: string },
): boolean {
  return note.authorId === actor.userId || can(actor, "notes.manageAll");
}
