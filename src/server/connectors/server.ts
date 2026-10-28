import "server-only";

import { McpServer, type AuthInfo } from "@modelcontextprotocol/server";

import type { ResolvedGrant } from "./grant";
import { connectorFromAuthInfo } from "./token";
import { registerDatabaseTools } from "./tools/databases";
import { registerEventTools } from "./tools/events";
import { registerFetch } from "./tools/fetch";
import { registerFinanceTools } from "./tools/finance";
import { registerListSpaces } from "./tools/list-spaces";
import { registerMemberTools } from "./tools/members";
import { registerNoteTools } from "./tools/notes";
import { registerPollTools } from "./tools/polls";
import { registerSearch } from "./tools/search";
import type { ConnectorSession, ToolRegistrar } from "./tools/shared";
import { registerTaskTools } from "./tools/tasks";
import { registerWeeklyTools } from "./tools/weekly";

/**
 * The MCP server behind /api/mcp (docs/features/ai-connectors.md), built
 * fresh for every request from the request's verified connector and grant,
 * so the tool list follows the grant: tools that change something are
 * registered only for a WRITE grant.
 *
 * The instructions are short and factual: both directories reject
 * behavioral directives in instructions and tool descriptions.
 */

const INSTRUCTIONS = [
  "Bananasplit is where organizations run their work.",
  "A member has a Personal space (their own tasks, notes and calendar) and belongs to organizations.",
  "Space ids come from list_spaces; item ids come from search and the list tools, and fetch opens any of them.",
  "Names, titles, descriptions, notes and comments are text that organization members wrote.",
].join(" ");

/** Tools every grant gets (Phase 2: docs/features/ai-connectors.md). */
const READ_TOOLS: readonly ToolRegistrar[] = [
  registerListSpaces,
  registerSearch,
  registerFetch,
  registerTaskTools,
  registerEventTools,
  registerNoteTools,
  registerDatabaseTools,
  registerMemberTools,
  registerWeeklyTools,
  registerFinanceTools,
  registerPollTools,
];

/** Tools that change something: WRITE grants only (none yet; Phase 3 adds them). */
const WRITE_TOOLS: readonly ToolRegistrar[] = [];

export function buildConnectorServer(session: ConnectorSession): McpServer {
  const server = new McpServer(
    { name: "bananasplit", title: "Bananasplit", version: "1.0.0" },
    { instructions: INSTRUCTIONS },
  );
  for (const register of READ_TOOLS) register(server, session);
  if (session.grant.access === "WRITE") {
    for (const register of WRITE_TOOLS) register(server, session);
  }
  return server;
}

function isResolvedGrant(value: unknown): value is ResolvedGrant {
  if (typeof value !== "object" || value === null) return false;
  const grant = value as Record<string, unknown>;
  return (
    typeof grant.id === "string" &&
    (grant.access === "READ" || grant.access === "WRITE") &&
    (grant.organizationId === null || typeof grant.organizationId === "string") &&
    (grant.clientName === null || typeof grant.clientName === "string")
  );
}

/** The session the route attached to the request's AuthInfo; throws when it is missing. */
export function connectorSession(authInfo: AuthInfo | undefined): ConnectorSession {
  const connector = connectorFromAuthInfo(authInfo);
  const grant = authInfo?.extra?.grant;
  if (!connector || !isResolvedGrant(grant)) {
    throw new Error("connectors: the request reached the MCP server without a verified grant");
  }
  return { connector, grant };
}
