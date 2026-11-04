import { notFound } from "next/navigation";

import { EventDetailView } from "@/components/calendar/event-detail-view";
import { RetrySync } from "@/components/calendar/retry-sync";
import { LinkedSection } from "@/components/links/linked-section";
import { CreateMeetingNotes } from "@/components/meetings/create-meeting-notes";
import {
  CarryOver,
  MeetingHeaderAmbient,
  MeetingNotesAmbient,
  RemindMaybes,
  type HeaderKind,
} from "@/components/meetings/meeting-ambient";
import { MeetingTasks, type MeetingTask } from "@/components/meetings/meeting-tasks";
import { MeetingJoinCard } from "@/components/meetings/meeting-join-card";
import { MeetingRecording } from "@/components/meetings/meeting-recording";
import { eventAmbient, needsSyncRetry } from "@/lib/ambient/calendar";
import { meetingAmbient, undecidedMaybes, underWay } from "@/lib/ambient/meetings";
import { appUrl } from "@/lib/app-url";
import { can } from "@/lib/auth/permissions";
import { CONFERENCE_LABELS, conferenceStatus } from "@/lib/meetings/conference-status";
import { parseDialIn } from "@/lib/meetings/dial-in";
import { parseMeetingTypes } from "@/lib/meetings/meeting-types";
import { DEFAULT_REMINDER_MINUTES } from "@/lib/meetings/reminders";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { loadMeetingAmbient } from "@/server/meetings/ambient";
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
  const { organization: org, user, role, settings } = await getOrgContextBySlug(orgSlug);
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
    // Tasks from this meeting: the tasks linked to it either way round.
    const links = event
      ? await db.itemLink.findMany({
          where: {
            organizationId: org.id,
            OR: [
              { fromKind: "event", fromId: event.id, toKind: "task" },
              { toKind: "event", toId: event.id, fromKind: "task" },
            ],
          },
          select: { fromKind: true, fromId: true, toId: true },
        })
      : [];
    const taskIds = links.map((l) => (l.fromKind === "task" ? l.fromId : l.toId));
    const tasks = taskIds.length
      ? await db.task.findMany({
          where: { organizationId: org.id, id: { in: taskIds }, deletedAt: null },
          select: {
            id: true,
            title: true,
            status: true,
            dueDate: true,
            owner: { select: { name: true } },
          },
          orderBy: [{ status: "asc" }, { dueDate: { sort: "asc", nulls: "last" } }],
        })
      : [];
    // What its ambient buttons act on (src/server/meetings/ambient.ts).
    const facts = event
      ? await loadMeetingAmbient(
          db,
          org.id,
          event,
          {
            ids: taskIds,
            tasks: tasks.map((t) => ({ id: t.id, title: t.title, status: t.status })),
          },
          canEdit,
        )
      : null;
    return { event, signups, tasks, facts };
  });
  const { event, signups, tasks, facts } = loaded;
  const dueFmt = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const meetingTasks: MeetingTask[] = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    meta:
      [t.owner?.name?.split(" ")[0], t.dueDate ? dueFmt.format(t.dueDate) : null]
        .filter(Boolean)
        .join(", ") || null,
  }));
  if (!event || !facts) notFound();
  const countOf = (s: string) => signups.find((r) => r.status === s)?._count._all ?? 0;
  const rsvpUrl = event.rsvpSlug && event.rsvpEnabled ? appUrl(`/e/${event.rsvpSlug}`) : null;

  // Its ambient buttons: decided here, from src/lib/ambient, so the first
  // paint and the browser agree. The header gets the first two.
  const now = new Date();
  const whenMeeting = meetingAmbient(
    {
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      timeZone: org.timezone,
      canEdit,
      agenda: event.description,
      openItems: facts.openTasks.length + facts.carryOver.length,
      joinUrl: event.conferenceUrl,
    },
    now,
  );
  const whenEvent = eventAmbient(
    {
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      timeZone: org.timezone,
      canEdit,
      rsvp: {
        enabled: event.rsvpEnabled,
        url: rsvpUrl,
        going: countOf("GOING"),
        waitlist: countOf("WAITLIST"),
        capacity: event.rsvpCapacity,
        waitlistOn: event.rsvpWaitlist,
      },
      checkedIn: facts.checkedIn,
      thankedAt: facts.thankedAt,
      remindedAt: facts.remindedAt,
    },
    now,
  );
  const headerItems: { kind: HeaderKind; reason: string }[] = [
    ...whenMeeting.filter((a) => a.kind !== "draft-agenda"),
    ...whenEvent,
    ...whenMeeting.filter((a) => a.kind === "draft-agenda"),
  ];
  const maybes = undecidedMaybes(
    event.attendees,
    { startsAt: event.startsAt, canEdit, remindedAt: facts.maybesRemindedAt },
    now,
  );
  const meetingOn = underWay(event, now);
  const members = canEdit ? await getOrgMembersForPicker(org.id) : [];
  // "Edit" sends people here with the form already open, as on the Calendar.
  const { edit, rsvp: rsvpParam } = await searchParams;
  // An invite email's Going / Can't go: the answer, ready to confirm.
  const asked = Array.isArray(rsvpParam) ? rsvpParam[0] : rsvpParam;
  const askedRsvp = asked === "YES" || asked === "NO" || asked === "MAYBE" ? asked : null;
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
      linked={
        // The plan's side column: everything tied to the meeting, its notes
        // among them, closed by a dashed "Link something" tile.
        <LinkedSection
          orgId={org.id}
          orgSlug={orgSlug}
          at={{ kind: "event", id: event.id }}
          title="Linked to this meeting"
          closingTile
          // Its tasks are under "Tasks from this meeting", not here as well.
          omitKinds={["task"]}
          fixed={event.notes.map((n) => ({
            key: `note:${n.id}`,
            kind: "note" as const,
            title: n.title || "Untitled note",
            detail: "Meeting notes",
            href: `/app/${orgSlug}/notes/${n.id}`,
          }))}
          actions={
            <CreateMeetingNotes
              orgId={org.id}
              orgSlug={orgSlug}
              eventId={event.id}
              eventTitle={event.title}
            />
          }
        />
      }
      tasks={
        <MeetingTasks
          orgId={org.id}
          orgSlug={orgSlug}
          eventId={event.id}
          initial={meetingTasks}
          ambient={
            meetingOn || (canEdit && facts.todos.length > 0) || facts.decisions.length > 0 ? (
              <MeetingNotesAmbient
                orgId={org.id}
                orgSlug={orgSlug}
                eventId={event.id}
                meetingTitle={event.title}
                underWay={meetingOn}
                todos={canEdit ? facts.todos.length : 0}
                decision={facts.decisions[0] ?? null}
              />
            ) : null
          }
        />
      }
      ambient={
        headerItems.length > 0 ? (
          <MeetingHeaderAmbient
            orgId={org.id}
            orgSlug={orgSlug}
            eventId={event.id}
            title={event.title}
            items={headerItems}
            joinUrl={event.conferenceUrl}
            noteId={facts.noteId}
            rsvpUrl={rsvpUrl}
          />
        ) : null
      }
      agendaAmbient={
        canEdit && facts.carryOver.length > 0 ? (
          <CarryOver orgId={org.id} eventId={event.id} count={facts.carryOver.length} />
        ) : null
      }
      invitedAmbient={
        maybes > 0 ? <RemindMaybes orgId={org.id} eventId={event.id} count={maybes} /> : null
      }
      syncAmbient={
        needsSyncRetry({ googleSyncState: event.googleSyncState, canEdit }) ? (
          <RetrySync orgId={org.id} eventId={event.id} />
        ) : null
      }
      recording={
        // Once it has started there may be a recording to paste or watch.
        event.startsAt <= new Date() ? (
          <MeetingRecording
            orgId={org.id}
            eventId={event.id}
            initial={event.recordingUrl}
            canEdit={canEdit}
          />
        ) : null
      }
      askedRsvp={askedRsvp}
      section="meetings"
      joinCard={joinCard}
      locationDetails={event.locationDetails}
      showMapLink={Boolean(event.location)}
      defaultReminderMinutes={settings?.meetingReminderMinutes ?? [...DEFAULT_REMINDER_MINUTES]}
      meetingTypes={parseMeetingTypes(settings?.eventTypes)}
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
        meetingType: event.meetingType,
        seriesId: event.seriesId,
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
        url: rsvpUrl,
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
