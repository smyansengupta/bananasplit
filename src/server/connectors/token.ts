import "server-only";

import { OAuthError, OAuthErrorCode, type AuthInfo } from "@modelcontextprotocol/server";
import { createRemoteJWKSet, decodeJwt, jwtVerify, type JWTPayload } from "jose";

import type { ConnectorsConfig } from "./config";

/**
 * Access tokens from AuthKit (RS256 JWTs). The checks: our AuthKit issuer,
 * the exact MCP URL as audience (WorkOS sets the environment's client id
 * when no Resource Indicator matches, which fails here), expiry with 30
 * seconds of leeway, and the claims a grant needs: our user id from the
 * JWT template, the client, the consent (sid) and the WorkOS user (sub,
 * which is not our user id).
 *
 * A verified token becomes a VerifiedConnector, the only identity the
 * connector RLS wrappers (withConnectorUserTx, withConnectorOrgTx in
 * src/server/db/context.ts) accept. It is branded with a symbol this module
 * keeps to itself, so nothing else can build one without a cast.
 */

/** JWT template `{"urn:bananasplit:uid": {{ user.external_id }}}`: our User.id. */
export const UID_CLAIM = "urn:bananasplit:uid";
/** user_consent_options claims: the member's choices on AuthKit's consent screen. */
export const SPACE_CLAIM = "urn:bananasplit:space";
export const ACCESS_CLAIM = "urn:bananasplit:access";
/** SPACE_CLAIM's value for "Personal and all my clubs" (any other value is one space's id). */
export const ALL_SPACES = "all";
/** ACCESS_CLAIM's values. */
export const READ_ACCESS = "read";
export const WRITE_ACCESS = "write";

const VERIFIED: unique symbol = Symbol("VerifiedConnector");

/** A member, through one AI app, as a verified AuthKit token says. */
export interface VerifiedConnector {
  readonly [VERIFIED]: true;
  /** Our User.id (the JWT-template claim). */
  readonly userId: string;
  /** The OAuth client the token was issued to (a CIMD URL or a DCR id). */
  readonly clientId: string;
  /** The consent the token belongs to (`sid`, app_consent_...). */
  readonly consentId: string;
  /** The WorkOS user (`sub`), for revoking the app at WorkOS. */
  readonly workosUserId: string;
  /** SPACE_CLAIM, when AuthKit put the consent choice in the token. */
  readonly space: string | null;
  /** ACCESS_CLAIM, likewise. */
  readonly access: string | null;
  /** The token's exp, in seconds since the epoch. */
  readonly expiresAt: number;
}

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

/** AuthKit's key set, one per origin for the life of the instance (jose caches and refreshes the keys). */
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
  return typeof value === "string" && value.length > 0 && value.length <= 512 ? value : null;
}

/** What is logged when a token is refused: the claims that decide it, never the token. */
function describeRefusedToken(token: string): Record<string, unknown> {
  try {
    const { iss, aud, exp, client_id: clientId } = decodeJwt(token);
    return { iss, aud, exp, clientId };
  } catch {
    return { malformed: true };
  }
}

/** Throws OAuthError(InvalidToken), which the route answers with the 401 challenge. */
export async function verifyConnectorToken(
  token: string,
  config: ConnectorsConfig,
): Promise<VerifiedConnector> {
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, keySet(config.authkitOrigin), {
      issuer: config.authkitOrigin,
      audience: config.resourceUrl,
      algorithms: ["RS256"],
      clockTolerance: 30,
      requiredClaims: ["exp"],
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
  const consentId = stringClaim(payload, "sid");
  const workosUserId = stringClaim(payload, "sub");
  if (!userId || !clientId || !consentId || !workosUserId) {
    console.warn("[connectors] token missing claims", {
      hasUid: Boolean(userId),
      hasClientId: Boolean(clientId),
      hasSid: Boolean(consentId),
      hasSub: Boolean(workosUserId),
      claimNames: Object.keys(payload),
    });
    throw new OAuthError(
      OAuthErrorCode.InvalidToken,
      "The access token doesn't name a Bananasplit account.",
    );
  }

  return {
    [VERIFIED]: true,
    userId,
    clientId,
    consentId,
    workosUserId,
    space: stringClaim(payload, SPACE_CLAIM),
    access: stringClaim(payload, ACCESS_CLAIM),
    // requiredClaims made jose check it is there and in the future.
    expiresAt: payload.exp as number,
  };
}

/** The verified connector as the MCP SDK's AuthInfo, for requireBearerAuth and createMcpHandler. */
export function connectorAuthInfo(
  connector: VerifiedConnector,
  token: string,
  config: ConnectorsConfig,
  extra: Record<string, unknown> = {},
): AuthInfo {
  return {
    token,
    clientId: connector.clientId,
    // Self-registered clients only get the OpenID scopes; access is the grant's.
    scopes: [],
    expiresAt: connector.expiresAt,
    resource: new URL(config.resourceUrl),
    extra: { ...extra, connector },
  };
}

function isVerifiedConnector(value: unknown): value is VerifiedConnector {
  return (
    typeof value === "object" && value !== null && (value as VerifiedConnector)[VERIFIED] === true
  );
}

/** The connector connectorAuthInfo attached, or null (never one built anywhere else). */
export function connectorFromAuthInfo(authInfo: AuthInfo | undefined): VerifiedConnector | null {
  const connector = authInfo?.extra?.connector;
  return isVerifiedConnector(connector) ? connector : null;
}
