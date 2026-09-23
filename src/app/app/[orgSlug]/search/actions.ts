"use server";

import { withOrgAction } from "@/server/db/context";

import { searchNotes, searchTasks } from "../notes/queries";

/**
 * The command palette's workspace search: notes (full text, PRIVATE notes
 * only for their author) and tasks by title, in the caller's org. Read-only;
 * one transaction as app_user, so RLS bounds both queries to the org.
 */
export const searchWorkspace = withOrgAction(async (ctx, query: string) => {
  const notes = await searchNotes(ctx.db, ctx.organizationId, ctx.userId, query);
  const tasks = await searchTasks(ctx.db, ctx.organizationId, query);
  return { notes, tasks };
});
