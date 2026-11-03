"use client";

import { meetingTypeColor, type MeetingType } from "@/lib/meetings/meeting-types";
import { TagChip } from "@/components/ui/chip";
import {
  AlertTriangle,
  CalendarPlus,
  ExternalLink,
  MapPin,
  Mic,
  NotebookText,
  Pencil,
  Settings2,
  Ticket,
  Repeat,
  Video,
} from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";

import { extendSeries, rsvpToEvent, updateEvent } from "@/app/app/[orgSlug]/calendar/actions";
import { createNote } from "@/app/app/[orgSlug]/notes/actions";
import { BackLink } from "@/components/back-link";
import { EmptyState } from "@/components/empty-state";
import { MeetingAgenda } from "@/components/meetings/meeting-agenda";
import { ReminderPicker } from "@/components/meetings/reminder-picker";
import { Badge } from "@/components/ui/badge";
import { BlockCard } from "@/components/ui/block-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusDot } from "@/components/ui/chip";
import { Fact } from "@/components/ui/fact";
import { Gauge } from "@/components/ui/meters";
import { IconChip } from "@/components/ui/stat";
import { toast } from "@/components/ui/toaster";
import { UserAvatar, type UserAvatarUser } from "@/components/user-avatar";
import type { CalendarSyncState, RSVPStatus } from "@/generated/prisma/enums";
import { formatEventWhen } from "@/lib/calendar/format";
import { reminderLabel } from "@/lib/meetings/reminders";
import { cn } from "@/lib/utils";

import { KindBadge, SyncBadge, VisibilityBadge } from "./event-badges";
import { KIND_META } from "./kinds";
import { EventFormDialog, type EventFormEvent } from "./event-form-dialog";
import { useViewerTimeZone } from "./hooks";
import { RSVP_META } from "./kinds";
import { MemberMultiPicker, type CalendarMember } from "./member-picker";

/**
 * One event, in full.
 *
 * The grid's popover answers "what is this"; this page answers "who is
 * coming, what was decided, and is it really on Google". It is laid out in
 * two columns on a wide screen so the answer to the second question is
 * beside the event rather than a scroll below it, and stacks on a phone.
 */

const RSVP_BADGE_VARIANT: Record<RSVPStatus, "success" | "destructive" | "secondary" | "outline"> =
  {
    PENDING: "outline",
    YES: "success",
    NO: "destructive",
    MAYBE: "secondary",
  };

export interface EventDetail extends EventFormEvent {
  needsReview: boolean;
  googleSyncState: CalendarSyncState;
  googleHtmlLink: string | null;
  /** Admins only. */
  googleSyncError: string | null;
  host: (UserAvatarUser & { id: string }) | null;
  attendees: { userId: string; rsvp: RSVPStatus; user: UserAvatarUser & { id: string } }[];
  notes: { id: string; title: string | null }[];
}

export interface EventRsvpSummary {
  enabled: boolean;
  /** The public page, while it's on. */
  url: string | null;
  /** Owners and admins only (0 for everyone else). */
  going: number;
  waitlist: number;
  capacity: number | null;
}

