import { IntegrationProvider, IntegrationStatus } from "@/generated/prisma/client";
import { withSystemOrgTx } from "@/server/db/context";
import { requestSync } from "@/server/sync/enqueue";

import { clearSkipForProvider } from "./progress";

/**
 * What the guided setup DOES after a connection succeeds, so nobody is left
 * looking at an empty screen they just paid for with five minutes of work.
 *
 * All of it runs on the service path (withSystemOrgTx): the actions that
 * call it have already resolved the caller's role through the database and
 * the integration service has already checked integrations.write. None of
 * it touches a secret; the sync job reads its own through the accessor.
 */

/**
 * Queues the org's first website sync and lets the job runner kick itself.
 * Returns false when the org has no connected data source (nothing to run).
 * Never syncs inline: source-sync is a heavy kind.
 */
export async function startFirstSync(organizationId: string, userId: string): Promise<boolean> {
  return withSystemOrgTx(organizationId, { userId }, async ({ db }) => {
    const integration = await db.orgIntegration.findFirst({
      where: {
        organizationId,
        provider: IntegrationProvider.SUPABASE_SOURCE,
        status: IntegrationStatus.CONNECTED,
      },
      select: { id: true },
    });
    if (!integration) return false;
    await requestSync(db, organizationId, integration.id);
    return true;
  });
}

/**
 * After any successful save or test, a step that was marked "not now" is no
 * longer skipped. Silent: this is bookkeeping, not an action of its own.
 */
export async function onProviderConnected(
  organizationId: string,
  userId: string,
  provider: IntegrationProvider,
): Promise<void> {
  await withSystemOrgTx(organizationId, { userId }, ({ db }) =>
    clearSkipForProvider(db, organizationId, provider),
  );
}
