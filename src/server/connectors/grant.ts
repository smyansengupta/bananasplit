import "server-only";

import type { ConnectorAccess } from "@/generated/prisma/client";
import { withConnectorUserTx } from "@/server/db/context";
import { ConflictError } from "@/server/db/errors";

import type { ConnectorsConfig } from "./config";
import { ALL_SPACES, WRITE_ACCESS, type VerifiedConnector } from "./token";
import { listAuthorizedApplications } from "./workos";

/**
 * Grant resolution, on every MCP request (docs/features/ai-connectors.md).
 * WorkOS has no revocation endpoint and no grant webhooks, so our
 * ConnectorGrant row, one per (user, OAuth client), decides:
 *
 *   no row                  create one from the token's consent claims;
 *                           without them, READ and every space
 *   another consent (sid)   a new consent: take its claims, clear revokedAt
 *   revoked, same consent   refuse (401 invalid_token): the app signs in
 *                           again and the member consents again
 *   otherwise               use it; lastUsedAt at most every 15 minutes
 *
 * A consent claim naming a space the member is no longer in (they left the
 * club, or it was deleted, between consent and first call) is refused too:
 * widening it to every space would be wrong, and connecting again offers
 * only current spaces. Once stored, the row keeps the choice even when a
 * refreshed token no longer carries the claims.
 */

/** lastUsedAt is written at most this often per grant. */
export const LAST_USED_EVERY_MS = 15 * 60 * 1000;

/** The grant a request runs under (what the tools see). */
export interface ResolvedGrant {
  id: string;
  access: ConnectorAccess;
  /** Null: Personal and every club the member is in. Else that one space. */
  organizationId: string | null;
  clientName: string | null;
}

/** The stored row, as decideGrant reads it. */
export interface GrantRow {
  id: string;
  consentId: string;
  access: ConnectorAccess;
  organizationId: string | null;
  clientName: string | null;
  lastUsedAt: Date;
  revokedAt: Date | null;
}

/** The member's choices on AuthKit's consent screen, as the grant stores them. */
export interface ConsentChoice {
  access: ConnectorAccess;
  organizationId: string | null;
}

/**
 * The token's consent claims as a grant's choices: READ unless it says
 * "write", every space unless it names one. Null when it names a space the
 * member isn't in (`memberOfSpace`, asked only for a named space).
 */
export function consentChoice(
  connector: Pick<VerifiedConnector, "space" | "access">,
  memberOfSpace: boolean,
): ConsentChoice | null {
  const access: ConnectorAccess = connector.access === WRITE_ACCESS ? "WRITE" : "READ";
  if (connector.space === null || connector.space === ALL_SPACES) {
    return { access, organizationId: null };
  }
  return memberOfSpace ? { access, organizationId: connector.space } : null;
}

export type GrantDecision =
  | { kind: "create"; choice: ConsentChoice }
  | { kind: "renew"; choice: ConsentChoice }
  | { kind: "use"; touch: boolean }
  | { kind: "refuse"; reason: "revoked" | "space" };

/** Whether `row` (or its absence) lets a request with this consent through. */
export function decideGrant(
  row: GrantRow | null,
  consentId: string,
  choice: ConsentChoice | null,
  now: Date,
): GrantDecision {
  if (!row || row.consentId !== consentId) {
    if (!choice) return { kind: "refuse", reason: "space" };
    return row ? { kind: "renew", choice } : { kind: "create", choice };
  }
  if (row.revokedAt) return { kind: "refuse", reason: "revoked" };
  return { kind: "use", touch: now.getTime() - row.lastUsedAt.getTime() >= LAST_USED_EVERY_MS };
}

export type GrantResolution =
  | {
      ok: true;
      grant: ResolvedGrant;
      /** Look the app's name up at WorkOS after the response (it has none yet). */
      lookUpClientName: boolean;
    }
  | { ok: false; reason: "revoked" | "space" };

/** What a refused request's 401 says (error_description). */
export const REFUSED_MESSAGES: Record<"revoked" | "space", string> = {
  revoked: "This app was disconnected from Bananasplit. Connect it again to keep using it.",
  space: "This connection names a space you're no longer in. Connect the app again.",
};

