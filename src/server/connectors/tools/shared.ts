import "server-only";

import type { CallToolResult, McpServer, ToolAnnotations } from "@modelcontextprotocol/server";
import { z } from "zod";

import { AppError } from "@/server/db/errors";

import { toolError } from "../errors";
import type { ResolvedGrant } from "../grant";
import type { VerifiedConnector } from "../token";
import { itemId } from "./ids";

/** Who a tool acts for: the verified member and the grant this request resolved. */
export interface ConnectorSession {
  connector: VerifiedConnector;
  grant: ResolvedGrant;
}

/** Adds one tool to a request's server (src/server/connectors/server.ts). */
export type ToolRegistrar = (server: McpServer, session: ConnectorSession) => void;

/** Every read tool's annotations: all four hints explicit (both directories ask for them). */
export const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

/** A tool's result: structuredContent, plus the same JSON as text for clients without it. */
export function jsonResult<T extends Record<string, unknown>>(output: T): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
    structuredContent: output,
  };
}

/**
 * A read tool's handler body: the output as jsonResult, any failure as an
 * isError result (src/server/connectors/errors.ts). The SDK has already
 * checked the arguments against the tool's inputSchema, and checks the
 * output against its outputSchema after.
 */
export async function readResult<T extends Record<string, unknown>>(
  tool: string,
  run: () => Promise<T>,
): Promise<CallToolResult> {
  try {
    return jsonResult(await run());
  } catch (error) {
    return toolError(error, { tool });
  }
}

/** Arguments the schema accepts but the tool can't use; the message never repeats them. */
export class ConnectorInputError extends AppError {
  constructor(message: string) {
    super(message, 400, "CONNECTOR_INPUT");
    this.name = "ConnectorInputError";
  }
}

// ---------------------------------------------------------------- arguments

/** List tools return 20 by default, at most 50. */
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 50;

const ID_SHAPE = /^[A-Za-z0-9_-]{1,128}$/;
const ITEM_ID_SHAPE = /^[a-z]+:[A-Za-z0-9_-]{1,128}:[A-Za-z0-9_-]{1,128}$/;

export const spaceArg = z
  .string()
  .regex(ID_SHAPE, "Use a space id from list_spaces")
  .describe("The space: an id from list_spaces.");

export function itemArg(what: string) {
  return z
    .string()
    .max(300)
    .regex(ITEM_ID_SHAPE, "Use an id that search or a list tool returned")
    .describe(`The ${what}'s id, as search or a list tool returned it.`);
}

export const limitArg = z
  .number()
  .int()
  .min(1)
  .max(MAX_LIMIT)
  .default(DEFAULT_LIMIT)
  .describe(`How many to return: ${DEFAULT_LIMIT} unless given, at most ${MAX_LIMIT}.`);

export const cursorArg = z
  .string()
  .max(512)
  .optional()
  .describe("nextCursor from the previous call with the same arguments, for the next page.");

export const dayArg = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Write dates as yyyy-mm-dd");

// ---------------------------------------------------------------- outputs

export const spaceRef = z
  .object({
    id: z.string().describe("The space's id (list_spaces)."),
    name: z.string().describe('The organization\'s name, or "Personal".'),
  })
  .describe("The space it's in.");

export const personRef = z.object({
  id: z.string().describe("The member's id, for list_tasks' assignee and fetch."),
  name: z.string().describe("Their name as the organization shows it."),
});

export const nextCursor = z
  .string()
  .nullable()
  .describe("Pass as cursor, with the same arguments, for the next page; null at the end.");

export const urlField = z.string().describe("Where it opens in Bananasplit.");

export type PersonRef = z.infer<typeof personRef>;

/** What fetch returns for any item (ChatGPT's fetch shape): the item as readable text. */
export interface FetchedItem {
  [key: string]: unknown;
  id: string;
  title: string;
  /** The item as Markdown; text members wrote is in here as written. */
  text: string;
  url: string;
  metadata: Record<string, string | number | boolean | null>;
}

/** A member as the tools name them: never an email, "Member" when they have no name. */
export function personOf(
  spaceId: string,
  user: { id: string; name: string | null } | null | undefined,
): PersonRef | null {
  if (!user) return null;
  return { id: itemId("person", spaceId, user.id), name: user.name?.trim() || "Member" };
}
