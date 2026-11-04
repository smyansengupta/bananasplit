"use server";

import { z } from "zod";

import { MAX_QUERY_LENGTH } from "@/lib/search/text";
import { isSearchScope, type SearchResponse, type SearchScope } from "@/lib/search/types";
import { withOrgAction } from "@/server/db/context";
import { loadSearchViewer } from "@/server/search/viewer";
import { searchWorkspace } from "@/server/search/workspace";

/**
 * The ⌘K palette's workspace search (src/server/search/workspace.ts):
 * everything the member may open in this org, matching `query`, optionally
 * narrowed to one kind. Read-only; one transaction as app_user, so RLS
 * bounds every query to the org and to what this member can see.
 */

const inputSchema = z.object({
  query: z
    .string()
    .catch("")
    .transform((s) => s.slice(0, MAX_QUERY_LENGTH)),
  scope: z.unknown().transform((s): SearchScope => (isSearchScope(s) ? s : "all")),
});

export const searchWorkspaceAction = withOrgAction(
  async (ctx, input: { query: string; scope?: SearchScope }): Promise<SearchResponse> => {
    const { query, scope } = inputSchema.parse(input ?? {});
    const viewer = await loadSearchViewer(ctx.db, ctx);
    if (!viewer) return { query, scope, groups: [] };
    return searchWorkspace(ctx.db, viewer, { query, scope });
  },
);
