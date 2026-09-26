/**
 * What the app, the browser and the collaboration server agree on
 * (docs/features/collaboration.md). No Node or server imports: the editor
 * imports this too.
 */

/** The Yjs XmlFragment a note body lives in (the Collaboration extension's default). */
export const NOTE_FIELD = "default";

/** A Yjs document per note, named after its org so the bridge can open the right RLS context. */
export interface NoteDocument {
  kind: "note";
  organizationId: string;
  noteId: string;
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;

export function noteDocumentName(organizationId: string, noteId: string): string {
  return `note:${organizationId}:${noteId}`;
}

/** The note a document name refers to, or null for anything else. */
export function parseDocumentName(name: string): NoteDocument | null {
  const parts = name.split(":");
  if (parts.length !== 3 || parts[0] !== "note") return null;
  const [, organizationId, noteId] = parts;
  if (!ID.test(organizationId) || !ID.test(noteId)) return null;
  return { kind: "note", organizationId, noteId };
}

/**
 * Who a connection is, as other editors see it (awareness `user`). The
 * collaboration server writes it from the verified token on every awareness
 * update, so a client cannot show itself as someone else.
 */
export interface CollabUser {
  id: string;
  name: string;
  /** Presence colour: --chart-{slot}, 1 to 5 (theme tokens, never raw colours). */
  slot: number;
}

export const PRESENCE_SLOTS = 5;

/** A stable colour per user, so someone keeps their colour across notes and sessions. */
export function presenceSlot(userId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < userId.length; i++) {
    hash ^= userId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return ((hash >>> 0) % PRESENCE_SLOTS) + 1;
}

/**
 * Stateless message the collaboration server broadcasts after the bridge
 * saved the document into the Note row, so every editor can show "Saved".
 */
export const STORED_MESSAGE = "stored";
