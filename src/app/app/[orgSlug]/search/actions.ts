"use server";

import { z } from "zod";

import { resolveSidebar } from "@/lib/nav/sidebar";
import { MAX_QUERY_LENGTH } from "@/lib/search/text";
import { isSearchScope, type SearchResponse, type SearchScope } from "@/lib/search/types";
import { isValidTimeZone } from "@/lib/timezones";
import { withOrgAction } from "@/server/db/context";
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
    const org = await ctx.db.organization.findUnique({
      where: { id: ctx.organizationId },
      select: {
        slug: true,
        timezone: true,
        activeOrgChartVersionId: true,
        settings: { select: { sidebar: true } },
      },
    });
    if (!org) return { query, scope, groups: [] };
    const user = await ctx.db.user.findUnique({
      where: { id: ctx.userId },
      select: { timezone: true },
    });
    const orgZone = isValidTimeZone(org.timezone) ? org.timezone : "UTC";
    const viewerZone = user?.timezone && isValidTimeZone(user.timezone) ? user.timezone : orgZone;
    const hiddenSections = new Set(
      resolveSidebar(org.settings?.sidebar)
        .flatMap((g) => g.items)
        .filter((i) => i.hidden)
        .map((i) => i.id),
    );

    return searchWorkspace(
      ctx.db,
      {
        orgId: ctx.organizationId,
        orgSlug: org.slug,
        userId: ctx.userId,
        role: ctx.role,
        zones: { viewer: viewerZone, org: orgZone },
        hiddenSections,
        orgChartVersionId: org.activeOrgChartVersionId,
      },
      { query, scope },
    );
  },
);
