import { PageHeader } from "@/components/page-header";
import { can } from "@/lib/auth/permissions";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { listEventTags } from "@/server/events/tags";

import { SettingsNoAccess } from "../settings-no-access";
import { EventTypesEditor } from "./event-types-editor";

/**
 * Settings › Event types (OWNER/ADMIN): the words this organization uses
 * for what goes on its calendar.
 *
 * These were a fixed list — Workshop, Info session, Hackathon, Social,
 * Board meeting — which was one student club's vocabulary. A lab, a team or
 * a department has its own, so the list is the org's to write.
 */
export default async function EventTypesSettingsPage({
  params,
}: PageProps<"/app/[orgSlug]/settings/event-types">) {
  const { orgSlug } = await params;
  const { organization, role } = await getOrgContextBySlug(orgSlug);
  if (!can({ role }, "settings.view")) {
    return <SettingsNoAccess title="Event types" who="owners and admins" />;
  }
  const tags = await withOrgTx(organization.id, ({ db }) => listEventTags(db, organization.id));
  const summary =
    tags.length === 0
      ? "No types yet"
      : `${tags.length} type${tags.length === 1 ? "" : "s"}, in the order the calendar shows them`;

  return (
    <div className="space-y-7.5">
      <div className="space-y-3">
        <PageHeader title="Event types" description={summary} />
        <p className="text-muted-foreground max-w-prose text-sm">
          A type is your own word for what an event is. The calendar colours its chips by type and
          filters by them, and the sign-up pages and the website feed carry the name you pick here.
          Rename, recolour and reorder them as you like; deleting one leaves its events on the
          calendar with no type.
        </p>
      </div>
      <EventTypesEditor orgId={organization.id} tags={tags} />
    </div>
  );
}
