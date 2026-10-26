import { notFound } from "next/navigation";

import { EventDetailView } from "@/components/calendar/event-detail-view";
import { appUrl } from "@/lib/app-url";
import { can } from "@/lib/auth/permissions";
import { DEFAULT_REMINDER_MINUTES } from "@/lib/meetings/reminders";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { getOrgMembersForPicker } from "@/server/members";

import { getEventById } from "../queries";

export default async function EventDetailPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/calendar/[eventId]">) {
  const { orgSlug, eventId } = await params;
  const { organization: org, user, role, settings } = await getOrgContextBySlug(orgSlug);
  const canEdit = can({ role }, "events.write");
  const loaded = await withOrgTx(org.id, async ({ db }) => {
    const event = await getEventById(db, org.id, eventId, user.id);
    // Sign-up numbers for owners and admins (RLS shows sign-ups only to them).
    const signups =
      event && canEdit && event.rsvpSlug
        ? await db.eventRegistration.groupBy({
            by: ["status"],
            where: {
              organizationId: org.id,
              eventId: event.id,
              status: { in: ["GOING", "WAITLIST"] },
            },
            _count: { _all: true },
          })
        : [];
    return { event, signups };
  });
  const { event, signups } = loaded;
  if (!event) notFound();
  const countOf = (s: string) => signups.find((r) => r.status === s)?._count._all ?? 0;
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
      defaultReminderMinutes={settings?.meetingReminderMinutes ?? [...DEFAULT_REMINDER_MINUTES]}
      event={{
        id: event.id,
        title: event.title,
        description: event.description,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        allDay: event.allDay,
        location: event.location,
        locationDetails: event.locationDetails,
        conferenceProvider: event.conferenceProvider,
        conferenceUrl: event.conferenceUrl,
        // So the edit form knows a link we made is already there, as on Meetings.
        conferenceManaged: event.conferenceManaged,
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
        reminderMinutes: event.reminderMinutes,
        notes: event.notes,
      }}
      members={members.map((m) => ({
        id: m.id,
        name: m.name,
        image: m.image,
        avatar: m.avatar,
        title: m.title,
      }))}
      rsvp={{
        enabled: event.rsvpEnabled,
        url: event.rsvpSlug && event.rsvpEnabled ? appUrl(`/e/${event.rsvpSlug}`) : null,
        going: countOf("GOING"),
        waitlist: countOf("WAITLIST"),
        capacity: event.rsvpCapacity,
      }}
      currentUserId={user.id}
      canEdit={canEdit}
      startInEdit={startInEdit}
    />
  );
}
