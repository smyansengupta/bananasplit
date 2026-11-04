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
 * token again; if it is unchanged (the winner may not have committed yet) we
 * wait ROTATION_SETTLE_MS and read once more. If it changed, we retry once
 * with it, through the same cache and single flight as a caller that read the
 * newer token itself, so the retry and that caller never refresh it twice.
 *
 * The shared refresh carries no caller's abort signal (the token request has
 * its own 10 s timeout): each caller races the shared promise against its own
 * signal, so one caller giving up fails only that caller, and a refresh
 * already under way still stores what the provider rotated.
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

/**
 * After an invalid_grant with the stored token unchanged, how long to wait
 * before looking once more: time for another server that won the refresh to
 * commit the token the provider rotated.
 */
export const ROTATION_SETTLE_MS = 1_000;

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
  const hit = cachedToken(orgId, integration, refreshToken);
  if (hit) return hit;

  options.signal?.throwIfAborted();
  const flight = flightFor(def, orgId, refreshToken, true);
  return options.signal ? untilAborted(flight, options.signal) : flight;
}

/** The cached access token for this refresh token, while it has a minute left. */
function cachedToken(
  orgId: string,
  integration: IntegrationProvider,
  refreshToken: string,
): string | null {
  const hit = cache.get(cacheKey(orgId, integration));
  if (hit && hit.fingerprint === fingerprint(refreshToken) && hit.expiresAt - 60_000 > Date.now()) {
    return hit.accessToken;
  }
  return null;
}

/**
 * The refresh of this refresh token: the one already under way here, or a
 * new one. A second refresh of a token Zoom has just retired would come back
 * invalid_grant, so everyone holding the same token waits for one refresh.
 *
 * `mayRetry` is whether this refresh may retry once on invalid_grant. A
 * caller's own refresh may; the retry may not, which is what bounds it.
 */
function flightFor(
  def: ProviderDef,
  orgId: string,
  refreshToken: string,
  mayRetry: boolean,
): Promise<string> {
  const flightKey = `${cacheKey(orgId, def.integration)}:${fingerprint(refreshToken)}`;
  const flight = inflight.get(flightKey);
  if (flight) return flight;
  const started = refresh(def, orgId, refreshToken, mayRetry).finally(() => {
    if (inflight.get(flightKey) === started) inflight.delete(flightKey);
  });
  // Every caller may have given up by the time it settles; that is not an
  // unhandled rejection. Callers still waiting get the error as usual.
  started.catch(() => {});
  inflight.set(flightKey, started);
  return started;
}

/** `promise`, or the signal's reason once it aborts. Only this caller gives up. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/**
 * One refresh, and on invalid_grant at most one more: only when the stored
 * token has changed since we read it, i.e. another refresh rotated it.
 *
 * The retry asks for the newer token's access token the way any caller
 * holding it would: from the cache, or from the refresh of it already under
 * way here. Sent straight to the provider instead, it would race that
 * caller's own refresh of the same token; the provider honours one and
 * refuses the other, and the refused one could end in NEEDS_REAUTH while a
 * valid token sits in the store.
 */
async function refresh(
  def: ProviderDef,
  orgId: string,
  refreshToken: string,
  mayRetry: boolean,
): Promise<string> {
  try {
    return await refreshOnce(def, orgId, refreshToken);
  } catch (error) {
    if (!mayRetry || !isInvalidGrant(error)) throw failed(def, orgId, error);
    let newer: string | null;
    try {
      newer = await newerRefreshToken(orgId, def.integration, refreshToken);
    } catch (lookup) {
      throw failed(def, orgId, lookup);
    }
    if (newer === null) throw failed(def, orgId, error);
    // A failure of the retry was already put through failed() by its own refresh.
    return cachedToken(orgId, def.integration, newer) ?? flightFor(def, orgId, newer, false);
  }
}

/** Forgets the cached access token and says what went wrong in the provider's terms. */
function failed(def: ProviderDef, orgId: string, error: unknown): unknown {
  cache.delete(cacheKey(orgId, def.integration));
  return refreshError(def, error);
}

/** Exchanges one refresh token, keeps what the provider rotated, and caches the result. */
async function refreshOnce(def: ProviderDef, orgId: string, used: string): Promise<string> {
  const integration = def.integration;
  const tokens: ProviderTokens = await refreshTokens(def, used);

  // The token the store holds now, which is what the next call will read.
  let current = used;
  const rotated = tokens.refreshToken;
  if (rotated && rotated !== used) {
    try {
      // true: stored. false: someone else rotated or reconnected first and
      // theirs stays. Either way the token we used is no longer the one held.
      await rotateSecret({
        orgId,
        provider: integration,
        kind: "REFRESH_TOKEN",
        previous: used,
        value: rotated,
      });
      current = rotated;
    } catch (error) {
      // The store still holds the token we used, so the access token stays
      // cached under it for its lifetime, rather than forcing a refresh with
      // a token the provider may already have retired.
      console.warn(
        `[conference] ${integration} rotated refresh token not stored for org ${orgId}: ${sanitize(error)}`,
      );
    }
  }

  cache.set(cacheKey(orgId, integration), {
    accessToken: tokens.accessToken,
    expiresAt: Date.now() + tokens.expiresInSeconds * 1000,
    fingerprint: fingerprint(current),
  });
  return tokens.accessToken;
}

/**
 * The stored refresh token if it is no longer `used`, else null. A server
 * that won the refresh may not have committed the rotated token yet, so an
 * unchanged one gets a second look after ROTATION_SETTLE_MS.
 */
async function newerRefreshToken(
  orgId: string,
  integration: IntegrationProvider,
  used: string,
): Promise<string | null> {
  const stored = await getRefreshToken(orgId, integration);
  if (stored !== used) return stored;
  await new Promise((resolve) => setTimeout(resolve, ROTATION_SETTLE_MS));
  const later = await getRefreshToken(orgId, integration);
  return later !== used ? later : null;
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
