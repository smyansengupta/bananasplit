import "server-only";

import type { ConnectorAccess } from "@/generated/prisma/client";
import { withUserTx } from "@/server/db/context";

import { forgetAtWorkosAfterResponse } from "./revoke";

/**
 * The member's own AI connections, for the Connected apps card on their
 * profile (docs/features/ai-connectors.md). Session user only, through
 * withUserTx: RLS lets a user read and revoke nothing but their own grants.
 *
 * Disconnect sets revokedAt, so the next request with that consent is
 * refused, access tokens issued before it included; after commit, WorkOS
 * forgets the app (best effort, logged; our row is what counts).
 */

export type ConnectedAppSpace =
  | { scope: "all" }
  | { scope: "personal" }
  | { scope: "club"; name: string }
  /** A club the member has left: the app can't use it. */
  | { scope: "gone" };

export interface ConnectedApp {
  id: string;
  name: string;
  access: ConnectorAccess;
  space: ConnectedAppSpace;
  /** ISO timestamps. */
  connectedAt: string;
  lastUsedAt: string;
}

/**
 * What to call an app: its WorkOS name, else the host of its client
 * metadata URL (CIMD clients such as Claude), else a generic name (a DCR
 * client id says nothing).
 */
export function connectedAppName(clientName: string | null, clientId: string): string {
  const name = clientName?.trim();
  if (name) return name;
  try {
    const url = new URL(clientId);
    if (url.protocol === "https:") return url.hostname.replace(/^www\./, "");
  } catch {
    // Not a URL: a DCR client id.
  }
  return "An AI app";
}

export async function listConnectedApps(userId: string): Promise<ConnectedApp[]> {
  const rows = await withUserTx(userId, ({ db }) =>
    db.connectorGrant.findMany({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        clientId: true,
        clientName: true,
        access: true,
        organizationId: true,
        createdAt: true,
        lastUsedAt: true,
        // Null under RLS once the member has left the club.
        organization: { select: { name: true, kind: true } },
      },
    }),
  );
  return rows.map((row) => ({
    id: row.id,
    name: connectedAppName(row.clientName, row.clientId),
    access: row.access,
    space:
      row.organizationId === null
        ? { scope: "all" }
        : !row.organization
          ? { scope: "gone" }
          : row.organization.kind === "PERSONAL"
            ? { scope: "personal" }
            : { scope: "club", name: row.organization.name },
    connectedAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt.toISOString(),
  }));
}

/**
 * Revokes one of the member's apps (`grantId`), or all of them (null).
 * Returns how many were live.
 */
export async function disconnectApps(userId: string, grantId: string | null): Promise<number> {
  return withUserTx(userId, async ({ db, afterCommit }) => {
    const revoked = await db.connectorGrant.updateManyAndReturn({
      where: { userId, revokedAt: null, ...(grantId === null ? {} : { id: grantId }) },
      data: { revokedAt: new Date() },
      select: { workosUserId: true, clientId: true },
    });
    afterCommit(() => forgetAtWorkosAfterResponse(revoked));
    return revoked.length;
  });
}
