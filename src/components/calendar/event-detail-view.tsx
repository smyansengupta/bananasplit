"use client";

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
  Trash2,
  Video,
  type IconComponent,
} from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { deleteEvent, rsvpToEvent } from "@/app/app/[orgSlug]/calendar/actions";
import { createNote } from "@/app/app/[orgSlug]/notes/actions";
import { BackLink } from "@/components/back-link";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { BlockCard } from "@/components/ui/block-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusDot } from "@/components/ui/chip";
import { Gauge } from "@/components/ui/meters";
import { IconChip } from "@/components/ui/stat";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toaster";
import { UserAvatar, type UserAvatarUser } from "@/components/user-avatar";
import type { CalendarSyncState, RSVPStatus } from "@/generated/prisma/enums";
import { formatEventWhen } from "@/lib/calendar/format";
import { cn } from "@/lib/utils";

import { KindBadge, SyncBadge, VisibilityBadge } from "./event-badges";
import { EventFormDialog, type EventFormEvent } from "./event-form-dialog";
import { useViewerTimeZone } from "./hooks";
import type { EventTagOption } from "@/lib/calendar/tags";

import { RSVP_META } from "./kinds";
import type { CalendarMember } from "./member-picker";

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
  /** The org's type for it, resolved, for the badge. */
  tag: EventTagOption | null;
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
  tags,
  members,
  rsvp,
  currentUserId,
  canEdit,
  startInEdit = false,
}: {
  orgId: string;
  orgSlug: string;
  timeZone: string;
  event: EventDetail;
  /** The organization's own event types, for the edit dialog. */
  tags: EventTagOption[];
  members: CalendarMember[];
  rsvp: EventRsvpSummary;
  currentUserId: string;
  canEdit: boolean;
  /** Opened from the calendar's "Edit" (?edit=1), so the form is already up. */
  startInEdit?: boolean;
}) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(canEdit && startInEdit);
  const [isPending, startTransition] = useTransition();
  const [confirmEl, confirm] = useConfirm();
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

  async function handleDelete() {
    const ok = await confirm({
      title: `Delete “${event.title}”?`,
      description:
        "Invited members are told it was cancelled. It's removed from synced calendars and the public site too.",
      confirmLabel: "Delete event",
      run: async () => (await deleteEvent(orgId, event.id)).error,
    });
    if (!ok) return;
    toast({ title: "Event deleted", description: event.title });
    router.push(`/app/${orgSlug}/calendar`);
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

  return (
    <div className="mx-auto max-w-5xl space-y-7">
      {confirmEl}
      <BackLink href={`/app/${orgSlug}/calendar`} label="Calendar" />

      <PageHeader
        title={<span className="break-words">{event.title}</span>}
        description={
          <span className="text-foreground font-medium">
            {formatEventWhen(event, { viewer: zone, org: timeZone }, new Date())}
          </span>
        }
        actions={
          canEdit ? (
            <>
              <Button variant="outline" onClick={() => setEditOpen(true)}>
                <Pencil aria-hidden className="size-4" />
                Edit event
              </Button>
              <Button
                variant="destructive"
                onClick={() => void handleDelete()}
                disabled={isPending}
              >
                <Trash2 aria-hidden className="size-4" />
                Delete event
              </Button>
            </>
          ) : null
        }
      />

      <div className="-mt-3 flex flex-wrap gap-1.5">
        <KindBadge tag={event.tag} />
        <VisibilityBadge visibility={event.visibility} />
        {canEdit && <SyncBadge state={event.googleSyncState} href={event.googleHtmlLink} />}
        {event.capacityFull && <Badge variant="destructive">Full</Badge>}
        {event.featured && <Badge variant="accent">Featured</Badge>}
      </div>

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
      {canEdit && event.googleSyncState === "FAILED" && event.googleSyncError && (
        <p
          className="bg-tint-danger text-tint-danger-foreground rounded-field p-3.5 text-sm"
          role="note"
        >
          Google Calendar sync failed: {event.googleSyncError}
        </p>
      )}

      <div className="grid gap-[18px] lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-[18px]">
          <Card>
            <CardContent className="space-y-5">
              {event.description ? (
                <p className="text-[15px] leading-relaxed whitespace-pre-wrap">
                  {event.description}
                </p>
              ) : (
                <p className="text-muted-foreground text-sm">No description yet.</p>
              )}

              {(event.location || hostLabel || event.rsvpUrl || event.publicNote) && (
                <dl className="grid gap-1">
                  {event.location && (
                    <Fact icon={MapPin} label="Where">
                      {event.location}
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
                {event.conferenceUrl && (
                  <Button asChild>
                    <a href={event.conferenceUrl} target="_blank" rel="noopener noreferrer">
                      <Video className="size-4" />
                      Join meeting
                    </a>
                  </Button>
                )}
                <Button variant="outline" asChild>
                  <a href={`/api/calendar/${event.id}/ics`} download>
                    <CalendarPlus className="size-4" />
                    Download .ics
                  </a>
                </Button>
                <Button variant="outline" asChild>
                  <a href={buildGoogleCalendarUrl(event)} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="size-4" />
                    Add to Google Calendar
                  </a>
                </Button>
              </div>
            </CardContent>
          </Card>

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
                <p className="text-muted-foreground text-sm">
                  Nothing yet. Meeting notes made here stay linked to this event.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-[18px]">
          {myAttendance && (
            <BlockCard
              tone="answer"
              kicker={myAttendance.rsvp === "PENDING" ? "Waiting on your answer" : "Your answer"}
              title={
                myAttendance.rsvp === "PENDING"
                  ? "Are you going?"
                  : RSVP_META[myAttendance.rsvp].label
              }
              className="min-h-0"
            >
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
                kicker="RSVP page · Live"
                title="Sign-ups"
                href={`/app/${orgSlug}/calendar/${event.id}/rsvp`}
                figure={rsvp.going}
                figureLabel={`of ${rsvp.capacity} spots${rsvp.waitlist > 0 ? ` · ${rsvp.waitlist} waitlisted` : ""}`}
                aside={<Gauge value={capacityPct} size={132} />}
                className="min-h-0"
              />
            ) : (
              <Card>
                <CardHeader className="flex items-center gap-2">
                  <CardTitle>RSVP page</CardTitle>
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
                              {" "}
                              · {rsvp.waitlist} waitlisted
                            </span>
                          )}
                        </p>
                      )}
                      {rsvp.url && (
                        <a
                          href={rsvp.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-foreground block truncate text-sm underline-offset-4 hover:underline"
                        >
                          {rsvp.url.replace(/^https?:\/\//, "")}
                        </a>
                      )}
                    </>
                  ) : (
                    <p className="text-muted-foreground text-sm leading-relaxed">
                      A public page where anyone with the link signs up, with a waitlist, a map and
                      reminders.
                    </p>
                  )}
                  {canEdit && (
                    <Button
                      asChild
                      variant={rsvp.enabled ? "outline" : "secondary"}
                      className="w-full"
                    >
                      <Link href={`/app/${orgSlug}/calendar/${event.id}/rsvp`}>
                        {rsvp.enabled ? <Settings2 aria-hidden /> : <Ticket aria-hidden />}
                        {rsvp.enabled ? "Manage guests and page" : "Set up an RSVP page"}
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
              {going.length > 0 && <FaceStack people={going.map((a) => a.user)} />}
            </CardHeader>
            <CardContent>
              {event.attendees.length > 0 ? (
                <>
                  <p className="text-muted-foreground mb-3 text-[13px] tabular-nums">
                    {count("YES")} going · {count("MAYBE")} maybe · {count("NO")} not going ·{" "}
                    {count("PENDING")} no answer
                  </p>
                  <ul className="space-y-2">
                    {event.attendees.map((a) => (
                      <li
                        key={a.userId}
                        className="flex items-center justify-between gap-2 text-sm"
                      >
                        <span className="flex min-w-0 items-center gap-2.5">
                          <UserAvatar user={a.user} size="md" />
                          <span className="truncate font-medium">{a.user.name ?? "Member"}</span>
                        </span>
                        <Badge variant={RSVP_BADGE_VARIANT[a.rsvp]}>
                          {RSVP_META[a.rsvp].short}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <EmptyState
                  size="compact"
                  title="Nobody is invited yet"
                  description={
                    canEdit ? "Add members under More details when you edit." : undefined
                  }
                />
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
          tags={tags}
          members={members}
          onDeleted={() => router.push(`/app/${orgSlug}/calendar`)}
        />
      )}
    </div>
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

function Fact({
  icon: Icon,
  label,
  children,
}: {
  icon: IconComponent;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[auto_6rem_minmax(0,1fr)] items-start gap-3 py-1.5 text-sm">
      <Icon aria-hidden className="text-muted-foreground mt-0.5 size-4" />
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium break-words">{children}</dd>
    </div>
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
