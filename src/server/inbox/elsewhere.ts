import "server-only";

import { withOrgTx, withUserTx } from "@/server/db/context";

/**
 * A Personal space's Inbox gathers your organizations' updates too: the
 * notifications each of them has for you (mentions, comments, assignments,
 * meetings), newest first, each with the organization it's from.
 *
 * Row security as loadPersonalHome reads it: which organizations you're in
 * from withUserTx (your own rows), then one withOrgTx per organization as
 * its member, so each read is that organization's own and only yours. An
 * organization that fails to load is left out rather than failing the page.
 */

/** At most this many organizations, and this many updates from each. */
const MAX_ORGS = 20;
const PER_ORG = 25;
/** Organizations read at once (each is one transaction, one pooled connection). */
const CONCURRENCY = 4;

export interface ElsewhereUpdate {
  id: string;
  org: { id: string; name: string; slug: string };
  type: string;
  title: string;
  body: string | null;
  linkUrl: string | null;
  createdAt: Date;
  readAt: Date | null;
  actor: { name: string | null; image: string | null; avatar: unknown } | null;
}

export async function loadElsewhereUpdates(
  userId: string,
  exceptOrgId: string,
): Promise<ElsewhereUpdate[]> {
  const orgs = await withUserTx(userId, ({ db }) =>
    db.membership.findMany({
      where: {
        userId,
        organizationId: { not: exceptOrgId },
        organization: { deletedAt: null, kind: "CLUB" },
      },
      select: { organization: { select: { id: true, name: true, slug: true } } },
      orderBy: { organization: { name: "asc" } },
      take: MAX_ORGS,
    }),
  ).then((rows) => rows.map((r) => r.organization));

  const out: ElsewhereUpdate[] = [];
  for (let i = 0; i < orgs.length; i += CONCURRENCY) {
    const batch = await Promise.all(
      orgs.slice(i, i + CONCURRENCY).map((org) =>
        withOrgTx(org.id, ({ db }) =>
          db.notification.findMany({
            where: { organizationId: org.id, userId },
            orderBy: { createdAt: "desc" },
            take: PER_ORG,
            select: {
              id: true,
              type: true,
              title: true,
              body: true,
              linkUrl: true,
              createdAt: true,
              readAt: true,
              actor: { select: { name: true, image: true, avatar: true } },
            },
          }),
        )
          .then((rows) => rows.map((n) => ({ ...n, org })))
          .catch(() => []),
      ),
    );
    out.push(...batch.flat());
  }
  return out.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}
