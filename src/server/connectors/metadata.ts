import "server-only";

import { connectorsConfig } from "./config";

/**
 * Protected Resource Metadata (RFC 9728) for /api/mcp: AuthKit is the one
 * authorization server. Served at the path-suffixed well-known URI the
 * 401 challenge names, and at the root one clients try next. No
 * scopes_supported: self-registered clients only get WorkOS's OpenID
 * scopes, so read or change is the member's consent choice instead.
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, MCP-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};

export function protectedResourceMetadataResponse(): Response {
  const config = connectorsConfig();
  if (!config) return new Response(null, { status: 404, headers: CORS_HEADERS });
  return Response.json(
    {
      resource: config.resourceUrl,
      authorization_servers: [config.authkitOrigin],
      bearer_methods_supported: ["header"],
      resource_name: "Bananasplit",
    },
    { headers: { ...CORS_HEADERS, "Cache-Control": "public, max-age=300" } },
  );
}

export function protectedResourceMetadataOptions(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
