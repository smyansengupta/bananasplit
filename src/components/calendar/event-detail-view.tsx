"use client";

import {
  CalendarPlus,
  ExternalLink,
  MapPin,
  NotebookText,
  Pencil,
  Trash2,
  Video,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { deleteEvent, rsvpToEvent } from "@/app/app/[orgSlug]/calendar/actions";
import type { EventWithRelations } from "@/app/app/[orgSlug]/calendar/queries";
import { createNote } from "@/app/app/[orgSlug]/notes/actions";
import type { OrgMemberOption } from "@/components/tasks/assignee-picker";
import { initials } from "@/components/tasks/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RSVPStatus } from "@/generated/prisma/enums";

import { EventFormDialog } from "./event-form-dialog";
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

export function EventDetailView({
  orgId,
  orgSlug,
  event,
  members,
  currentUserId,
  canEdit,
}: {
  orgId: string;
  orgSlug: string;
  event: EventWithRelations;
  members: OrgMemberOption[];
  currentUserId: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const myAttendance = event.attendees.find((a) => a.userId === currentUserId);
  const breakdown = {
    YES: event.attendees.filter((a) => a.rsvp === RSVPStatus.YES).length,
    NO: event.attendees.filter((a) => a.rsvp === RSVPStatus.NO).length,
    MAYBE: event.attendees.filter((a) => a.rsvp === RSVPStatus.MAYBE).length,
    PENDING: event.attendees.filter((a) => a.rsvp === RSVPStatus.PENDING).length,
  };

  function handleRsvp(rsvp: RSVPStatus) {
    startTransition(async () => {
      await rsvpToEvent(orgId, event.id, rsvp);
      router.refresh();
    });
  }

  function handleDelete() {
    startTransition(async () => {
      await deleteEvent(orgId, event.id);
      router.push(`/app/${orgSlug}/calendar`);
    });
  }

  function handleCreateMeetingNotes() {
    startTransition(async () => {
      const result = await createNote(orgId, {
        title: `${event.title} — meeting notes`,
        eventId: event.id,
      });
      if (result.noteId) {
        router.push(`/app/${orgSlug}/notes/${result.noteId}`);
      }
    });
  }

  const googleCalendarUrl = buildGoogleCalendarUrl(event);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link
            href={`/app/${orgSlug}/calendar`}
            className="text-muted-foreground text-sm hover:underline"
          >
            ← Back to calendar
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{event.title}</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {formatEventTimeRange(event.startsAt, event.endsAt, event.allDay)}
          </p>
        </div>
        {canEdit && (
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" size="icon" onClick={() => setEditOpen(true)}>
              <Pencil className="size-4" />
            </Button>
            <Button variant="outline" size="icon" onClick={handleDelete} disabled={isPending}>
              <Trash2 className="size-4" />
            </Button>
          </div>
        )}
      </div>

      {event.description && <p className="text-sm whitespace-pre-wrap">{event.description}</p>}

      {event.location && (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <MapPin className="size-4" aria-hidden="true" />
          {event.location}
        </p>
      )}

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
          <a href={googleCalendarUrl} target="_blank" rel="noopener noreferrer">
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
          <p className="text-sm font-medium">Attendees ({event.attendees.length})</p>
          <p className="text-muted-foreground text-xs">
            {breakdown.YES} yes · {breakdown.MAYBE} maybe · {breakdown.NO} no · {breakdown.PENDING}{" "}
            pending
          </p>
        </div>
        <ul className="space-y-1.5">
          {event.attendees.map((a) => (
            <li key={a.userId} className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-2">
                <Avatar className="size-6">
                  {a.user.image && <AvatarImage src={a.user.image} alt="" />}
                  <AvatarFallback className="text-[10px]">
                    {initials(a.user.name ?? a.user.email)}
                  </AvatarFallback>
                </Avatar>
                {a.user.name ?? a.user.email}
              </span>
              <Badge variant={RSVP_BADGE_VARIANT[a.rsvp]}>{RSVP_LABELS[a.rsvp]}</Badge>
            </li>
          ))}
          {event.attendees.length === 0 && (
            <p className="text-muted-foreground text-sm">No attendees invited.</p>
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

      <EventFormDialog
        orgId={orgId}
        open={editOpen}
        onOpenChange={setEditOpen}
        event={event}
        members={members}
      />
    </div>
  );
}

function buildGoogleCalendarUrl(event: EventWithRelations): string {
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
