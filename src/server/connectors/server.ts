import "server-only";

import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { withUserTx } from "@/server/db/context";

import { connectorIdentity } from "./token";

/**
 * The MCP server behind /api/mcp. Phase 0 spike: one tool, whoami, which
 * shows what the verified token says and which account and spaces it
 * resolves to under RLS. The real tools come in Phases 1-3
 * (docs/features/ai-connectors.md).
 */

const whoamiOutput = z.object({
  account: z.object({ id: z.string(), name: z.string().nullable(), email: z.string() }).nullable(),
  spaces: z.array(
    z.object({ id: z.string(), name: z.string(), kind: z.string(), role: z.string() }),
  ),
  grant: z.object({
    clientId: z.string(),
    consentId: z.string().nullable(),
    workosUserId: z.string().nullable(),
    space: z.string().nullable(),
    access: z.string().nullable(),
  }),
  token: z.object({
    lifetimeSeconds: z.number().nullable(),
    expiresAt: z.string().nullable(),
    claims: z.record(z.string(), z.unknown()),
  }),
});

export function buildConnectorServer(): McpServer {
  const server = new McpServer(
    { name: "bananasplit", title: "Bananasplit", version: "0.0.0-spike" },
    {
      instructions:
        "Bananasplit holds a member's Personal space and the clubs they belong to. This is a test server with a single tool, whoami.",
    },
  );

  server.registerTool(
    "whoami",
    {
      title: "Who am I",
      description:
        "Shows the Bananasplit account this connection acts as, the spaces that account belongs to, and the claims in its access token.",
      inputSchema: z.object({}),
      outputSchema: whoamiOutput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (_args, ctx) => {
      const identity = connectorIdentity(ctx.http?.authInfo);
      if (!identity) {
        return {
          content: [{ type: "text", text: "This request isn't signed in." }],
          isError: true,
        };
      }
      const { account, spaces } = await withUserTx(identity.userId, async ({ db }) => {
        const user = await db.user.findUnique({
          where: { id: identity.userId },
          select: { id: true, name: true, email: true },
        });
        const memberships = await db.membership.findMany({
          where: { userId: identity.userId },
          select: { role: true, organization: { select: { id: true, name: true, kind: true } } },
          orderBy: { organization: { name: "asc" } },
        });
        return {
          account: user,
          spaces: memberships.map((m) => ({ ...m.organization, role: m.role })),
        };
      });
      const { iat, exp } = identity.claims;
      const output = {
        account,
        spaces,
        grant: {
          clientId: identity.clientId,
          consentId: identity.consentId,
          workosUserId: identity.workosUserId,
          space: identity.space,
          access: identity.access,
        },
        token: {
          lifetimeSeconds: typeof iat === "number" && typeof exp === "number" ? exp - iat : null,
          expiresAt: typeof exp === "number" ? new Date(exp * 1000).toISOString() : null,
          claims: { ...identity.claims },
        },
      };
      return {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
        structuredContent: output,
      };
    },
  );

  return server;
}
