import { ConferenceProvider, IntegrationProvider } from "@/generated/prisma/enums";

import { ConferenceNotConfiguredError } from "./types";

/**
 * The three meeting providers, in one table (docs/features/meetings.md).
 *
 * Adding a fourth is an entry here plus a client in this directory. Each
 * provider is its OWN OrgIntegration row, deliberately: an org can have
 * Google Meet without mirroring its calendar into Google Calendar, and Zoom
 * with no Google account at all. Connecting one never re-prompts for another.
 *
 * Platform credentials come from the environment, one OAuth client per
 * provider, like GOOGLE_CALENDAR_CLIENT_ID / _SECRET before them. A provider
 * with no credentials set is "not configured": the app still lists it, the
 * Connect button explains it is unavailable, and nothing throws until someone
 * actually tries to connect.
 */

export interface ProviderDef {
  /** The OrgIntegration row. */
  integration: IntegrationProvider;
  /** What an Event records as its kind of call. */
  conference: ConferenceProvider;
  /** Shown to admins. */
  label: string;
  /** The env vars holding this deployment's OAuth client. */
  env: { clientId: string; clientSecret: string; tenant?: string };
  authorize: string;
  token: string;
  revoke: string | null;
  /** Scopes asked for at consent. */
  scopes: readonly string[];
  /** Scopes the callback insists came back (the rest are informational). */
  required: readonly string[];
  /** Hosts a join URL may point at. */
  joinHosts: readonly string[];
  /** The provider sends a refresh token only with these extra params. */
  authorizeParams?: Record<string, string>;
  /** Where an admin makes the app, for the "not configured" notice. */
  consoleUrl: string;
}

const MEET: ProviderDef = {
  integration: IntegrationProvider.GOOGLE_MEET,
  conference: ConferenceProvider.MEET,
  label: "Google Meet",
  env: { clientId: "GOOGLE_MEET_CLIENT_ID", clientSecret: "GOOGLE_MEET_CLIENT_SECRET" },
  authorize: "https://accounts.google.com/o/oauth2/v2/auth",
  token: "https://oauth2.googleapis.com/token",
  revoke: "https://oauth2.googleapis.com/revoke",
  // meetings.space.created covers creating a space and reading back the one
  // we created. openid/email are for showing which account is connected.
  scopes: [
    "openid",
    "email",
    "https://www.googleapis.com/auth/meetings.space.created",
  ],
  required: ["https://www.googleapis.com/auth/meetings.space.created"],
  joinHosts: ["meet.google.com"],
  authorizeParams: {
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
  },
  consoleUrl: "https://console.cloud.google.com/apis/credentials",
};

const ZOOM: ProviderDef = {
  integration: IntegrationProvider.ZOOM,
  conference: ConferenceProvider.ZOOM,
  label: "Zoom",
  env: { clientId: "ZOOM_CLIENT_ID", clientSecret: "ZOOM_CLIENT_SECRET" },
  authorize: "https://zoom.us/oauth/authorize",
  token: "https://zoom.us/oauth/token",
  revoke: "https://zoom.us/oauth/revoke",
  // Zoom's granular scopes. The names have to match what the app is given in
  // the Zoom Marketplace build flow; a token short of one comes back 4700,
  // which the client turns into a message naming the scope.
  scopes: ["meeting:write:meeting", "meeting:update:meeting", "meeting:delete:meeting", "user:read:user"],
  required: ["meeting:write:meeting"],
  joinHosts: ["zoom.us"],
  consoleUrl: "https://marketplace.zoom.us/develop/create",
};

const TEAMS: ProviderDef = {
  integration: IntegrationProvider.MICROSOFT_TEAMS,
  conference: ConferenceProvider.TEAMS,
  label: "Microsoft Teams",
  env: {
    clientId: "MICROSOFT_TEAMS_CLIENT_ID",
    clientSecret: "MICROSOFT_TEAMS_CLIENT_SECRET",
    tenant: "MICROSOFT_TEAMS_TENANT",
  },
  // "common" lets any work or personal account connect; a single-tenant app
  // registration sets MICROSOFT_TEAMS_TENANT to its own tenant id instead.
  authorize: "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize",
  token: "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
  revoke: null,
  scopes: ["offline_access", "openid", "email", "OnlineMeetings.ReadWrite"],
  required: ["OnlineMeetings.ReadWrite"],
  joinHosts: ["teams.microsoft.com", "teams.live.com"],
  consoleUrl: "https://portal.azure.com",
};

export const PROVIDERS: readonly ProviderDef[] = [MEET, ZOOM, TEAMS];

/** The provider definition for an OrgIntegration row, or null. */
export function providerOf(integration: IntegrationProvider): ProviderDef | null {
  return PROVIDERS.find((p) => p.integration === integration) ?? null;
}

/** The provider definition behind an Event's conferenceProvider, or null. */
export function providerForConference(conference: ConferenceProvider): ProviderDef | null {
  return PROVIDERS.find((p) => p.conference === conference) ?? null;
}

export function isMeetingIntegration(integration: IntegrationProvider): boolean {
  return providerOf(integration) !== null;
}

type Env = Record<string, string | undefined>;

export interface ProviderClient {
  clientId: string;
  clientSecret: string;
  /** Microsoft only; "common" when the deployment did not pin a tenant. */
  tenant: string;
}

/** True when this deployment has an OAuth client for the provider. */
export function isConfigured(def: ProviderDef, env: Env = process.env): boolean {
  return Boolean(env[def.env.clientId]?.trim() && env[def.env.clientSecret]?.trim());
}

/** The deployment's OAuth client, or ConferenceNotConfiguredError. */
export function providerClient(def: ProviderDef, env: Env = process.env): ProviderClient {
  const clientId = env[def.env.clientId]?.trim();
  const clientSecret = env[def.env.clientSecret]?.trim();
  if (!clientId || !clientSecret) {
    throw new ConferenceNotConfiguredError(def.integration, [
      def.env.clientId,
      def.env.clientSecret,
    ]);
  }
  const tenant = (def.env.tenant ? env[def.env.tenant]?.trim() : undefined) || "common";
  return { clientId, clientSecret, tenant };
}

/** A provider URL with {tenant} filled in. */
export function providerUrl(raw: string, client: ProviderClient): string {
  return raw.replace("{tenant}", encodeURIComponent(client.tenant));
}

/**
 * Whether a URL the provider handed back is one we are willing to store: an
 * https link on a host the provider owns. Everything from a provider's API is
 * untrusted, and a join link is something members click.
 */
export function isAllowedJoinUrl(raw: string, hosts: readonly string[]): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  return hosts.some((h) => host === h || host.endsWith(`.${h}`));
}

/** Every OrgIntegration provider that is a meeting provider. */
export const MEETING_INTEGRATIONS: readonly IntegrationProvider[] = PROVIDERS.map(
  (p) => p.integration,
);
