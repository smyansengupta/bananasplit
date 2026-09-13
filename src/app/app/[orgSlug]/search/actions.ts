"use server";

import { withOrgContext } from "@/lib/auth/with-org-context";

import { searchNotes, searchTasks } from "../notes/queries";

export const searchWorkspace = withOrgContext(async (ctx, query: string) => {
  const [notes, tasks] = await Promise.all([
    searchNotes(ctx.organizationId, ctx.user.id, query),
    searchTasks(ctx.organizationId, query),
  ]);
  return { notes, tasks };
});
