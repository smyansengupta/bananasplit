import { IntegrationStatus, type IntegrationProvider } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { can, requirePermission } from "@/lib/auth/permissions";
import { writeOrgAuditLog } from "@/server/audit";
import { withSystemOrgTx } from "@/server/db/context";
import type { IntegrationResult, OrgActor } from "@/server/integrations/service";
import { sanitize } from "@/server/jobs/sanitize";
import { removeSecret } from "@/server/secrets";

import { revokeToken } from "./oauth";
import { providerOf } from "./providers";
import { clearAccessToken, getRefreshToken } from "./token";

/**
 * Disconnecting a meeting provider (docs/features/meetings.md).
 *
 * The shape of disconnectGoogle (src/server/integrations/service.ts), minus
 * its revoke job: the grant is revoked here, inline, and if that fails there
 * is nothing queued to try again. A provider that is down for ten seconds is
 * the admin's cue to remove Bananasplit from the account's connected apps
 * themselves, which is what the message says.
 *
 *   1. ADMIN+ (integrations.write).
 *   2. Revoke at the provider, best effort, with no transaction open. A
 *      provider with no revoke call (Microsoft) has nothing to ask and counts
 *      as revoked for step 5, but its message says nothing was revoked.
 *   3. One system transaction: DISCONNECTED, config.disconnectedAt, and the
 *      audit row. This is what stops new meetings: the sync job will not
 *      create or move one through a provider that is not CONNECTED.
 *   4. Forget the cached access token.
 *   5. Delete the stored refresh token only if it was revoked and the actor
 *      may remove secrets (OWNER). An ADMIN leaves a revoked, now useless
 *      token encrypted until an owner removes it; a token that was NOT
 *      revoked is never deleted, because deleting it would strand a live
 *      grant that nobody here can revoke any more.
 *
 * Meetings already made keep their links: nothing here touches an Event.
 * Moving or cancelling one afterwards cannot reach the provider until someone
 * connects again.
 *
 * The result carries a message and never a token.
 */
export async function disconnectMeetingProvider(
  orgId: string,
  actor: OrgActor,
  integration: IntegrationProvider,
): Promise<IntegrationResult> {
  requirePermission(actor, "integrations.write");
  const def = providerOf(integration);
  if (!def) return fail(`${integration} is not a video-call provider.`);

  let revoked = false;
  try {
    const token = await getRefreshToken(orgId, integration);
    await revokeToken(def, token, AbortSignal.timeout(10_000));
    revoked = true;
  } catch (error) {
    // Nothing stored counts here too: nothing was revoked, so nothing is deleted.
    console.warn(`[conference] inline ${integration} revoke failed: ${sanitize(error)}`);
  }

  const done = await withSystemOrgTx(orgId, { userId: actor.userId }, async ({ db }) => {
    const row = await db.orgIntegration.findUnique({
      where: { organizationId_provider: { organizationId: orgId, provider: integration } },
      select: { id: true, config: true },
    });
    if (!row) return false;
    await db.orgIntegration.update({
      where: { id: row.id },
      data: {
        status: IntegrationStatus.DISCONNECTED,
        config: {
          ...((row.config as Record<string, unknown> | null) ?? {}),
          disconnectedAt: new Date().toISOString(),
        } as Prisma.InputJsonObject,
      },
    });
    await writeOrgAuditLog(db, {
      organizationId: orgId,
      action: "integration.disconnected",
      targetType: "OrgIntegration",
      targetId: row.id,
      diff: { provider: integration, revokedInline: revoked },
    });
    return true;
  });
  if (!done) return fail(`${def.label} is not connected.`);

  clearAccessToken(orgId, integration);

  // A provider with no revoke call (Microsoft) counts as revoked above, so its
  // token may be deleted, but nothing was revoked and the message must not
  // say so: the person still has that to do in the provider's own settings.
  const asked = def.revoke !== null;
  const finishAtProvider = `Remove Bananasplit from that ${def.label} account's connected apps to`;

  if (revoked && can(actor, "integrations.remove")) {
    await removeSecret({ orgId, actor, provider: integration, kind: "REFRESH_TOKEN" });
    return {
      ok: true,
      message: asked
        ? `Disconnected. Access was revoked at ${def.label} and the token deleted.`
        : `Disconnected and the token deleted. ${finishAtProvider} revoke its access too.`,
    };
  }
  return {
    ok: true,
    message: !revoked
      ? `Disconnected. ${finishAtProvider} finish.`
      : asked
        ? `Disconnected. Access was revoked at ${def.label}.`
        : `Disconnected. ${finishAtProvider} revoke its access too.`,
  };
}

function fail(error: string): IntegrationResult {
  return { ok: false, error };
}
