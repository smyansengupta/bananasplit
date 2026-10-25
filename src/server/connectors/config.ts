import "server-only";

import { appUrl } from "@/lib/app-url";

/**
 * AI connectors (docs/features/ai-connectors.md), Phase 0 spike: WorkOS
 * AuthKit Standalone Connect issues the OAuth tokens; this app is the MCP
 * resource server at /api/mcp and AuthKit's External Sign-in URI at
 * /connect. Off unless both WorkOS variables are set.
 */
export interface ConnectorsConfig {
  /** The WorkOS environment's API key (staging: sk_test_...). */
  apiKey: string;
  /** The AuthKit origin (https://<subdomain>.authkit.app): every token's iss. */
  authkitOrigin: string;
  /** The MCP URL: the Resource Indicator registered in WorkOS, and every token's aud. */
  resourceUrl: string;
  /** Where the protected resource metadata for resourceUrl is served (RFC 9728, path-suffixed). */
  resourceMetadataUrl: string;
}

export const MCP_PATH = "/api/mcp";

export function connectorsConfig(
  env: Record<string, string | undefined> = process.env,
): ConnectorsConfig | null {
  const apiKey = env.WORKOS_API_KEY?.trim();
  const domain = env.WORKOS_AUTHKIT_DOMAIN?.trim();
  if (!apiKey || !domain) return null;
  return {
    apiKey,
    authkitOrigin: new URL(domain).origin,
    resourceUrl: appUrl(MCP_PATH, env),
    resourceMetadataUrl: appUrl(`/.well-known/oauth-protected-resource${MCP_PATH}`, env),
  };
}
