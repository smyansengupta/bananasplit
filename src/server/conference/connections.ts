import { IntegrationStatus } from "@/generated/prisma/enums";
import { withOrgTx } from "@/server/db/context";

import { segmentOf } from "./connect";
import { PROVIDERS, isConfigured } from "./providers";

/**
 * What the Meetings section needs to know about the org's video-call
 * connections (docs/features/meetings.md).
 *
 * Deliberately not part of loadIntegrations: the meeting providers are not on
 * Settings > Integrations any more. You connect them where you use them, so
 * this is read by the Meetings page and by the create flow, and it carries
 * only what those two need to draw a row and a button. Never a secret, never
 * a fingerprint.
 */

export interface MeetingConnection {
  /** The OrgIntegration provider, e.g. "ZOOM". */
  provider: string;
  /** The URL segment for its connect route. */
  slug: string;
  label: string;
  /** Ready to create meetings right now. */
  connected: boolean;
  /** Connected once, but the provider has stopped accepting it. */
  needsReauth: boolean;
  /** This deployment has an OAuth client for it at all. */
  available: boolean;
  /** The connected account, for "Connected as …". */
  accountEmail: string | null;
  /** Where an admin makes the app, when the platform has no client yet. */
  consoleUrl: string;
  /** The env vars a deployment is missing, when it is not available. */
  missingEnv: string[];
}

export async function loadMeetingConnections(orgId: string): Promise<MeetingConnection[]> {
  const rows = await withOrgTx(orgId, ({ db }) =>
    db.orgIntegration.findMany({
      where: { organizationId: orgId, provider: { in: PROVIDERS.map((p) => p.integration) } },
      select: { provider: true, status: true, config: true },
    }),
  );
  const byProvider = new Map(rows.map((r) => [r.provider, r]));

  return PROVIDERS.map((def) => {
    const row = byProvider.get(def.integration);
    const config = (row?.config ?? {}) as { accountEmail?: unknown };
    return {
      provider: def.integration,
      slug: segmentOf(def),
      label: def.label,
      connected: row?.status === IntegrationStatus.CONNECTED,
      needsReauth: row?.status === IntegrationStatus.NEEDS_REAUTH,
      available: isConfigured(def),
      accountEmail: typeof config.accountEmail === "string" ? config.accountEmail : null,
      consoleUrl: def.consoleUrl,
      missingEnv: isConfigured(def) ? [] : [def.env.clientId, def.env.clientSecret],
    };
  });
}

/** Just the providers an online meeting can actually be created with. */
export function connectable(connections: readonly MeetingConnection[]): MeetingConnection[] {
  return connections.filter((c) => c.connected);
}
