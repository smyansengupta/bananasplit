import { IntegrationProvider, IntegrationStatus } from "@/generated/prisma/client";
import { withSystemOrgTx } from "@/server/db/context";

/**
 * Whether the organization's website data sync (the SUPABASE_SOURCE
 * integration) is connected. Members can't read integrations (RLS), so this
 * asks as the service, and answers only yes or no. Website polls and the
 * other synced data show only while it is: once it's gone, what it left
 * behind is stale and nothing in the app can update or remove it.
 */
export async function websiteSyncConnected(
  organizationId: string,
  userId: string,
): Promise<boolean> {
  return withSystemOrgTx(organizationId, { userId }, async ({ db }) => {
    const row = await db.orgIntegration.findFirst({
      where: {
        organizationId,
        provider: IntegrationProvider.SUPABASE_SOURCE,
        // A sync that's failing or needs signing in again is still set up:
        // its data is only stale until it's fixed.
        status: { not: IntegrationStatus.DISCONNECTED },
      },
      select: { id: true },
    });
    return row !== null;
  });
}
