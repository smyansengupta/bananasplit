// @vitest-environment node
import { createMcpHandler } from "@modelcontextprotocol/server";
import { describe, expect, it, vi } from "vitest";

import type { ResolvedGrant } from "./grant";
import { buildConnectorServer } from "./server";
import type { VerifiedConnector } from "./token";

/**
 * The tool list both directories review (docs/features/ai-connectors.md,
 * "Launch"): the Claude Connectors Directory flags a tool without a title or
 * a read-only or destructive hint, and ChatGPT's review asks for every hint
 * explicit. This reads tools/list as a client does, so a tool added without
 * them fails here rather than in a directory's review.
 */

interface ListedTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema: { properties?: Record<string, { description?: string }> };
  annotations?: Record<string, unknown>;
}

// Listing tools opens no transaction; this keeps Auth.js and Postgres out of the import graph.
vi.mock("@/server/db/context", () => ({}));

const HINTS = ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"] as const;

/**
 * Behavioral directives in a description, which both directories reject:
 * descriptions say what a tool does, never how the model should behave.
 */
const DIRECTIVE =
  /\b(you (must|should)|always|ignore|important|instead of (calling|using)|before (calling|using) any)\b/i;

async function listTools(access: ResolvedGrant["access"]): Promise<ListedTool[]> {
  const grant: ResolvedGrant = { id: "grant_1", access, organizationId: null, clientName: null };
  // Registration never reads the connector: tools only use it when called.
  const session = { connector: {} as VerifiedConnector, grant };
  const handler = createMcpHandler(() => buildConnectorServer(session), {
    responseMode: "json",
    maxSubscriptions: 0,
  });
  const response = await handler.fetch(
    new Request("http://localhost:3000/api/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2025-11-25",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    }),
  );
  // A JSON body, or a single-event SSE body.
  const raw = await response.text();
  const json = (response.headers.get("content-type") ?? "").includes("text/event-stream")
    ? (raw
        .split("\n")
        .find((line) => line.startsWith("data:"))
        ?.slice("data:".length) ?? "{}")
    : raw;
  const body = JSON.parse(json) as { result?: { tools: ListedTool[] } };
  if (!body.result) throw new Error(`tools/list failed: ${JSON.stringify(body)}`);
  return body.result.tools;
}

describe("every connector tool, as the directories review it", () => {
  it("has a title, a description and all four hints explicit", async () => {
    const tools = await listTools("WRITE");
    expect(tools.length).toBe(37);
    for (const tool of tools) {
      expect(tool.name, tool.name).toMatch(/^[a-z][a-z_]{1,63}$/);
      expect(tool.title?.trim(), tool.name).toBeTruthy();
      expect(tool.description?.trim(), tool.name).toBeTruthy();
      for (const hint of HINTS) {
        expect(typeof tool.annotations?.[hint], `${tool.name} ${hint}`).toBe("boolean");
      }
      // Nothing reaches outside Bananasplit (docs/features/ai-connectors.md, "Not exposed").
      expect(tool.annotations?.openWorldHint, tool.name).toBe(false);
    }
  });

  it("describes every argument, and says what it does without directing the model", async () => {
    const undescribed: string[] = [];
    for (const tool of await listTools("WRITE")) {
      expect(tool.description!.length, tool.name).toBeLessThanOrEqual(400);
      expect(tool.description, tool.name).not.toMatch(DIRECTIVE);
      for (const [arg, schema] of Object.entries(tool.inputSchema.properties ?? {})) {
        if (!schema.description?.trim()) undescribed.push(`${tool.name}.${arg}`);
      }
    }
    expect(undescribed).toEqual([]);
  });

  it("gives a READ grant only read-only tools, and marks every one of them so", async () => {
    const read = await listTools("READ");
    const write = await listTools("WRITE");
    expect(read.length).toBe(20);
    for (const tool of read) {
      expect(tool.annotations, tool.name).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
      });
    }
    const readNames = new Set(read.map((t) => t.name));
    for (const tool of write.filter((t) => !readNames.has(t.name))) {
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(false);
    }
  });
});
