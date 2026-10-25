import { createHash } from "node:crypto";

import type { IntegrationProvider } from "@/generated/prisma/enums";
import { assertNoTx } from "@/server/db/context";
import { getSecret } from "@/server/secrets";

import { refreshTokens } from "./oauth";
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
 * invalid_grant (the admin removed our access, the password changed, the grant
 * expired) becomes ConferenceReauthError, which the sync job turns into
 * NEEDS_REAUTH on the OrgIntegration row plus one notice to owners and admins.
 */

interface CachedToken {
  accessToken: string;
  expiresAt: number;
  fingerprint: string;
}

const cache = new Map<string, CachedToken>();

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

  let tokens;
  try {
    tokens = await refreshTokens(def, refreshToken, options.signal);
  } catch (error) {
    cache.delete(key);
    if (error instanceof ConferenceApiError) {
      // Every one of the three says invalid_grant for a grant that is gone.
      if (error.code === "invalid_grant") throw new ConferenceReauthError(integration);
      if (error.code === "invalid_client" || error.code === "unauthorized_client") {
        throw new ConferenceApiError(
          error.status,
          error.code,
          `${def.label} rejected this deployment's OAuth client (${error.code}).`,
        );
      }
    }
    throw error;
  }

  cache.set(key, {
    accessToken: tokens.accessToken,
    expiresAt: Date.now() + tokens.expiresInSeconds * 1000,
    fingerprint: fp,
  });
  return tokens.accessToken;
}
