import type { CollabConfig } from "@/lib/collab/config";
import { noteDocumentName, presenceSlot, type CollabUser } from "@/lib/collab/protocol";
import { signCollabToken } from "@/lib/collab/token";
import { canEditNote } from "@/lib/notes/access";
import type { MemberContext } from "@/server/db/context";

/** What the note editor needs to join a note's live document. */
export interface NoteCollabSession {
  /** The collaboration server's WebSocket URL. */
  url: string;
  documentName: string;
  token: string;
  /** ms since the epoch. */
  expiresAt: number;
  /** Whether the token lets this user edit (the author or an OWNER/ADMIN). */
  canWrite: boolean;
  /** How other editors see this user. */
  user: CollabUser;
}

/**
 * Mints a collaboration token for a note the caller has ALREADY read back
 * through RLS in `ctx` (the note page, issueNoteCollabToken): the token is
 * the database's answer, signed. Write permission is canEditNote's.
 */
export function mintNoteCollabSession(
  config: CollabConfig,
  ctx: Pick<MemberContext, "userId" | "organizationId" | "role"> & {
    user: { name: string | null };
  },
  note: { id: string; authorId: string },
): NoteCollabSession {
  const canWrite = canEditNote(ctx, note);
  const user: CollabUser = {
    id: ctx.userId,
    name: ctx.user.name?.trim().slice(0, 200) || "Member",
    slot: presenceSlot(ctx.userId),
  };
  const documentName = noteDocumentName(ctx.organizationId, note.id);
  const { token, expiresAt } = signCollabToken(
    {
      sub: user.id,
      org: ctx.organizationId,
      doc: documentName,
      perm: canWrite ? "write" : "read",
      name: user.name,
      slot: user.slot,
    },
    config.secret,
  );
  return { url: config.url, documentName, token, expiresAt, canWrite, user };
}
