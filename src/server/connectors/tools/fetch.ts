import "server-only";

import { z } from "zod";

import { NotFoundError } from "@/lib/auth/errors";

import { fetchDatabase } from "./databases";
import { fetchEvent } from "./events";
import { fetchExpense } from "./finance";
import { parseItemId, type ItemKind, type ItemRef } from "./ids";
import { fetchPerson } from "./members";
import { fetchNote } from "./notes";
import { fetchPoll } from "./polls";
import {
  READ_ONLY,
  readResult,
  urlField,
  type ConnectorSession,
  type FetchedItem,
  type ToolRegistrar,
} from "./shared";
import { fetchTask } from "./tasks";

/**
 * fetch (docs/features/ai-connectors.md), named and shaped as ChatGPT's
 * search/fetch contract expects: any id search or a list tool returned,
 * as readable text. The id's kind picks the reader; each reads through
 * the same space checks and plan feature as its own tools. A note longer
 * than the text limit comes back cut, with get_note's nextOffset in its
 * metadata.
 */

const FETCHERS: Record<
  ItemKind,
  (session: ConnectorSession, ref: ItemRef) => Promise<FetchedItem>
> = {
  note: fetchNote,
  task: fetchTask,
  event: fetchEvent,
  poll: fetchPoll,
  person: fetchPerson,
  database: fetchDatabase,
  expense: fetchExpense,
};

const input = z.object({
  id: z.string().min(1).max(300).describe("An id that search or a list tool returned."),
});

const output = z.object({
  id: z.string(),
  title: z.string(),
  text: z.string().describe("The item as Markdown."),
  url: urlField,
  metadata: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .describe("What kind of item it is, its space, and a few of its facts."),
});

export async function fetchItem(
  session: ConnectorSession,
  raw: z.input<typeof input>,
): Promise<FetchedItem> {
  const ref = parseItemId(input.parse(raw).id);
  if (!ref) throw new NotFoundError();
  return FETCHERS[ref.kind](session, ref);
}

export const registerFetch: ToolRegistrar = (server, session) => {
  server.registerTool(
    "fetch",
    {
      title: "Fetch",
      description:
        "Opens one item by the id search or a list tool returned (a note, task, event, poll, member, database or expense) and returns it as text with its link.",
      inputSchema: input,
      outputSchema: output,
      annotations: READ_ONLY,
    },
    (args) => readResult("fetch", () => fetchItem(session, args)),
  );
};
