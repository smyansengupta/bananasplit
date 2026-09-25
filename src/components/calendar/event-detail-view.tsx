"use client";

import {
  AlertTriangle,
  CalendarPlus,
  ExternalLink,
  MapPin,
  Mic,
  NotebookText,
  Pencil,
  Ticket,
  Trash2,
  Video,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { deleteEvent, rsvpToEvent } from "@/app/app/[orgSlug]/calendar/actions";
import { createNote } from "@/app/app/[orgSlug]/notes/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UserAvatar, type UserAvatarUser } from "@/components/user-avatar";
import type { CalendarSyncState, RSVPStatus } from "@/generated/prisma/enums";

import { KindBadge, SyncBadge, VisibilityBadge } from "./event-badges";
import { EventFormDialog, type EventFormEvent } from "./event-form-dialog";
import type { CalendarMember } from "./member-picker";
import { formatEventTimeRange } from "./utils";

const RSVP_LABELS: Record<RSVPStatus, string> = {
  PENDING: "Pending",
  YES: "Yes",
  NO: "No",
  MAYBE: "Maybe",
};

const RSVP_BADGE_VARIANT: Record<RSVPStatus, "default" | "destructive" | "secondary" | "outline"> =
  {
    PENDING: "outline",
    YES: "default",
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

export function EventDetailView({
  orgId,
  orgSlug,
  timeZone,
  event,
  members,
  currentUserId,
  canEdit,
}: {
  orgId: string;
  orgSlug: string;
  timeZone: string;
  event: EventDetail;
  members: CalendarMember[];
  currentUserId: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
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

  function handleDelete() {
    if (!window.confirm(`Delete "${event.title}"? Invited members are told it was cancelled.`))
      return;
    startTransition(async () => {
      const result = await deleteEvent(orgId, event.id);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.push(`/app/${orgSlug}/calendar`);
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

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/app/${orgSlug}/calendar`}
            className="text-muted-foreground text-sm hover:underline"
          >
            ← Back to calendar
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight break-words">{event.title}</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {formatEventTimeRange(event.startsAt, event.endsAt, event.allDay, timeZone)}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <KindBadge kind={event.kind} />
            <VisibilityBadge visibility={event.visibility} />
            {canEdit && <SyncBadge state={event.googleSyncState} href={event.googleHtmlLink} />}
            {event.capacityFull && <Badge variant="secondary">Full</Badge>}
            {event.featured && <Badge variant="secondary">Featured</Badge>}
          </div>
        </div>
        {canEdit && (
          <div className="flex shrink-0 gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={() => setEditOpen(true)}
              aria-label="Edit event"
            >
              <Pencil className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={handleDelete}
              disabled={isPending}
              aria-label="Delete event"
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        )}
      </div>

      {event.needsReview && canEdit && (
        <p
          className="border-warning/40 bg-warning/10 flex gap-2 rounded-md border p-3 text-sm"
          role="note"
        >
          <AlertTriangle className="text-warning mt-0.5 size-4 shrink-0" aria-hidden />
          Imported from Google Calendar with more than one possible match. Check whether it
          duplicates another session and merge them in Databases &gt; Sessions.
        </p>
      )}
      {canEdit && event.googleSyncState === "FAILED" && event.googleSyncError && (
        <p className="text-destructive text-sm" role="note">
          Google Calendar sync failed: {event.googleSyncError}
        </p>
      )}

      {event.description && <p className="text-sm whitespace-pre-wrap">{event.description}</p>}

      <div className="space-y-2 text-sm">
        {event.location && (
          <p className="text-muted-foreground flex items-center gap-2">
            <MapPin className="size-4" aria-hidden="true" />
            {event.location}
          </p>
        )}
        {hostLabel && (
          <p className="text-muted-foreground flex items-center gap-2">
            <Mic className="size-4" aria-hidden="true" />
            Hosted by {hostLabel}
          </p>
        )}
        {event.rsvpUrl && (
          <p className="flex items-center gap-2">
            <Ticket className="text-muted-foreground size-4" aria-hidden="true" />
            <a
              href={event.rsvpUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              RSVP link
            </a>
          </p>
        )}
        {event.publicNote && (
          <p className="text-muted-foreground">Website note: {event.publicNote}</p>
        )}
      </div>

      {event.conferenceUrl && (
        <Button asChild>
          <a href={event.conferenceUrl} target="_blank" rel="noopener noreferrer">
            <Video className="size-4" />
            Join meeting
          </a>
        </Button>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" asChild>
          <a href={`/api/calendar/${event.id}/ics`} download>
            <CalendarPlus className="size-4" />
            Download .ics
          </a>
        </Button>
        <Button variant="outline" size="sm" asChild>
          <a href={buildGoogleCalendarUrl(event)} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="size-4" />
            Add to Google Calendar
          </a>
        </Button>
      </div>

      {myAttendance && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Your RSVP</p>
          <div className="flex gap-2">
            {(["YES", "MAYBE", "NO"] as const).map((status) => (
              <Button
                key={status}
                type="button"
                size="sm"
                variant={myAttendance.rsvp === status ? "default" : "outline"}
                disabled={isPending}
                onClick={() => handleRsvp(status)}
              >
                {RSVP_LABELS[status]}
              </Button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Invited ({event.attendees.length})</p>
          <p className="text-muted-foreground text-xs">
            {count("YES")} yes · {count("MAYBE")} maybe · {count("NO")} no · {count("PENDING")}{" "}
            pending
          </p>
        </div>
        <ul className="space-y-1.5">
          {event.attendees.map((a) => (
            <li key={a.userId} className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-2">
                <UserAvatar user={a.user} size="sm" />
                {a.user.name ?? "Member"}
              </span>
              <Badge variant={RSVP_BADGE_VARIANT[a.rsvp]}>{RSVP_LABELS[a.rsvp]}</Badge>
            </li>
          ))}
          {event.attendees.length === 0 && (
            <p className="text-muted-foreground text-sm">No members invited.</p>
          )}
        </ul>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Linked notes</p>
          <Button
            variant="outline"
            size="sm"
            onClick={handleCreateMeetingNotes}
            disabled={isPending}
          >
            <NotebookText className="size-4" />
            Create meeting notes
          </Button>
        </div>
        {event.notes.length > 0 ? (
          <ul className="space-y-1">
            {event.notes.map((note) => (
              <li key={note.id}>
                <Link
                  href={`/app/${orgSlug}/notes/${note.id}`}
                  className="text-primary text-sm hover:underline"
                >
                  {note.title || "Untitled note"}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">No notes linked to this event yet.</p>
        )}
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
          onDeleted={() => router.push(`/app/${orgSlug}/calendar`)}
        />
      )}
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
