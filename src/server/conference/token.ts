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
 * with it.
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
  const fp = fingerprint(refreshToken);
  const key = cacheKey(orgId, integration);
  const hit = cache.get(key);
  if (hit && hit.fingerprint === fp && hit.expiresAt - 60_000 > Date.now()) return hit.accessToken;

  // A second refresh of a token Zoom has just retired would come back
  // invalid_grant, so callers here wait for the one already under way.
  options.signal?.throwIfAborted();
  const flightKey = `${key}:${fp}`;
  let flight = inflight.get(flightKey);
  if (!flight) {
    const started = refresh(def, orgId, refreshToken).finally(() => {
      if (inflight.get(flightKey) === started) inflight.delete(flightKey);
    });
    // Every caller may have given up by the time it settles; that is not an
    // unhandled rejection. Callers still waiting get the error as usual.
    started.catch(() => {});
    inflight.set(flightKey, started);
    flight = started;
  }
  return options.signal ? untilAborted(flight, options.signal) : flight;
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

async function refresh(def: ProviderDef, orgId: string, refreshToken: string): Promise<string> {
  const integration = def.integration;
  const key = cacheKey(orgId, integration);

  let used: string;
  let tokens: ProviderTokens;
  try {
    ({ used, tokens } = await refreshOrRetry(def, orgId, refreshToken));
  } catch (error) {
    cache.delete(key);
    throw refreshError(def, error);
  }

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
): Promise<{ used: string; tokens: ProviderTokens }> {
  try {
    return { used: refreshToken, tokens: await refreshTokens(def, refreshToken) };
  } catch (error) {
    if (!isInvalidGrant(error)) throw error;
    const newer = await newerRefreshToken(orgId, def.integration, refreshToken);
    if (newer === null) throw error;
    return { used: newer, tokens: await refreshTokens(def, newer) };
  }
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
