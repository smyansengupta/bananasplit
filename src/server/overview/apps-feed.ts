import { IntegrationProvider, type Role } from "@/generated/prisma/client";
import { can } from "@/lib/auth/permissions";
import { buildAppsFeed, type AppsFeed } from "@/lib/overview/apps-feed";
import { withOrgTx, withSystemOrgTx } from "@/server/db/context";

/**
 * From your apps (src/lib/overview/apps-feed.ts) for one viewer. Calls,
 * Google Calendar's misses and the viewer's own AI apps are read as the
 * viewer (RLS: only events they may see, only their own connections).
 * Integrations aren't readable by members, so their health and the website
 * sync's last runs are read as the service, and only as much as the row
 * says: which app, which stream, when. What needs fixing goes to owners
 * and admins; Google Calendar's misses to whoever can edit events.
 */
export async function loadAppsFeed(viewer: {
  orgId: string;
  orgSlug: string;
  userId: string;
  role: Role;
  now: Date;
}): Promise<AppsFeed> {
  const { orgId, userId, role, now } = viewer;
  const admin = can({ role }, "settings.view");
  const soon = new Date(now.getTime() + 15 * 60 * 1000);

  const mine = await withOrgTx(orgId, async ({ db }) => {
    const calls = await db.event.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        mergedIntoId: null,
        conferenceProvider: { not: "NONE" },
        conferenceUrl: { not: null },
        startsAt: { lte: soon },
        endsAt: { gt: now },
      },
      select: {
        id: true,
        title: true,
        startsAt: true,
        endsAt: true,
        conferenceProvider: true,
        conferenceUrl: true,
      },
      orderBy: { startsAt: "asc" },
      take: 3,
    });
    const calendarFailed = can({ role }, "events.write")
      ? await db.event.count({
          where: {
            organizationId: orgId,
            deletedAt: null,
            googleSyncState: "FAILED",
            endsAt: { gt: now },
          },
        })
      : 0;
    return { calls, calendarFailed };
  });

  // The viewer's own AI app connections, in this space or every space. Its
  // own transaction, so a refusal costs only these rows.
  const ai = await withOrgTx(orgId, ({ db }) =>
    db.connectorGrant.findMany({
      where: {
        userId,
        revokedAt: null,
        OR: [{ organizationId: orgId }, { organizationId: null }],
        lastUsedAt: { gte: new Date(now.getTime() - 72 * 60 * 60 * 1000) },
      },
      select: { clientName: true, lastUsedAt: true },
      orderBy: { lastUsedAt: "desc" },
      take: 3,
    }),
  ).catch(() => []);

  const service = await withSystemOrgTx(orgId, { userId }, async ({ db }) => {
    const integrations = await db.orgIntegration.findMany({
      where: { organizationId: orgId },
      select: {
        provider: true,
        status: true,
        syncStates: { select: { stream: true, lastSyncedAt: true, lastError: true } },
      },
    });
    const website = integrations.find(
      (i) => i.provider === IntegrationProvider.SUPABASE_SOURCE && i.status === "CONNECTED",
    );
    return {
      attention: admin
        ? integrations.flatMap((i) =>
            i.status === "ERROR" || i.status === "NEEDS_REAUTH"
              ? [{ provider: i.provider as string, status: i.status }]
              : [],
          )
        : [],
      syncs: (website?.syncStates ?? []).map((s) => ({
        stream: s.stream,
        lastSyncedAt: s.lastSyncedAt,
        // Only admins hear that a stream failed; nobody sees the error itself.
        failed: admin && s.lastError !== null,
      })),
    };
  });

  return buildAppsFeed({
    now,
    base: `/app/${viewer.orgSlug}`,
    calls: mine.calls.flatMap((c) =>
      c.conferenceUrl
        ? [
            {
              id: c.id,
              title: c.title,
              startsAt: c.startsAt,
              endsAt: c.endsAt,
              provider: c.conferenceProvider,
              url: c.conferenceUrl,
            },
          ]
        : [],
    ),
    syncs: service.syncs,
    calendarFailed: mine.calendarFailed,
    attention: service.attention,
    ai: ai.map((g) => ({ name: g.clientName ?? "An AI app", lastUsedAt: g.lastUsedAt })),
  });
}
