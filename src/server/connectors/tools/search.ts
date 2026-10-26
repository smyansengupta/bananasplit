import "server-only";

import { z } from "zod";

import { appUrl } from "@/lib/app-url";
import { NotFoundError } from "@/lib/auth/errors";
import type { PlanFeature } from "@/lib/billing/features";
import { MAX_QUERY_LENGTH, parseQuery } from "@/lib/search/text";
import type { SearchKind, ServerGroupId } from "@/lib/search/types";
import { AppError } from "@/server/db/errors";
import { loadSearchViewer } from "@/server/search/viewer";
import { searchWorkspace } from "@/server/search/workspace";

import { itemId, type ItemKind } from "./ids";
import { listConnectorSpaces } from "./list-spaces";
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  READ_ONLY,
  readResult,
  spaceRef,
  urlField,
  type ConnectorSession,
  type ToolRegistrar,
} from "./shared";
import { inSpace } from "./space";

/**
 * search (docs/features/ai-connectors.md), named and shaped as ChatGPT's
 * search/fetch contract expects: the ⌘K palette's workspace search
 * (src/server/search/workspace.ts) over every space the grant allows,
 * each in its own transaction as the member, merged by score. Every hit
 * is something fetch opens.
 *
 * Left out: finance (the ledger is not exposed), files and folders (fetch
 * can't read an upload), tags and org-chart roles (not items of their
 * own). A space whose plan lacks a kind's feature doesn't search it, and
 * searchWorkspace leaves out sections the club hid from members. A space
 * with AI apps switched off, or that refuses for any other reason, is
 * skipped rather than failing the whole search.
 */

/** The palette's groups this searches, and the plan feature each needs. */
const GROUPS: Partial<Record<ServerGroupId, PlanFeature>> = {
  notes: "files",
  tasks: "tasks",
  projects: "tasks",
  events: "rsvp",
  polls: "polls",
  people: "people",
  databases: "databases",
};

/** What fetch opens each kind of hit as (an epic is a task; a tag isn't an item). */
const KINDS: Partial<Record<SearchKind, ItemKind>> = {
  note: "note",
  task: "task",
  epic: "task",
  event: "event",
  poll: "poll",
  person: "person",
  database: "database",
};

const result = z.object({
  id: z.string().describe("The item's id, for fetch."),
  title: z.string(),
  url: urlField,
  kind: z.enum(["note", "task", "event", "poll", "person", "database"]),
  space: spaceRef,
  detail: z.string().nullable().describe("Where the words matched, or where it lives."),
});

const output = z.object({ results: z.array(result) });

const input = z.object({
  query: z
    .string()
    .min(1)
    .max(MAX_QUERY_LENGTH)
    .describe("Words to look for; each must appear, and a word still being typed matches."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LIMIT)
    .default(DEFAULT_LIMIT)
    .describe(`How many results: ${DEFAULT_LIMIT} unless given, at most ${MAX_LIMIT}.`),
});

type Result = z.infer<typeof result>;

export async function search(
  session: ConnectorSession,
  raw: z.input<typeof input>,
): Promise<z.infer<typeof output>> {
  const args = input.parse(raw);
  // No words (only punctuation): the palette would list recent pages instead.
  if (parseQuery(args.query).terms.length === 0) return { results: [] };

  const spaces = (await listConnectorSpaces(session.connector, session.grant)).filter(
    (s) => s.connectorsOn,
  );
  const found: (Result & { score: number })[] = [];
  // One space at a time, each its own transaction.
  for (const s of spaces) {
    try {
      const hits = await inSpace(session, s.id, {}, async (ctx, space) => {
        const viewer = await loadSearchViewer(ctx.db, ctx);
        if (!viewer) return [];
        const groups = (Object.keys(GROUPS) as ServerGroupId[]).filter((g) =>
          space.includes(GROUPS[g]!),
        );
        const response = await searchWorkspace(ctx.db, viewer, {
          query: args.query,
          scope: "all",
          groups,
          limit: Math.min(args.limit, 20),
        });
        return response.groups.flatMap((g) =>
          g.hits.flatMap((hit) => {
            const kind = KINDS[hit.kind];
            if (!kind) return [];
            return [
              {
                id: itemId(kind, space.id, hit.key.slice(hit.kind.length + 1)),
                title: hit.title,
                url: appUrl(hit.href),
                kind: kind as Result["kind"],
                space: { id: space.id, name: space.name },
                detail: hit.detail ?? null,
                score: hit.score,
              },
            ];
          }),
        );
      });
      found.push(...hits);
    } catch (error) {
      if (error instanceof NotFoundError || (error instanceof AppError && error.status < 500)) {
        continue;
      }
      throw error;
    }
  }
  // Best first; ties keep the order the spaces came in (Personal, then clubs by name).
  const ranked = found
    .map((r, i) => ({ r, i }))
    .sort((a, b) => b.r.score - a.r.score || a.i - b.i)
    .slice(0, args.limit)
    .map(({ r: { score: _score, ...r } }) => r);
  return { results: ranked };
}

export const registerSearch: ToolRegistrar = (server, session) => {
  server.registerTool(
    "search",
    {
      title: "Search",
      description:
        "Searches the member's Personal space and clubs for notes, tasks, events, polls, members and databases matching the words, best matches first. Each result has an id that fetch opens.",
      inputSchema: input,
      outputSchema: output,
      annotations: READ_ONLY,
    },
    (args) => readResult("search", () => search(session, args)),
  );
};
