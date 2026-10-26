import "server-only";

import type { Prisma } from "@/generated/prisma/client";

import { afterResponse } from "./after";
import { connectorsConfig } from "./config";

/**
 * Revoking AI connections (docs/features/ai-connectors.md). Our
 * ConnectorGrant row decides: once revokedAt is set, the next request with
 * that consent is refused, access tokens issued before it included. WorkOS
 * is told afterwards, best effort, so the app's refresh tokens die too and
 * the member's next connection is a fresh consent.
 *
 * This module is imported by the identity plane (the Google sign-in gate,
 * the password reset), so it keeps its imports light: the WorkOS client is
 * loaded only when the after-response work runs.
 */

/** What WorkOS should forget for one revoked grant. */
export interface RevokedGrant {
  workosUserId: string;
  clientId: string;
}

/**
 * Revokes every live grant of `userId`, in the caller's identity-plane
 * transaction (app_auth, through app.revoke_connector_grants): for the
 * places that bump UserCredential.sessionVersion.
 */
export function revokeAllConnectorGrants(
  db: Pick<Prisma.TransactionClient, "$queryRaw">,
  userId: string,
): Promise<RevokedGrant[]> {
  return db.$queryRaw<RevokedGrant[]>`
    SELECT "workosUserId", "clientId" FROM app.revoke_connector_grants(${userId})`;
}

/** After the response: DELETE each app from its WorkOS user. Call only after commit. */
export function forgetAtWorkosAfterResponse(grants: readonly RevokedGrant[]): void {
  if (grants.length === 0) return;
  afterResponse("forgetting apps at WorkOS", async () => {
    const config = connectorsConfig();
    if (!config) return;
    const { revokeAuthorizedApplication } = await import("./workos");
    for (const grant of grants) {
      const result = await revokeAuthorizedApplication(config, grant.workosUserId, grant.clientId);
      // 404: WorkOS had already forgotten it.
      if (!result.ok && result.status !== 404) {
        console.warn("[connectors] WorkOS kept a revoked app", {
          status: result.status,
          code: result.code,
        });
      }
    }
  });
}
