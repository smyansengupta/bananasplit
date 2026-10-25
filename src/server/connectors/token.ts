import "server-only";

import { OAuthError, OAuthErrorCode, type AuthInfo } from "@modelcontextprotocol/server";
import { createRemoteJWKSet, decodeJwt, jwtVerify, type JWTPayload } from "jose";

import type { ConnectorsConfig } from "./config";

/**
 * Access tokens from AuthKit (RS256 JWTs). The checks: our AuthKit issuer,
 * the exact MCP URL as audience (WorkOS sets the environment's client id
 * when no Resource Indicator matches, which fails here), expiry, and our
 * user id in the JWT-template claim. `sub` is the WorkOS user id, not ours.
 */

/** JWT template `{"urn:bananasplit:uid": {{ user.external_id }}}`: our User.id. */
export const UID_CLAIM = "urn:bananasplit:uid";
/** user_consent_options claims: the member's choices on AuthKit's consent screen. */
export const SPACE_CLAIM = "urn:bananasplit:space";
export const ACCESS_CLAIM = "urn:bananasplit:access";
/** SPACE_CLAIM's value for "Personal and all my clubs" (any other value is one space's id). */
export const ALL_SPACES = "all";

export interface ConnectorIdentity {
  userId: string;
  /** The OAuth client the token was issued to (a CIMD URL or a DCR id). */
  clientId: string;
  /** The consent the token belongs to (`sid`, app_consent_...). */
  consentId: string | null;
  workosUserId: string | null;
  space: string | null;
  access: string | null;
  /** Every claim, for the spike's whoami tool. Claims are not secrets; the token is. */
  claims: JWTPayload;
}

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function keySet(authkitOrigin: string): ReturnType<typeof createRemoteJWKSet> {
  let set = keySets.get(authkitOrigin);
  if (!set) {
    set = createRemoteJWKSet(new URL("/oauth2/jwks", authkitOrigin));
    keySets.set(authkitOrigin, set);
  }
  return set;
}

function stringClaim(payload: JWTPayload, name: string): string | null {
  const value = payload[name];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** What the spike logs when a token is refused: the claims that decide it, never the token. */
function describeRefusedToken(token: string): Record<string, unknown> {
  try {
    const { iss, aud, sub, exp, client_id: clientId } = decodeJwt(token);
    return { iss, aud, sub, exp, clientId };
  } catch {
    return { malformed: true };
  }
}

export async function verifyConnectorToken(
  token: string,
  config: ConnectorsConfig,
): Promise<AuthInfo> {
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, keySet(config.authkitOrigin), {
      issuer: config.authkitOrigin,
      audience: config.resourceUrl,
      algorithms: ["RS256"],
      clockTolerance: 30,
    }));
  } catch (error) {
    console.warn("[connectors] token refused", {
      reason: error instanceof Error ? error.message : String(error),
      expected: { iss: config.authkitOrigin, aud: config.resourceUrl },
      got: describeRefusedToken(token),
    });
    throw new OAuthError(OAuthErrorCode.InvalidToken, "The access token is invalid or expired.");
  }

  const userId = stringClaim(payload, UID_CLAIM);
  const clientId = stringClaim(payload, "client_id");
  if (!userId || !clientId) {
    console.warn("[connectors] token missing claims", {
      hasUid: Boolean(userId),
      hasClientId: Boolean(clientId),
      claimNames: Object.keys(payload),
    });
    throw new OAuthError(
      OAuthErrorCode.InvalidToken,
      "The access token doesn't name a Bananasplit account.",
    );
  }

  const identity: ConnectorIdentity = {
    userId,
    clientId,
    consentId: stringClaim(payload, "sid"),
    workosUserId: stringClaim(payload, "sub"),
    space: stringClaim(payload, SPACE_CLAIM),
    access: stringClaim(payload, ACCESS_CLAIM),
    claims: payload,
  };
  return {
    token,
    clientId,
    scopes: typeof payload.scope === "string" ? payload.scope.split(" ").filter(Boolean) : [],
    expiresAt: payload.exp,
    resource: new URL(config.resourceUrl),
    extra: { identity },
  };
}

/** The identity verifyConnectorToken attached, from a tool's ctx.http.authInfo. */
export function connectorIdentity(authInfo: AuthInfo | undefined): ConnectorIdentity | null {
  const identity = authInfo?.extra?.identity;
  return identity && typeof identity === "object" ? (identity as ConnectorIdentity) : null;
}
