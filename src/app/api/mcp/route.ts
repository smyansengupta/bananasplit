import {
  createMcpHandler,
  originValidationResponse,
  requireBearerAuth,
} from "@modelcontextprotocol/server";

import { connectorsConfig } from "@/server/connectors/config";
import { buildConnectorServer } from "@/server/connectors/server";
import { connectorIdentity, verifyConnectorToken } from "@/server/connectors/token";

/**
 * The MCP endpoint (docs/features/ai-connectors.md): stateless Streamable
 * HTTP, 2025-era clients (initialize) and 2026-07-28 clients
 * (server/discover) on the same URL. GET and DELETE get the SDK's 405.
 *
 * 1. A browser Origin that isn't ours: 403 (MCP clients send none).
 * 2. No valid AuthKit token: a real 401 with the resource_metadata
 *    challenge (Claude ignores the header on any other status).
 * 3. The tool runs as the token's member (whoami: withUserTx under RLS).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const handler = createMcpHandler(() => buildConnectorServer(), {
  responseMode: "json",
  maxSubscriptions: 0,
});

async function serve(request: Request): Promise<Response> {
  const config = connectorsConfig();
  if (!config) {
    return Response.json({ error: "AI connectors aren't configured." }, { status: 404 });
  }

  const refused = originValidationResponse(request, [new URL(config.resourceUrl).hostname]);
  if (refused) return refused;

  const gate = requireBearerAuth({
    verifier: { verifyAccessToken: (token) => verifyConnectorToken(token, config) },
    expectedResource: new URL(config.resourceUrl),
    resourceMetadataUrl: config.resourceMetadataUrl,
  });
  const auth = await gate(request);
  if (auth instanceof Response) return auth;

  const identity = connectorIdentity(auth);
  console.info("[connectors] request", {
    method: request.method,
    protocolVersion: request.headers.get("mcp-protocol-version"),
    mcpMethod: request.headers.get("mcp-method"),
    userId: identity?.userId,
    clientId: identity?.clientId,
    consentId: identity?.consentId,
    space: identity?.space,
    access: identity?.access,
  });
  return handler.fetch(request, { authInfo: auth });
}

export { serve as DELETE, serve as GET, serve as POST };
