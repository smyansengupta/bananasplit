import { notFound } from "next/navigation";

import { EventDetailView } from "@/components/calendar/event-detail-view";
import { can } from "@/lib/auth/permissions";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { getOrgMembersForPicker } from "@/server/members";

import { getEventById } from "../queries";

export default async function EventDetailPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/calendar/[eventId]">) {
  const { orgSlug, eventId } = await params;
  const { organization: org, user, role } = await getOrgContextBySlug(orgSlug);
  const event = await withOrgTx(org.id, ({ db }) => getEventById(db, org.id, eventId, user.id));
  if (!event) notFound();

  const canEdit = can({ role }, "events.write");
  const members = canEdit ? await getOrgMembersForPicker(org.id) : [];
  // The calendar's "Edit" sends people here with the form already open, so
  // one click from a chip lands on a filled-in form rather than a page to
  // read and a button to find.
  const { edit } = await searchParams;
  const startInEdit = (Array.isArray(edit) ? edit[0] : edit) === "1";

  return (
    <EventDetailView
      orgId={org.id}
      orgSlug={orgSlug}
      timeZone={org.timezone}
      event={{
        id: event.id,
        title: event.title,
        description: event.description,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        allDay: event.allDay,
        location: event.location,
        conferenceProvider: event.conferenceProvider,
        conferenceUrl: event.conferenceUrl,
        kind: event.kind,
        visibility: event.visibility,
        hostUserId: event.hostUserId,
        hostName: event.hostName,
        rsvpUrl: event.rsvpUrl,
        capacityFull: event.capacityFull,
        featured: event.featured,
        publicNote: event.publicNote,
        stampSlot: event.stampSlot,
        needsReview: event.needsReview,
        googleSyncState: event.googleSyncState,
        googleHtmlLink: event.googleHtmlLink,
        googleSyncError: canEdit ? event.googleSyncError : null,
        host: event.host,
        attendees: event.attendees.map((a) => ({ userId: a.userId, rsvp: a.rsvp, user: a.user })),
        attendeeIds: event.attendees.map((a) => a.userId),
        notes: event.notes,
      }}
      members={members.map((m) => ({ id: m.id, name: m.name, image: m.image, avatar: m.avatar, title: m.title }))}
      currentUserId={user.id}
      canEdit={canEdit}
      startInEdit={startInEdit}
    />
  );
}
