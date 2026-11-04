"use server";

import { requireUser } from "@/lib/auth/session";
import { movePersonalItems } from "@/server/personal/move";

/** What a Personal item's "Move to <organization>" can carry. */
export type MovableKind = "task" | "note" | "file";

const SELECTION_KEY = { task: "taskIds", note: "noteIds", file: "fileIds" } as const;

/**
 * "Move to <organization>" from a Personal item's menu: one item, the same
 * move as the "Bring anything in?" list (movePersonalItems), so the database
 * checks the Personal space is the caller's and that they own or run the
 * organization. The menu waits a few seconds with Undo before calling this.
 */
export async function moveToOrganizationAction(
  toOrgId: string,
  kind: MovableKind,
  itemId: string,
): Promise<{ error?: string }> {
  const user = await requireUser();
  if (typeof toOrgId !== "string" || toOrgId.length > 100 || !(kind in SELECTION_KEY)) {
    return { error: "That move isn't possible." };
  }
  const result = await movePersonalItems(user.id, toOrgId, {
    [SELECTION_KEY[kind]]: [itemId],
  });
  return result.ok ? {} : { error: result.error };
}
