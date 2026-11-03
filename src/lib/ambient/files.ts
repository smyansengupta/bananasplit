/**
 * When the Files and notes ambient buttons show (Buttons3: Files and
 * notes): to-dos in a note, finished meeting notes, a private file others
 * use, and a pinned note someone changed. Pure: no database, no request APIs.
 */

interface DocNode {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown> | null;
  content?: DocNode[];
}

function textOf(node: DocNode): string {
  if (typeof node.text === "string") return node.text;
  // A to-do's own line, not the to-dos nested under it.
  return (node.content ?? [])
    .filter((c) => c.type !== "taskList")
    .map(textOf)
    .join("");
}

/** A note's unchecked to-dos (taskItem nodes), as one line of text each, in order. */
export function uncheckedTodos(doc: unknown): string[] {
  const out: string[] = [];
  const walk = (node: DocNode) => {
    if (node.type === "taskItem" && node.attrs?.checked !== true) {
      const line = textOf(node).replace(/\s+/g, " ").trim();
      if (line) out.push(line.slice(0, 200));
    }
    for (const child of node.content ?? []) walk(child);
  };
  if (doc && typeof doc === "object") walk(doc as DocNode);
  return out;
}

const norm = (s: string) => s.trim().toLowerCase();

/**
 * "Turn 3 to-dos into tasks": the unchecked to-dos that aren't tasks
 * linked to the note yet (by title), each once.
 */
export function todosToTurn(
  todos: readonly string[],
  linkedTaskTitles: readonly string[],
): { todos: string[]; reason: string } | null {
  const taken = new Set(linkedTaskTitles.map(norm));
  const seen = new Set<string>();
  const left = todos.filter((t) => {
    const k = norm(t);
    if (taken.has(k) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (left.length === 0) return null;
  return {
    todos: left,
    reason: left.length === 1 ? "1 unchecked to-do" : `${left.length} unchecked to-dos`,
  };
}

/**
 * "Send the summary": notes for a meeting that's over, with something
 * written, to the people who went who haven't been sent it (shared with).
 * Only whoever may share the note sends it.
 */
export function summaryToSend(input: {
  canShare: boolean;
  meetingEndsAt: Date | null;
  now: Date;
  text: string;
  /** Members who went (said yes or checked in). */
  went: readonly string[];
  /** Members the note is shared with by name already. */
  sharedWith: readonly string[];
  authorId: string;
  viewerId: string;
}): { userIds: string[]; reason: string } | null {
  const { meetingEndsAt, now } = input;
  if (!input.canShare || !meetingEndsAt || meetingEndsAt.getTime() > now.getTime()) return null;
  if (input.text.trim().length < 20) return null;
  const skip = new Set([...input.sharedWith, input.authorId, input.viewerId]);
  const userIds = [...new Set(input.went)].filter((id) => !skip.has(id));
  if (userIds.length === 0) return null;
  return {
    userIds,
    reason:
      userIds.length === 1
        ? "The meeting's over and 1 person who went hasn't been sent these"
        : `The meeting's over and ${userIds.length} people who went haven't been sent these`,
  };
}

/**
 * "Share with everyone": a file only its uploader can open that the
 * organization uses (linked from something, or in a shared folder).
 */
export function fileToShare(input: {
  visibility: string;
  uploadedById: string;
  viewerId: string;
  personal: boolean;
  links: number;
  folderName: string | null;
}): { reason: string } | null {
  if (input.personal || input.visibility !== "PRIVATE" || input.uploadedById !== input.viewerId) {
    return null;
  }
  if (input.links > 0) {
    return {
      reason:
        input.links === 1
          ? "Only you can open it, and it's linked from 1 thing"
          : `Only you can open it, and it's linked from ${input.links} things`,
    };
  }
  if (input.folderName) return { reason: `Only you can open it, and it's in ${input.folderName}` };
  return null;
}

/**
 * "See what changed": a note the viewer pinned that someone else changed
 * after they last looked. Hands back the saved version from before that
 * visit, to compare with the note now.
 */
export function pinnedNoteChanged(input: {
  pinned: boolean;
  lastVisitAt: Date | null;
  updatedAt: Date;
  updatedById: string;
  updatedByName: string | null;
  viewerId: string;
  versions: readonly { id: string; createdAt: Date | string }[];
}): { versionId: string; reason: string } | null {
  const { lastVisitAt } = input;
  if (!input.pinned || !lastVisitAt || input.updatedById === input.viewerId) return null;
  if (input.updatedAt.getTime() <= lastVisitAt.getTime()) return null;
  const before = input.versions
    .map((v) => ({ id: v.id, at: new Date(v.createdAt).getTime() }))
    .filter((v) => v.at <= lastVisitAt.getTime())
    .sort((a, b) => b.at - a.at)[0];
  if (!before) return null;
  const who = input.updatedByName?.trim().split(/\s+/)[0];
  return { versionId: before.id, reason: `${who || "Someone"} changed it since you looked` };
}
