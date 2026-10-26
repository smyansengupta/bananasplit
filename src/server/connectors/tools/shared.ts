import "server-only";

import type { CallToolResult, McpServer, ToolAnnotations } from "@modelcontextprotocol/server";

import type { ResolvedGrant } from "../grant";
import type { VerifiedConnector } from "../token";

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
