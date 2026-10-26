import { IntegrationStatus, type Role } from "@/generated/prisma/client";
import { NotFoundError } from "@/lib/auth/errors";
import { can } from "@/lib/auth/permissions";
import { withOrgTx } from "@/server/db/context";
import { sanitize } from "@/server/jobs/sanitize";
import { setSecret } from "@/server/secrets";

import { exchangeCode, missingScopes, revokeToken, verifyCookie, verifyState } from "./oauth";
import { PROVIDERS, type ProviderDef } from "./providers";
import { requeueWaitingMeetings } from "./requeue";
import { clearAccessToken } from "./token";
import { ConferenceNotConfiguredError } from "./types";

/**
 * The meeting-provider OAuth callback's logic, kept out of the route so it
 * can be tested end to end against a mocked provider (conferenceHttp).
 *
 * The same order of checks as the Google Calendar flow it is modelled on
 * (src/server/integrations/google-connect.ts): the signed state (ten
 * minutes), the single-use nonce cookie from /start for the same org and the
 * same provider, the session user is the one who started it, that user is
 * still OWNER/ADMIN there, the provider's own error, then the code exchange
 * and the granted scopes. The token exchange runs with no transaction open;
 * setSecret then writes the OrgIntegration row and the refresh token in one
 * audited service transaction.
 *
 * A grant that came back short of a scope we need is revoked again rather
 * than stored: a half-working connection is worse than none, because every
 * meeting made under it would fail one at a time.
 */

export type ConferenceCallbackError =
  | "invalid_state"
  | "signed_out"
  | "wrong_user"
  | "forbidden"
  | "denied"
  | "scopes"
  | "no_refresh_token"
  | "not_configured"
  | "provider_error";

export type ConferenceCallbackOutcome =
  | { ok: true; orgSlug: string }
  | { ok: false; code: ConferenceCallbackError; orgSlug?: string };

export const CONFERENCE_CALLBACK_MESSAGES: Record<ConferenceCallbackError, string> = {
  invalid_state: "The connection expired or was not started here. Try Connect again.",
  signed_out: "Sign in, then try Connect again.",
  wrong_user: "The connection was started by a different account. Try Connect again.",
  forbidden: "Only owners and admins can connect a meeting provider.",
  denied: "Access was not granted.",
  scopes:
    "The provider did not grant permission to create meetings. Try again and keep the meeting permission checked.",
  no_refresh_token:
    "The provider did not return offline access, so we could not keep the connection. Remove Bananasplit from that account's connected apps, then connect again.",
  not_configured: "That meeting provider is not configured on this platform yet.",
  provider_error: "The provider could not complete the connection. Try again.",
};

export interface ConferenceCallbackInput {
  provider: ProviderDef;
  state: string | null;
  code: string | null;
  error: string | null;
  cookie: string | null;
  sessionUserId: string | null;
  signal?: AbortSignal;
}

async function orgRole(orgId: string): Promise<{ role: Role; slug: string } | null> {
  try {
    return await withOrgTx(orgId, async ({ db, role }) => {
      const org = await db.organization.findUniqueOrThrow({
        where: { id: orgId },
        select: { slug: true },
      });
      return { role, slug: org.slug };
    });
  } catch (error) {
    if (error instanceof NotFoundError) return null;
    throw error;
  }
}

export async function completeConferenceConnect(
  input: ConferenceCallbackInput,
): Promise<ConferenceCallbackOutcome> {
  const def = input.provider;
  const state = verifyState(input.state, def.integration);
  const cookie = verifyCookie(input.cookie, def.integration);
  if (!state || !cookie || cookie.nonce !== state.nonce || cookie.orgId !== state.orgId) {
    return { ok: false, code: "invalid_state" };
  }
  if (!input.sessionUserId) return { ok: false, code: "signed_out" };
  if (input.sessionUserId !== state.userId) return { ok: false, code: "wrong_user" };

  const membership = await orgRole(state.orgId);
  if (!membership) return { ok: false, code: "forbidden" };
  const orgSlug = membership.slug;
  if (!can({ role: membership.role }, "integrations.write"))
    return { ok: false, code: "forbidden", orgSlug };
  if (input.error) return { ok: false, code: "denied", orgSlug };
  if (!input.code || input.code.length > 2000) return { ok: false, code: "invalid_state", orgSlug };

  let tokens;
  try {
    tokens = await exchangeCode(def, input.code, cookie.verifier, input.signal);
    if (missingScopes(def, tokens.scopes).length > 0) {
      if (tokens.refreshToken)
        await revokeToken(def, tokens.refreshToken, input.signal).catch(() => undefined);
      return { ok: false, code: "scopes", orgSlug };
    }
    if (!tokens.refreshToken) return { ok: false, code: "no_refresh_token", orgSlug };
  } catch (error) {
    if (error instanceof ConferenceNotConfiguredError)
      return { ok: false, code: "not_configured", orgSlug };
    console.warn(`[conference] ${def.integration} callback failed: ${sanitize(error)}`);
    return { ok: false, code: "provider_error", orgSlug };
  }

  // A reconnect replaces the grant, so any token cached under the old one
  // must go or the first meeting after reconnecting would use it.
  clearAccessToken(state.orgId, def.integration);
  await setSecret({
    orgId: state.orgId,
    actor: { userId: state.userId, role: membership.role },
    provider: def.integration,
    kind: "REFRESH_TOKEN",
    value: tokens.refreshToken,
    status: IntegrationStatus.CONNECTED,
    config: {
      accountEmail: tokens.accountEmail,
      scopes: tokens.scopes,
      connectedAt: new Date().toISOString(),
      disconnectedAt: null,
    },
  });
  // Meetings saved before this provider was connected, and ones left FAILED
  // by an expired grant, get their link now. Best effort: the connection is
  // already stored, so a failed requeue must not turn a good connect into an
  // error page.
  try {
    await requeueWaitingMeetings(state.orgId, def.integration);
  } catch (error) {
    console.warn("[conference] requeue after connect failed: " + sanitize(error));
  }
  return { ok: true, orgSlug };
}

/**
 * Where a connect attempt sends the browser back to: the Meetings section,
 * which is where you connect a provider now. Connect is a form POST from the
 * Video calls bar there that navigates to the provider's consent screen, so
 * this brings the person back to the page they started from. The create form
 * has no connect of its own (a provider not connected is a disabled item in
 * its menu), so there is no half-typed meeting to come back to.
 */
export function returnPath(orgSlug: string, _def: ProviderDef): string {
  return `/app/${orgSlug}/meetings`;
}

/** A provider's URL segment: google-meet, zoom, microsoft-teams. */
export function segmentOf(def: ProviderDef): string {
  return def.integration.toLowerCase().replace(/_/g, "-");
}

/** The provider for a route's `[provider]` segment, or null. */
export function providerFromSlug(slug: string): ProviderDef | null {
  // Compared against the real segments rather than cast, so a slug that is
  // not one of ours can never reach providerOf as if it were an enum value.
  return PROVIDERS.find((p) => segmentOf(p) === slug.toLowerCase()) ?? null;
}
