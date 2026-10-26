import { notFound } from "next/navigation";

import { EventDetailView } from "@/components/calendar/event-detail-view";
import { MeetingJoinCard } from "@/components/meetings/meeting-join-card";
import { appUrl } from "@/lib/app-url";
import { can } from "@/lib/auth/permissions";
import { CONFERENCE_LABELS, conferenceStatus } from "@/lib/meetings/conference-status";
import { parseDialIn } from "@/lib/meetings/dial-in";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { getOrgMembersForPicker } from "@/server/members";

import { getEventById } from "../../calendar/queries";

/**
 * One meeting, with how to join it (docs/features/meetings.md).
 *
 * The Calendar's event page, shown under Meetings: the same loading and the
 * same detail view, with the join details in place of the plain "Join
 * meeting" button, the place's directions and a map link, and a way back to
 * Meetings rather than the Calendar.
 *
 * The host's start link (`conferenceHostUrl`) is read for everyone, because
 * the event is, and handed on only to someone who can edit the event. It is
 * `null` in the props of anyone else, so it is never in the page they are
 * sent.
 */
export default async function MeetingPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/meetings/[id]">) {
  const { orgSlug, id } = await params;
  const { organization: org, user, role } = await getOrgContextBySlug(orgSlug);
  const canEdit = can({ role }, "events.write");
  const loaded = await withOrgTx(org.id, async ({ db }) => {
    const event = await getEventById(db, org.id, id, user.id);
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
  // "Edit" sends people here with the form already open, as on the Calendar.
  const { edit } = await searchParams;
  const startInEdit = (Array.isArray(edit) ? edit[0] : edit) === "1";

  const joinCard =
    event.conferenceProvider === "NONE" ? undefined : (
      <MeetingJoinCard
        orgId={org.id}
        eventId={event.id}
        providerLabel={CONFERENCE_LABELS[event.conferenceProvider]}
        joinUrl={event.conferenceUrl}
        // The host's own link starts the meeting: only for people who can edit it.
        hostUrl={canEdit ? event.conferenceHostUrl : null}
        passcode={event.conferencePasscode}
        dialIn={parseDialIn(event.conferenceDialIn)}
        status={conferenceStatus(event, canEdit)}
        canEdit={canEdit}
      />
    );

  return (
    <EventDetailView
      orgId={org.id}
      orgSlug={orgSlug}
      timeZone={org.timezone}
      section="meetings"
      joinCard={joinCard}
      locationDetails={event.locationDetails}
      showMapLink={Boolean(event.location)}
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
