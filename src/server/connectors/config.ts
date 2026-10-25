import "server-only";

import { appUrl } from "@/lib/app-url";

/**
 * AI connectors (docs/features/ai-connectors.md): WorkOS AuthKit Standalone
 * Connect issues the OAuth tokens; this app is the MCP resource server at
 * /api/mcp and AuthKit's External Sign-in URI at /connect.
 *
 * OFF unless all three are set: CONNECTORS_ENABLED="true", WORKOS_API_KEY
 * and WORKOS_AUTHKIT_DOMAIN (an https origin; http only on this machine,
 * for the WorkOS emulator). Off, /api/mcp and the metadata answer 404,
 * /connect says so, and the profile card and the club switch are hidden.
 * Read at request time, never inlined into the client bundle.
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

type Env = Record<string, string | undefined>;

export const MCP_PATH = "/api/mcp";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Whether the deployment asks for connectors at all. */
export function connectorsWanted(env: Env = process.env): boolean {
  return env.CONNECTORS_ENABLED?.trim() === "true";
}

function authkitUrl(env: Env): URL | null {
  const domain = env.WORKOS_AUTHKIT_DOMAIN?.trim();
  if (!domain) return null;
  try {
    const url = new URL(domain);
    const secure =
      url.protocol === "https:" || (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname));
    return secure ? url : null;
  } catch {
    return null;
  }
}

/** Why a wanted configuration is unusable (empty when it is fine, or off). */
export function connectorsConfigProblems(env: Env = process.env): string[] {
  if (!connectorsWanted(env)) return [];
  const problems: string[] = [];
  if (!env.WORKOS_API_KEY?.trim()) problems.push("WORKOS_API_KEY is not set");
  if (!env.WORKOS_AUTHKIT_DOMAIN?.trim()) {
    problems.push("WORKOS_AUTHKIT_DOMAIN is not set");
  } else if (!authkitUrl(env)) {
    problems.push("WORKOS_AUTHKIT_DOMAIN must be an https URL (http only on localhost)");
  }
  return problems;
}

export function connectorsConfig(env: Env = process.env): ConnectorsConfig | null {
  const apiKey = env.WORKOS_API_KEY?.trim();
  const authkit = authkitUrl(env);
  if (!connectorsWanted(env) || !apiKey || !authkit) return null;
  try {
    return {
      apiKey,
      authkitOrigin: authkit.origin,
      resourceUrl: appUrl(MCP_PATH, env),
      resourceMetadataUrl: appUrl(`/.well-known/oauth-protected-resource${MCP_PATH}`, env),
    };
  } catch {
    // No usable app URL (production without NEXT_PUBLIC_APP_URL): the
    // health check reports it; connectors stay off rather than failing pages.
    return null;
  }
}

/** Claude's "Add custom connector" dialog, filled in with our MCP URL. */
export function claudeConnectorUrl(resourceUrl: string): string {
  const params = new URLSearchParams({
    modal: "add-custom-connector",
    connectorName: "Bananasplit",
    connectorUrl: resourceUrl,
  });
  return `https://claude.ai/customize/connectors?${params.toString()}`;
}