const ROW_SELECT = {
  id: true,
  consentId: true,
  access: true,
  organizationId: true,
  clientName: true,
  lastUsedAt: true,
  revokedAt: true,
} as const;

async function resolveOnce(connector: VerifiedConnector, now: Date): Promise<GrantResolution> {
  return withConnectorUserTx(connector, async ({ db }) => {
    const row = await db.connectorGrant.findUnique({
      where: { userId_clientId: { userId: connector.userId, clientId: connector.clientId } },
      select: ROW_SELECT,
    });
    let choice: ConsentChoice | null = null;
    if (!row || row.consentId !== connector.consentId) {
      const named = connector.space !== null && connector.space !== ALL_SPACES;
      const membership = named
        ? await db.membership.findFirst({
            where: {
              userId: connector.userId,
              organizationId: connector.space!,
              organization: { deletedAt: null },
            },
            select: { organizationId: true },
          })
        : null;
      choice = consentChoice(connector, membership !== null);
    }

    const decision = decideGrant(row, connector.consentId, choice, now);
    switch (decision.kind) {
      case "refuse":
        return { ok: false, reason: decision.reason };
      case "create": {
        const created = await db.connectorGrant.create({
          data: {
            userId: connector.userId,
            clientId: connector.clientId,
            workosUserId: connector.workosUserId,
            consentId: connector.consentId,
            access: decision.choice.access,
            organizationId: decision.choice.organizationId,
            createdAt: now,
            lastUsedAt: now,
          },
          select: ROW_SELECT,
        });
        return { ok: true, grant: toGrant(created), lookUpClientName: true };
      }
      case "renew": {
        const renewed = await db.connectorGrant.update({
          where: { id: row!.id },
          data: {
            workosUserId: connector.workosUserId,
            consentId: connector.consentId,
            access: decision.choice.access,
            organizationId: decision.choice.organizationId,
            lastUsedAt: now,
            revokedAt: null,
          },
          select: ROW_SELECT,
        });
        return { ok: true, grant: toGrant(renewed), lookUpClientName: renewed.clientName === null };
      }
      case "use":
        if (decision.touch) {
          await db.connectorGrant.updateMany({
            where: { id: row!.id, userId: connector.userId },
            data: { lastUsedAt: now },
          });
        }
        return {
          ok: true,
          grant: toGrant(row!),
          lookUpClientName: decision.touch && row!.clientName === null,
        };
    }
  });
}

function toGrant(row: GrantRow): ResolvedGrant {
  return {
    id: row.id,
    access: row.access,
    organizationId: row.organizationId,
    clientName: row.clientName,
  };
}

/**
 * Resolves the grant for a verified token (the route's step 3). Two first
 * requests racing to create the row: the loser's insert conflicts, and it
 * reads the winner's row instead.
 */
export async function resolveGrant(
  connector: VerifiedConnector,
  now: Date = new Date(),
): Promise<GrantResolution> {
  try {
    return await resolveOnce(connector, now);
  } catch (error) {
    if (!(error instanceof ConflictError)) throw error;
    return resolveOnce(connector, now);
  }
}

/**
 * Fills in the app's name from WorkOS's authorized applications (after the
 * response: network I/O, never inside a transaction). Leaves it null when
 * WorkOS doesn't list the app; the next lookup is at the next lastUsedAt
 * write, at most every 15 minutes.
 */
export async function recordClientName(
  config: ConnectorsConfig,
  connector: VerifiedConnector,
  grantId: string,
): Promise<void> {
  const result = await listAuthorizedApplications(config, connector.workosUserId);
  if (!result.ok) {
    console.warn("[connectors] authorized applications lookup failed", {
      status: result.status,
      code: result.code,
    });
    return;
  }
  const app = result.data.data.find((a) => a.application?.client_id === connector.clientId);
  const name = app?.application.name?.trim().slice(0, 120);
  if (!name) return;
  await withConnectorUserTx(connector, ({ db }) =>
    db.connectorGrant.updateMany({
      where: { id: grantId, userId: connector.userId, clientName: null },
      data: { clientName: name },
    }),
  );
}
