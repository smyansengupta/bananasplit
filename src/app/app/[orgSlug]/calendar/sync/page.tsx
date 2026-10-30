import { BackLink } from "@/components/back-link";
import { PageHeader } from "@/components/page-header";

import { SyncPanel } from "@/components/calendar/sync-panel";
import { appUrl } from "@/lib/app-url";
import { can } from "@/lib/auth/permissions";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { getGoogleSyncStatus } from "@/server/google-calendar/requests";
import { planGate } from "@/server/billing/plan-gate";

/**
 * Calendar > Sync and website feed (OWNER/ADMIN): the public feed URLs and
 * whether the feed is on, the Google Calendar mirror's state with "Sync now",
 * the one-time Google import (dry run, then apply) and the website build
 * hook's state. Connecting Google, the hook secret and the feed switch live
 * in Settings (Integrations and Privacy).
 */
export default async function CalendarSyncPage({
  params,
}: PageProps<"/app/[orgSlug]/calendar/sync">) {
  const { orgSlug } = await params;
  const planLock = await planGate(orgSlug, "integrations");
  if (planLock) return planLock;
  const { organization: org, role } = await getOrgContextBySlug(orgSlug);

  if (!can({ role }, "integrations.view")) {
    return (
      <div className="mx-auto max-w-2xl space-y-3">
        <h1 className="page-title">Sync and website feed</h1>
        <p className="text-muted-foreground text-sm">
          Only owners and admins manage calendar sync.
        </p>
      </div>
    );
  }

  const status = await withOrgTx(org.id, (ctx) => getGoogleSyncStatus(ctx));

  return (
    <div className="mx-auto max-w-3xl space-y-7">
      <BackLink href={`/app/${orgSlug}/calendar`} label="Calendar" />
      <PageHeader
        title="Sync and website feed"
        description={[
          status.google?.status === "CONNECTED"
            ? "Mirroring public events to Google Calendar"
            : status.google?.status === "ERROR"
              ? "Google Calendar needs attention"
              : "Google Calendar isn't connected",
          status.publicEventsEnabled ? "website feed on" : "website feed off",
        ].join(", ")}
      />
      <p className="text-muted-foreground -mt-3 text-sm">
        The suite is the source of truth for events. Public events are mirrored to Google Calendar
        and published to the website feed; internal events never are.
      </p>
      <SyncPanel
        orgId={org.id}
        orgSlug={orgSlug}
        canWrite={can({ role }, "integrations.write")}
        status={status}
        feed={{
          json: appUrl(`/api/public/${org.slug}/events`),
          ics: appUrl(`/api/public/${org.slug}/events.ics`),
        }}
      />
    </div>
  );
}
