import { createHash } from "node:crypto";

import type { IntegrationProvider } from "@/generated/prisma/enums";
import { assertNoTx } from "@/server/db/context";
import { sanitize } from "@/server/jobs/sanitize";
import { getSecret, rotateSecret } from "@/server/secrets";

import { type ProviderTokens, refreshTokens } from "./oauth";
import { type ProviderDef, providerOf } from "./providers";
import { ConferenceApiError, ConferenceReauthError } from "./types";

/**
 * Access tokens for an org's meeting-provider connections
 * (docs/features/meetings.md).
 *
 * The per-org credential is the refresh token, an OrgSecret read through
 * getSecret: decrypted outside any transaction, never logged, never returned
 * to a client. Access tokens are cached in memory for their lifetime, keyed by
 * the org, the provider and a fingerprint of the refresh token, so a reconnect
 * can never reuse the previous grant's token.
 *
 * A refresh can hand back a new refresh token: Zoom does on every refresh and
 * retires the old one, and Microsoft recommends replacing it. That one is
 * stored with rotateSecret, a compare-and-set against the token we used, so a
 * refresh that lost a race never overwrites a newer token, and no owner is
 * paged for the provider's routine rotation.
 *
 * Two refreshes racing one rotating token: in this process they share a
 * single refresh. Across processes the loser sees invalid_grant for a token
 * the winner has already replaced, so on invalid_grant we read the stored
 * token once more and, if it changed, retry once with it.
 *
 * invalid_grant that survives that (the admin removed our access, the
 * password changed, the grant expired) becomes ConferenceReauthError, which
 * the sync job turns into NEEDS_REAUTH on the OrgIntegration row plus one
 * notice to owners and admins.
 */

interface CachedToken {
  accessToken: string;
  expiresAt: number;
  fingerprint: string;
}

const cache = new Map<string, CachedToken>();

/** Refreshes under way here, by org, provider and refresh-token fingerprint. */
const inflight = new Map<string, Promise<string>>();

function cacheKey(orgId: string, integration: IntegrationProvider): string {
  return `${orgId}:${integration}`;
}

/** Forget a cached access token (after a 401, a disconnect or a revoke). */
export function clearAccessToken(orgId: string, integration: IntegrationProvider): void {
  cache.delete(cacheKey(orgId, integration));
}

/** For tests. */
export function clearAllAccessTokens(): void {
  cache.clear();
  inflight.clear();
}

function fingerprint(refreshToken: string): string {
  return createHash("sha256").update(refreshToken).digest("hex").slice(0, 16);
}

/** The org's stored refresh token for a provider, or ConferenceReauthError. */
export async function getRefreshToken(
  orgId: string,
  integration: IntegrationProvider,
): Promise<string> {
  const token = await getSecret({ orgId, provider: integration, kind: "REFRESH_TOKEN" });
  if (!token) {
    throw new ConferenceReauthError(
      integration,
      `No ${integration} authorization is stored for this organization.`,
    );
  }
  return token;
}

/** A valid access token for the org's connection to that provider. */
export async function getAccessToken(
  orgId: string,
  integration: IntegrationProvider,
  options: { signal?: AbortSignal } = {},
): Promise<string> {
  const def: ProviderDef | null = providerOf(integration);
  if (!def) throw new ConferenceApiError(500, null, `${integration} is not a meeting provider`);
  assertNoTx(`${integration} token refresh`);

  const refreshToken = await getRefreshToken(orgId, integration);
  const fp = fingerprint(refreshToken);
  const key = cacheKey(orgId, integration);
  const hit = cache.get(key);
  if (hit && hit.fingerprint === fp && hit.expiresAt - 60_000 > Date.now()) return hit.accessToken;

  // A second refresh of a token Zoom has just retired would come back
  // invalid_grant, so callers here wait for the one already under way.
  const flightKey = `${key}:${fp}`;
  const pending = inflight.get(flightKey);
  if (pending) return pending;
  const flight = refresh(def, orgId, refreshToken, options.signal).finally(() => {
    if (inflight.get(flightKey) === flight) inflight.delete(flightKey);
  });
  inflight.set(flightKey, flight);
  return flight;
}

async function refresh(
  def: ProviderDef,
  orgId: string,
  refreshToken: string,
  signal: AbortSignal | undefined,
): Promise<string> {
  const integration = def.integration;
  const key = cacheKey(orgId, integration);

  let used: string;
  let tokens: ProviderTokens;
  try {
    ({ used, tokens } = await refreshOrRetry(def, orgId, refreshToken, signal));
  } catch (error) {
    cache.delete(key);
    throw refreshError(def, error);
  }

  let current = used;
  if (tokens.refreshToken && tokens.refreshToken !== used) {
    try {
      // false means someone else rotated or reconnected first; theirs stays.
      await rotateSecret({
        orgId,
        provider: integration,
        kind: "REFRESH_TOKEN",
        previous: used,
        value: tokens.refreshToken,
      });
    } catch (error) {
      // The access token is good either way; only the next refresh is at risk.
      console.warn(
        `[conference] ${integration} rotated refresh token not stored for org ${orgId}: ${sanitize(error)}`,
      );
    }
    current = tokens.refreshToken;
  }

  cache.set(key, {
    accessToken: tokens.accessToken,
    expiresAt: Date.now() + tokens.expiresInSeconds * 1000,
    fingerprint: fingerprint(current),
  });
  return tokens.accessToken;
}

/**
 * One refresh, and on invalid_grant at most one more: only when the stored
 * token has changed since we read it, i.e. another refresh rotated it.
 */
async function refreshOrRetry(
  def: ProviderDef,
  orgId: string,
  refreshToken: string,
  signal: AbortSignal | undefined,
): Promise<{ used: string; tokens: ProviderTokens }> {
  try {
    return { used: refreshToken, tokens: await refreshTokens(def, refreshToken, signal) };
  } catch (error) {
    if (!isInvalidGrant(error)) throw error;
    const latest = await getRefreshToken(orgId, def.integration);
    if (latest === refreshToken) throw error;
    return { used: latest, tokens: await refreshTokens(def, latest, signal) };
  }
}

function isInvalidGrant(error: unknown): boolean {
  // Every one of the three says invalid_grant for a grant that is gone.
  return error instanceof ConferenceApiError && error.code === "invalid_grant";
}

function refreshError(def: ProviderDef, error: unknown): unknown {
  if (isInvalidGrant(error)) return new ConferenceReauthError(def.integration);
  if (
    error instanceof ConferenceApiError &&
    (error.code === "invalid_client" || error.code === "unauthorized_client")
  ) {
    return new ConferenceApiError(
      error.status,
      error.code,
      `${def.label} rejected this deployment's OAuth client (${error.code}).`,
    );
  }
  return error;
}
