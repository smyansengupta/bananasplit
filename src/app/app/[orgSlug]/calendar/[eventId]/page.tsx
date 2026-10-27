import { notFound } from "next/navigation";

import { EventDetailView, type EventTab } from "@/components/calendar/event-detail-view";
import { appUrl } from "@/lib/app-url";
import { can } from "@/lib/auth/permissions";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { resolveOrgMailRouting } from "@/server/email/mailer";
import { listEventTags } from "@/server/events/tags";
import { getOrgMembersForPicker } from "@/server/members";
import { loadRsvpManager } from "@/server/rsvp/manage";
import { smsDelivery } from "@/server/sms";

import { getEventById } from "../queries";

const TABS = new Set<EventTab>(["details", "guests", "page"]);

export default async function EventDetailPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/calendar/[eventId]">) {
  const { orgSlug, eventId } = await params;
  const { organization: org, user, role } = await getOrgContextBySlug(orgSlug);
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
    return { event, signups, tags: await listEventTags(db, org.id) };
  });
  const { event, signups, tags } = loaded;
  if (!event) notFound();
  const countOf = (s: string) => signups.find((r) => r.status === s)?._count._all ?? 0;
  const members = canEdit ? await getOrgMembersForPicker(org.id) : [];
  // The calendar's "Edit" sends people here with the form already open, so
  // one click from a chip lands on a filled-in form rather than a page to
  // read and a button to find.
  const { edit, tab } = await searchParams;
  const startInEdit = (Array.isArray(edit) ? edit[0] : edit) === "1";
  const asked = Array.isArray(tab) ? tab[0] : tab;

  // The sign-up page's guests and settings are sections of this page now, so
  // they load with it — but only for admins, and only once there is a page
  // (or someone signed up before it was switched off) to show.
  const section =
    canEdit && (event.rsvpEnabled || event.rsvpSlug)
      ? await withOrgTx(org.id, ({ db }) => loadRsvpManager(db, org.id, event.id, org.timezone))
      : null;
  const mail = section ? await resolveOrgMailRouting(org.id) : null;

  return (
    <EventDetailView
      orgId={org.id}
      orgSlug={orgSlug}
      timeZone={org.timezone}
      event={{
        id: event.id,
        title: event.title,
        tag: event.tag,
        description: event.description,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        allDay: event.allDay,
        location: event.location,
        conferenceProvider: event.conferenceProvider,
        conferenceUrl: event.conferenceUrl,
        tagId: event.tagId,
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
      rsvpSection={
        section && mail
          ? {
              ...section.props,
              messaging: {
                email: mail.mode === "org" ? "org" : "platform",
                texts: smsDelivery() === "live",
              },
              links: {
                back: { href: `/app/${orgSlug}/calendar`, label: "Calendar" },
                edit: `/app/${orgSlug}/calendar/${event.id}?edit=1`,
                door: `/app/${orgSlug}/calendar/${event.id}/rsvp/door`,
                flyer: `/e/${section.event.rsvpSlug}/flyer`,
              },
              door: `/app/${orgSlug}/calendar/${event.id}/rsvp/door`,
              flyer: `/e/${section.event.rsvpSlug}/flyer`,
            }
          : null
      }
      tab={asked && TABS.has(asked as EventTab) ? (asked as EventTab) : "details"}
      tags={tags}
      currentUserId={user.id}
      canEdit={canEdit}
      startInEdit={startInEdit}
    />
  );
}
