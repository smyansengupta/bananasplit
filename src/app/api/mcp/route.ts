import {
  bearerAuthChallengeResponse,
  createMcpHandler,
  OAuthError,
  OAuthErrorCode,
  originValidationResponse,
  requireBearerAuth,
} from "@modelcontextprotocol/server";

import { checkRateLimit, rateLimitKey, retryAfterText } from "@/lib/rate-limit";
import { afterResponse } from "@/server/connectors/after";
import { connectorsConfig } from "@/server/connectors/config";
import { recordClientName, REFUSED_MESSAGES, resolveGrant } from "@/server/connectors/grant";
import { buildConnectorServer, connectorSession } from "@/server/connectors/server";
import {
  connectorAuthInfo,
  connectorFromAuthInfo,
  verifyConnectorToken,
} from "@/server/connectors/token";

/**
 * The MCP endpoint (docs/features/ai-connectors.md): stateless Streamable
 * HTTP, 2025-era clients (initialize) and 2026-07-28 clients
 * (server/discover) on the same URL. Every request, in order:
 *
 * 1. Origin: a browser Origin that isn't ours gets 403 (MCP clients send
 *    none).
 * 2. Bearer: no valid AuthKit token gets a real 401 with the
 *    resource_metadata challenge (Claude ignores the header on any other
 *    status).
 * 3. Grant: our ConnectorGrant row decides (src/server/connectors/grant.ts);
 *    a revoked one gets the same 401, so the app signs in again.
 * 4. Rate limit: 600 requests an hour per grant (fails open, like every
 *    limit).
 * 5. Server: a fresh McpServer for this grant. GET and DELETE get the SDK's
 *    405 once 1-4 pass.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CALL_LIMIT = { limit: 600, windowSec: 60 * 60 } as const;

const handler = createMcpHandler(
  ({ authInfo }) => buildConnectorServer(connectorSession(authInfo)),
  { responseMode: "json", maxSubscriptions: 0 },
);

async function serve(request: Request): Promise<Response> {
  const config = connectorsConfig();
  if (!config) {
    return Response.json({ error: "AI connectors aren't on here." }, { status: 404 });
  }

  const refused = originValidationResponse(request, [new URL(config.resourceUrl).hostname]);
  if (refused) return refused;

  const gate = requireBearerAuth({
    verifier: {
      verifyAccessToken: async (token) =>
        connectorAuthInfo(await verifyConnectorToken(token, config), token, config),
    },
    expectedResource: new URL(config.resourceUrl),
    resourceMetadataUrl: config.resourceMetadataUrl,
  });
  const auth = await gate(request);
  if (auth instanceof Response) return auth;
  const connector = connectorFromAuthInfo(auth);
  if (!connector) return Response.json({ error: "server_error" }, { status: 500 });

  const resolution = await resolveGrant(connector);
  if (!resolution.ok) {
    return bearerAuthChallengeResponse(
      new OAuthError(OAuthErrorCode.InvalidToken, REFUSED_MESSAGES[resolution.reason]),
      { resourceMetadataUrl: config.resourceMetadataUrl },
    );
  }
  const { grant } = resolution;

  const limited = await checkRateLimit(
    rateLimitKey("connector.call", grant.id),
    CALL_LIMIT.limit,
    CALL_LIMIT.windowSec,
  );
  if (!limited.allowed) {
    const seconds = Math.max(1, Math.ceil((limited.retryAfterMs ?? 60_000) / 1000));
    return Response.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32000,
          message: `Too many requests from this app. Try again ${retryAfterText(limited)}.`,
        },
      },
      { status: 429, headers: { "Retry-After": String(seconds) } },
    );
  }

  if (resolution.lookUpClientName) {
    afterResponse("app name lookup", () => recordClientName(config, connector, grant.id));
  }

  return handler.fetch(request, { authInfo: { ...auth, extra: { ...auth.extra, grant } } });
}

export { serve as DELETE, serve as GET, serve as POST };