export function EventDetailView({
  orgId,
  orgSlug,
  timeZone,
  event,
  members,
  rsvp,
  currentUserId,
  canEdit,
  startInEdit = false,
  section = "calendar",
  joinCard,
  locationDetails = null,
  showMapLink = false,
  defaultReminderMinutes,
  meetingTypes,
  linked = null,
  tasks = null,
  recording = null,
  askedRsvp = null,
  ambient = null,
  agendaAmbient = null,
  invitedAmbient = null,
  syncAmbient = null,
}: {
  /** Its ambient buttons (components/meetings/meeting-ambient), under the header. */
  ambient?: ReactNode;
  /** The agenda's (Carry them over), under its heading. */
  agendaAmbient?: ReactNode;
  /** The Invited card's (Remind maybes). */
  invitedAmbient?: ReactNode;
  /** Retry sync, beside the "sync failed" note. */
  syncAmbient?: ReactNode;
  /** The answer an invite email's button asked for (?rsvp=): ready to confirm. */
  askedRsvp?: "YES" | "NO" | "MAYBE" | null;
  /** The Linked panel (components/links), first in the side column. */
  linked?: React.ReactNode;
  /** Tasks from this meeting (components/meetings/meeting-tasks), under the notes. */
  tasks?: React.ReactNode;
  /** Its recording (components/meetings/meeting-recording), under the agenda. */
  recording?: React.ReactNode;
  orgId: string;
  orgSlug: string;
  timeZone: string;
  event: EventDetail;
  members: CalendarMember[];
  rsvp: EventRsvpSummary;
  currentUserId: string;
  canEdit: boolean;
  /** Opened from the calendar's "Edit" (?edit=1), so the form is already up. */
  startInEdit?: boolean;
  /**
   * Which section this page is shown in: where the back link goes, and where
   * Delete returns to. A meeting's own page (/meetings/{id}) is "meetings".
   */
  section?: "calendar" | "meetings";
  /**
   * A meeting's join details (MeetingJoinCard). Replaces the plain "Join
   * meeting" button, and is shown even before the link exists, so the page
   * can say it is on its way.
   */
  joinCard?: ReactNode;
  /** How to find the place, in the host's words ("Second floor, past the elevators"). */
  locationDetails?: string | null;
  /** Offer "Open in Maps" under the place. */
  showMapLink?: boolean;
  /** The organization's reminder times, which the edit form compares this event's with. */
  defaultReminderMinutes?: number[];
  /** The organization's meeting types, offered when editing. */
  meetingTypes?: MeetingType[];
}) {
  const router = useRouter();
  // The list this page belongs to: the back link, and where a delete lands.
  const sectionHref = `/app/${orgSlug}/${section}`;
  const [editOpen, setEditOpen] = useState(canEdit && startInEdit);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const myAttendance = event.attendees.find((a) => a.userId === currentUserId);
  const count = (s: RSVPStatus) => event.attendees.filter((a) => a.rsvp === s).length;

  function handleRsvp(rsvp: RSVPStatus) {
    startTransition(async () => {
      const result = await rsvpToEvent(orgId, event.id, rsvp);
      if (result.error) setError(result.error);
      router.refresh();
    });
  }

  /**
   * "Again next week" (the plan's wording): the same meeting a week later, as
   * a linked series. A meeting already in a series adds four more weeks.
   */
  function handleRepeat() {
    startTransition(async () => {
      const result = await extendSeries(orgId, event.id, event.seriesId ? 4 : 1);
      if (result.error) {
        setError(result.error);
        return;
      }
      toast({ title: result.added === 1 ? "Added 1 week" : `Added ${result.added ?? 0} weeks` });
      router.refresh();
    });
  }

  function handleCreateMeetingNotes() {
    startTransition(async () => {
      const result = await createNote(orgId, {
        title: `${event.title} — meeting notes`,
        eventId: event.id,
      });
      if (result.noteId) router.push(`/app/${orgSlug}/notes/${result.noteId}`);
    });
  }

  const hostLabel = event.host?.name ?? event.hostName;
  const zone = useViewerTimeZone(timeZone);
  const going = event.attendees.filter((a) => a.rsvp === "YES");
  const capacityPct = rsvp.capacity ? (rsvp.going / rsvp.capacity) * 100 : 0;
  // Who's coming, at a glance in the header: sign-ups when the meeting takes
  // them, else invitees who said yes.
  const goingCount = rsvp.enabled ? rsvp.going : going.length;
  // Its type's colour: the organization's meeting type, else its kind's.
  const typeColor =
    (event.meetingType ? meetingTypeColor(meetingTypes ?? [], event.meetingType) : null) ??
    `var(${KIND_META[event.kind].token})`;
  // A meeting with no call (stored as In person), on its own page, for those who can edit it.
  const canAddCall = section === "meetings" && canEdit && event.conferenceProvider === "NONE";

  return (
    <div className="mx-auto max-w-5xl space-y-7">
      <BackLink href={sectionHref} label={section === "meetings" ? "Meetings" : "Calendar"} />

      {/* The plan's meeting header: a date tile beside the title, one line of
          when and where, and the chips that matter (its type, your part, who's
          coming). */}
      <header className="flex flex-wrap items-start gap-4">
        <DateTile startsAt={event.startsAt} timeZone={zone} color={typeColor} />
        <div className="min-w-0 flex-1 space-y-1.5">
          <h1 className="page-title break-words">{event.title}</h1>
          <p className="text-foreground text-[15px] font-medium">
            {formatEventWhen(event, { viewer: zone, org: timeZone }, new Date())}
            {event.location && (
              <>
                , <span>{event.location}</span>
              </>
            )}
            {event.location && showMapLink && (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location)}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open in Maps"
                className="text-muted-foreground hover:text-foreground ms-2 inline-flex items-center gap-1 text-[13px] font-normal underline-offset-4 hover:underline"
              >
                <ExternalLink aria-hidden className="size-3.5" />
                Map
              </a>
            )}
          </p>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {event.meetingType ? (
              <TagChip color={typeColor}>{event.meetingType}</TagChip>
            ) : (
              <KindBadge kind={event.kind} />
            )}
            {event.host?.id === currentUserId && <Badge variant="info">You&apos;re hosting</Badge>}
            {goingCount > 0 && <Badge variant="success">{goingCount} going</Badge>}
            {event.visibility === "PUBLIC" && <VisibilityBadge visibility={event.visibility} />}
            {canEdit && event.googleSyncState !== "NOT_APPLICABLE" && (
              <SyncBadge state={event.googleSyncState} href={event.googleHtmlLink} />
            )}
            {event.capacityFull && <Badge variant="destructive">Full</Badge>}
            {event.featured && <Badge variant="accent">Featured</Badge>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canEdit ? (
            <>
              {/* Delete is in the form, with Undo; one place, not two. */}
              <Button variant="outline" onClick={handleRepeat} disabled={isPending}>
                <Repeat aria-hidden className="size-4" />
                {event.seriesId ? "Add 4 weeks" : "Again next week"}
              </Button>
              <Button variant="outline" onClick={() => setEditOpen(true)}>
                <Pencil aria-hidden className="size-4" />
                Edit
              </Button>
            </>
          ) : null}
        </div>
      </header>
      {/* On the day, the door list is one click away: Open door check-in is here. */}
      {ambient}

      {event.needsReview && canEdit && (
        <p
          className="bg-tint-accent text-foreground rounded-field flex gap-2.5 p-3.5 text-sm"
          role="note"
        >
          <AlertTriangle
            className="text-tint-accent-foreground mt-0.5 size-4 shrink-0"
            aria-hidden
          />
          Imported from Google Calendar with more than one possible match. Check whether it
          duplicates another session and merge them in Databases &gt; Sessions.
        </p>
      )}
      {canEdit && event.googleSyncState === "FAILED" && (event.googleSyncError || syncAmbient) && (
        <div
          className="bg-tint-danger text-tint-danger-foreground rounded-field flex flex-wrap items-center gap-3 p-3.5 text-sm"
          role="note"
        >
          <span className="min-w-0 flex-1">
            Google Calendar sync failed{event.googleSyncError ? `: ${event.googleSyncError}` : "."}
          </span>
          {syncAmbient}
        </div>
      )}

      {/* On a phone the two columns fold into one list (display: contents),
          with the Linked panel first, right under the header, as the plan has it. */}
      <div className="flex flex-col gap-[18px] lg:grid lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="max-lg:contents lg:space-y-[18px]">
          <Card>
            <CardContent className="space-y-5">
              <MeetingAgenda
                orgId={orgId}
                orgSlug={orgSlug}
                eventId={event.id}
                initial={event.description}
                canEdit={canEdit}
                aside={agendaAmbient}
              />
              {recording}

              {(locationDetails || hostLabel || event.rsvpUrl || event.publicNote) && (
                <dl className="grid gap-1">
                  {event.location && locationDetails && (
                    <Fact icon={MapPin} label="How to find it">
                      <span className="block whitespace-pre-wrap">{locationDetails}</span>
                    </Fact>
                  )}
                  {hostLabel && (
                    <Fact icon={Mic} label="Host">
                      {hostLabel}
                    </Fact>
                  )}
                  {event.rsvpUrl && (
                    <Fact icon={Ticket} label="RSVP link">
                      <a
                        href={event.rsvpUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="break-all underline-offset-4 hover:underline"
                      >
                        {event.rsvpUrl}
                      </a>
                    </Fact>
                  )}
                  {event.publicNote && (
                    <Fact icon={AlertTriangle} label="Website note">
                      {event.publicNote}
                    </Fact>
                  )}
                </dl>
              )}

              <div className="flex flex-wrap gap-2">
                {joinCard ??
                  (event.conferenceUrl && (
                    <Button asChild>
                      <a href={event.conferenceUrl} target="_blank" rel="noopener noreferrer">
                        <Video className="size-4" />
                        Join meeting
                      </a>
                    </Button>
                  ))}
                {/* An in-person meeting can gain its call later: the edit form asks for it. */}
                {canAddCall && (
                  <Button variant="secondary" onClick={() => setEditOpen(true)}>
                    <Video aria-hidden className="size-4" />
                    Add a video call
                  </Button>
                )}
                <Button variant="outline" asChild>
                  <a href={`/api/calendar/${event.id}/ics`} download>
                    <CalendarPlus className="size-4" />
                    Apple / Outlook
                  </a>
                </Button>
                <Button variant="outline" asChild>
                  <a href={buildGoogleCalendarUrl(event)} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="size-4" />
                    Google Calendar
                  </a>
                </Button>
              </div>
            </CardContent>
          </Card>

          {section === "meetings" && (
            <RemindersCard
              orgId={orgId}
              eventId={event.id}
              minutes={event.reminderMinutes}
              canEdit={canEdit}
            />
          )}

          {!linked && (
            <Card>
              <CardHeader className="flex flex-wrap items-center gap-2">
                <CardTitle>Linked notes</CardTitle>
                {event.notes.length > 0 && <Badge variant="secondary">{event.notes.length}</Badge>}
                <span className="flex-1" />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCreateMeetingNotes}
                  disabled={isPending}
                >
                  <NotebookText className="size-4" />
                  Create meeting notes
                </Button>
              </CardHeader>
              <CardContent>
                {event.notes.length > 0 ? (
                  <ul className="-mx-2">
                    {event.notes.map((note) => (
                      <li key={note.id}>
                        <Link
                          href={`/app/${orgSlug}/notes/${note.id}`}
                          className="hover:bg-muted rounded-tile flex items-center gap-3 px-2 py-2 text-sm font-medium transition-colors"
                        >
                          <IconChip icon={NotebookText} />
                          {note.title || "Untitled note"}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground text-sm">No notes yet.</p>
                )}
              </CardContent>
            </Card>
          )}
          {tasks}
        </div>

        <aside className="max-lg:contents lg:space-y-[18px]">
          {linked && <div className="max-lg:order-first">{linked}</div>}
          {myAttendance && (
            <BlockCard
              tone="answer"
              title={
                myAttendance.rsvp === "PENDING"
                  ? "Are you going?"
                  : RSVP_META[myAttendance.rsvp].label
              }
              className="min-h-0"
            >
              {/* From the invite email's Going / Can't go: one click to say so. */}
              {askedRsvp && myAttendance.rsvp !== askedRsvp && (
                <button
                  type="button"
                  autoFocus
                  disabled={isPending}
                  onClick={() => handleRsvp(askedRsvp)}
                  className="bg-block-answer-foreground text-block-answer relative z-10 mt-3 h-10 w-full rounded-full text-sm font-semibold transition-transform active:scale-[0.98] disabled:opacity-60"
                >
                  Confirm: {RSVP_META[askedRsvp].label}
                </button>
              )}
              <div className="relative z-10 mt-4 flex gap-1.5" role="group" aria-label="Your RSVP">
                {(["YES", "MAYBE", "NO"] as const).map((status) => {
                  const on = myAttendance.rsvp === status;
                  return (
                    <button
                      key={status}
                      type="button"
                      aria-pressed={on}
                      disabled={isPending}
                      onClick={() => handleRsvp(status)}
                      className={cn(
                        "h-8 flex-1 rounded-full text-[13px] font-semibold transition-[background-color,transform] active:scale-[0.97] disabled:opacity-60",
                        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current",
                        on
                          ? "bg-block-answer-foreground text-block-answer"
                          : "bg-block-answer-foreground/10 hover:bg-block-answer-foreground/20",
                      )}
                    >
                      {RSVP_META[status].short}
                    </button>
                  );
                })}
              </div>
            </BlockCard>
          )}

          {(canEdit || rsvp.url) &&
            (rsvp.enabled && canEdit && rsvp.capacity ? (
              <BlockCard
                tone="goal"
                title="Sign-ups"
                href={`/app/${orgSlug}/meetings/${event.id}/rsvp`}
                figure={rsvp.going}
                figureLabel={`of ${rsvp.capacity} spots${rsvp.waitlist > 0 ? `, ${rsvp.waitlist} waitlisted` : ""}`}
                aside={<Gauge value={capacityPct} size={132} />}
                className="min-h-0"
              />
            ) : (
              <Card>
                <CardHeader className="flex items-center gap-2">
                  <CardTitle>Sign-ups</CardTitle>
                  <span className="flex-1" />
                  {rsvp.enabled ? (
                    <StatusDot color="var(--success)">Live</StatusDot>
                  ) : (
                    canEdit && <Badge variant="secondary">Off</Badge>
                  )}
                </CardHeader>
                <CardContent className="space-y-3">
                  {rsvp.enabled ? (
                    <>
                      {canEdit && (
                        <p className="text-sm tabular-nums">
                          <span className="numeral text-[26px]">{rsvp.going}</span>{" "}
                          <span className="text-muted-foreground">going</span>
                          {rsvp.waitlist > 0 && (
                            <span className="text-muted-foreground">
                              , {rsvp.waitlist} waitlisted
                            </span>
                          )}
                        </p>
                      )}
                      {rsvp.url && (
                        <a
                          href={rsvp.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-foreground block text-sm break-all underline-offset-4 hover:underline"
                        >
                          {rsvp.url.replace(/^https?:\/\//, "")}
                        </a>
                      )}
                    </>
                  ) : (
                    <p className="text-muted-foreground text-sm">
                      Anyone with the link can sign up.
                    </p>
                  )}
                  {canEdit && (
                    <Button
                      asChild
                      variant={rsvp.enabled ? "outline" : "secondary"}
                      className="w-full"
                    >
                      <Link href={`/app/${orgSlug}/meetings/${event.id}/rsvp`}>
                        {rsvp.enabled ? <Settings2 aria-hidden /> : <Ticket aria-hidden />}
                        {rsvp.enabled ? "Guests and page" : "Add a sign-up page"}
                      </Link>
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}

          <Card>
            <CardHeader className="flex items-center gap-2">
              <CardTitle>Invited</CardTitle>
              <Badge variant="secondary">{event.attendees.length}</Badge>
              <span className="flex-1" />
              {!canEdit && going.length > 0 && <FaceStack people={going.map((a) => a.user)} />}
            </CardHeader>
            <CardContent>
              {canEdit && (
                // The picker shows who's invited itself, so it gets the card's
                // full width rather than a corner of the header.
                <div className="mb-3">
                  <InviteButton
                    orgId={orgId}
                    eventId={event.id}
                    members={members}
                    invited={event.attendees.map((a) => a.userId)}
                  />
                </div>
              )}
              {invitedAmbient && <div className="mb-3">{invitedAmbient}</div>}
              {event.attendees.length > 0 ? (
                <>
                  <p className="text-muted-foreground mb-3 text-[13px] tabular-nums">
                    {[
                      count("YES") > 0 && `${count("YES")} going`,
                      count("MAYBE") > 0 && `${count("MAYBE")} maybe`,
                      count("NO") > 0 && `${count("NO")} not going`,
                      count("PENDING") > 0 && `${count("PENDING")} no answer`,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                  </p>
                  <ul className="space-y-2">
                    {event.attendees.map((a) => (
                      <li
                        key={a.userId}
                        className="flex items-center justify-between gap-2 text-sm"
                      >
                        <span className="flex min-w-0 items-center gap-2.5">
                          <UserAvatar user={a.user} size="md" />
                          <span className="font-medium break-words">{a.user.name ?? "Member"}</span>
                        </span>
                        <Badge variant={RSVP_BADGE_VARIANT[a.rsvp]}>
                          {RSVP_META[a.rsvp].short}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <EmptyState size="compact" title="Nobody is invited yet" />
              )}
            </CardContent>
          </Card>
        </aside>
      </div>

      {error && (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      )}

      {canEdit && (
        <EventFormDialog
          orgId={orgId}
          timeZone={timeZone}
          open={editOpen}
          onOpenChange={setEditOpen}
          event={event}
          members={members}
          defaultReminderMinutes={defaultReminderMinutes}
          meetingTypes={meetingTypes}
          onDeleted={() => router.push(sectionHref)}
        />
      )}
    </div>
  );
}

/**
 * When this meeting reminds people: the times, or "No reminders". Whoever can
 * edit the meeting can change them here without opening the whole form, with
 * the same picker the form has. Saving sends only the reminders, so nothing
 * else about the meeting is touched.
 */
function RemindersCard({
  orgId,
  eventId,
  minutes,
  canEdit,
}: {
  orgId: string;
  eventId: string;
  minutes: number[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState<number[]>(minutes);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // A chip saves as it's tapped; there is no Edit, Save or Cancel.
  function change(next: number[]) {
    const before = value;
    setValue(next);
    setError(null);
    startTransition(async () => {
      const result = await updateEvent(orgId, eventId, { reminderMinutes: next });
      if (result?.error) {
        setValue(before);
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  const labels = [...value].sort((a, b) => b - a).map(reminderLabel);

  return (
    <Card>
      <CardHeader className="flex items-center gap-2">
        <CardTitle>Reminders</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {canEdit ? (
          <>
            <ReminderPicker value={value} onChange={change} />
            {error && (
              <p className="text-destructive text-sm" role="alert">
                {error}
              </p>
            )}
          </>
        ) : labels.length > 0 ? (
          <p className="text-sm">{labels.join(", ")}</p>
        ) : (
          <p className="text-muted-foreground text-sm">No reminders</p>
        )}
        {isPending && <span className="sr-only">Saving</span>}
      </CardContent>
    </Card>
  );
}

/**
 * Invite members straight from the Invited card: the picker saves as you
 * pick (only the invite list is sent), instead of opening the whole form.
 */
function InviteButton({
  orgId,
  eventId,
  members,
  invited,
}: {
  orgId: string;
  eventId: string;
  members: CalendarMember[];
  invited: string[];
}) {
  const router = useRouter();
  const [ids, setIds] = useState<string[]>(invited);
  const [, startTransition] = useTransition();
  return (
    <MemberMultiPicker
      members={members}
      selectedIds={ids}
      placeholder="Invite"
      onChange={(next) => {
        const before = ids;
        setIds(next);
        startTransition(async () => {
          const result = await updateEvent(orgId, eventId, { attendeeIds: next });
          if (result?.error) {
            setIds(before);
            toast({ title: result.error, tone: "error" });
            return;
          }
          router.refresh();
        });
      }}
    />
  );
}

/** Who's going: three faces, then "+N", ringed in the card colour. */
export function FaceStack({ people, className }: { people: UserAvatarUser[]; className?: string }) {
  const shown = people.slice(0, 3);
  const names = people.map((p) => p.name ?? "Member").join(", ");
  return (
    <span className={cn("flex items-center", className)} title={names}>
      <span className="sr-only">Going: {names}</span>
      <span aria-hidden className="flex -space-x-2">
        {shown.map((p, i) => (
          <UserAvatar key={i} user={p} size="sm" className="ring-card ring-2" />
        ))}
        {people.length > 3 && (
          <span className="bg-muted text-muted-foreground ring-card relative grid size-6 place-items-center rounded-full text-[10px] font-bold tabular-nums ring-2">
            +{people.length - 3}
          </span>
        )}
      </span>
    </span>
  );
}

function buildGoogleCalendarUrl(event: EventDetail): string {
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: `${fmt(event.startsAt)}/${fmt(event.endsAt)}`,
  });
  if (event.description) params.set("details", event.description);
  if (event.location) params.set("location", event.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

const TILE_MONTH = (timeZone: string) =>
  new Intl.DateTimeFormat("en-US", { month: "short", timeZone });
const TILE_DAY = (timeZone: string) =>
  new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone });

/** The plan's date tile: the month over the day, on a wash of the meeting type's colour. */
function DateTile({
  startsAt,
  timeZone,
  color,
}: {
  startsAt: Date;
  timeZone: string;
  color: string;
}) {
  return (
    <span
      aria-hidden="true"
      style={{
        ["--kind" as string]: color,
        background: "color-mix(in oklab, var(--kind) 14%, var(--card))",
        color: "color-mix(in oklab, var(--kind) 70%, var(--foreground))",
      }}
      className="rounded-tile grid w-16 shrink-0 place-items-center py-2 leading-none"
    >
      <span className="text-[11px] font-bold tracking-wide uppercase">
        {TILE_MONTH(timeZone).format(startsAt)}
      </span>
      <span className="font-heading mt-1 text-[28px]">{TILE_DAY(timeZone).format(startsAt)}</span>
    </span>
  );
}
