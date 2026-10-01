"use client";

import {
  AlertTriangle,
  ArrowLeft,
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
import { useConfirm } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toaster";
import { UserAvatar, type UserAvatarUser } from "@/components/user-avatar";
import type { CalendarSyncState, RSVPStatus } from "@/generated/prisma/enums";

import { KindBadge, SyncBadge, VisibilityBadge } from "./event-badges";
import { EventFormDialog, type EventFormEvent } from "./event-form-dialog";
import { RSVP_META } from "./kinds";
import type { CalendarMember } from "./member-picker";
import { formatEventTimeRange } from "./utils";

/**
 * One event, in full.
 *
 * The grid's popover answers "what is this"; this page answers "who is
 * coming, what was decided, and is it really on Google". It is laid out in
 * two columns on a wide screen so the answer to the second question is
 * beside the event rather than a scroll below it, and stacks on a phone.
 */

const RSVP_BADGE_VARIANT: Record<RSVPStatus, "default" | "destructive" | "secondary" | "outline"> = {
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
  startInEdit = false,
}: {
  orgId: string;
  orgSlug: string;
  timeZone: string;
  event: EventDetail;
  members: CalendarMember[];
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
      description: "Invited members are told it was cancelled. It's removed from synced calendars and the public site too.",
      confirmLabel: "Delete event",
      run: async () => (await deleteEvent(orgId, event.id)).error,
    });
    if (!ok) return;
    toast({ title: "Event deleted", description: event.title });
    router.push(`/app/${orgSlug}/calendar`);
  }

  function handleCreateMeetingNotes() {
    startTransition(async () => {
      const result = await createNote(orgId, { title: `${event.title} — meeting notes`, eventId: event.id });
      if (result.noteId) router.push(`/app/${orgSlug}/notes/${result.noteId}`);
    });
  }

  const hostLabel = event.host?.name ?? event.hostName;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {confirmEl}
      <Link
        href={`/app/${orgSlug}/calendar`}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Back to calendar
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight break-words">{event.title}</h1>
          <p className="mt-1.5 text-sm font-medium">
            {formatEventTimeRange(event.startsAt, event.endsAt, event.allDay, timeZone)}
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <KindBadge kind={event.kind} />
            <VisibilityBadge visibility={event.visibility} />
            {canEdit && <SyncBadge state={event.googleSyncState} href={event.googleHtmlLink} />}
            {event.capacityFull && <Badge variant="secondary">Full</Badge>}
            {event.featured && <Badge variant="secondary">Featured</Badge>}
          </div>
        </div>
        {canEdit && (
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              <Pencil aria-hidden className="size-4" />
              Edit
            </Button>
            <Button variant="outline" size="icon" onClick={() => void handleDelete()} disabled={isPending} aria-label="Delete event">
              <Trash2 className="size-4" />
            </Button>
          </div>
        )}
      </header>

      {event.needsReview && canEdit && (
        <p className="border-warning/40 bg-warning/10 flex gap-2 rounded-md border p-3 text-sm" role="note">
          <AlertTriangle className="text-warning mt-0.5 size-4 shrink-0" aria-hidden />
          Imported from Google Calendar with more than one possible match. Check whether it duplicates another
          session and merge them in Databases &gt; Sessions.
        </p>
      )}
      {canEdit && event.googleSyncState === "FAILED" && event.googleSyncError && (
        <p className="text-destructive text-sm" role="note">
          Google Calendar sync failed: {event.googleSyncError}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="space-y-5">
          {event.description && <p className="text-sm leading-relaxed whitespace-pre-wrap">{event.description}</p>}

          {(event.location || hostLabel || event.rsvpUrl || event.publicNote) && (
            <dl className="divide-border grid gap-0 divide-y rounded-lg border text-sm">
              {event.location && (
                <Fact icon={<MapPin aria-hidden className="size-4" />} label="Where">
                  {event.location}
                </Fact>
              )}
              {hostLabel && (
                <Fact icon={<Mic aria-hidden className="size-4" />} label="Host">
                  {hostLabel}
                </Fact>
              )}
              {event.rsvpUrl && (
                <Fact icon={<Ticket aria-hidden className="size-4" />} label="RSVP link">
                  <a
                    href={event.rsvpUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary break-all hover:underline"
                  >
                    {event.rsvpUrl}
                  </a>
                </Fact>
              )}
              {event.publicNote && (
                <Fact icon={<AlertTriangle aria-hidden className="size-4" />} label="Website note">
                  {event.publicNote}
                </Fact>
              )}
            </dl>
          )}

          <div className="flex flex-wrap gap-2">
            {event.conferenceUrl && (
              <Button asChild size="sm">
                <a href={event.conferenceUrl} target="_blank" rel="noopener noreferrer">
                  <Video className="size-4" />
                  Join meeting
                </a>
              </Button>
            )}
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

          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-medium">Linked notes</h2>
              <Button variant="outline" size="sm" onClick={handleCreateMeetingNotes} disabled={isPending}>
                <NotebookText className="size-4" />
                Create meeting notes
              </Button>
            </div>
            {event.notes.length > 0 ? (
              <ul className="space-y-1">
                {event.notes.map((note) => (
                  <li key={note.id}>
                    <Link href={`/app/${orgSlug}/notes/${note.id}`} className="text-primary text-sm hover:underline">
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
          </section>
        </div>

        <aside className="space-y-5">
          {myAttendance && (
            <section className="bg-muted/40 space-y-2 rounded-lg border p-3">
              <h2 className="text-sm font-medium">Your RSVP</h2>
              <div className="flex gap-2" role="group" aria-label="Your RSVP">
                {(["YES", "MAYBE", "NO"] as const).map((status) => (
                  <Button
                    key={status}
                    type="button"
                    size="sm"
                    className="flex-1"
                    variant={myAttendance.rsvp === status ? "default" : "outline"}
                    aria-pressed={myAttendance.rsvp === status}
                    disabled={isPending}
                    onClick={() => handleRsvp(status)}
                  >
                    {RSVP_META[status].short}
                  </Button>
                ))}
              </div>
            </section>
          )}

          <section className="space-y-2">
            <h2 className="text-sm font-medium">Invited ({event.attendees.length})</h2>
            {event.attendees.length > 0 ? (
              <>
                <p className="text-muted-foreground text-xs tabular-nums">
                  {count("YES")} going · {count("MAYBE")} maybe · {count("NO")} not going · {count("PENDING")} no answer
                </p>
                <ul className="space-y-1.5">
                  {event.attendees.map((a) => (
                    <li key={a.userId} className="flex items-center justify-between gap-2 text-sm">
                      <span className="flex min-w-0 items-center gap-2">
                        <UserAvatar user={a.user} size="sm" />
                        <span className="truncate">{a.user.name ?? "Member"}</span>
                      </span>
                      <Badge variant={RSVP_BADGE_VARIANT[a.rsvp]}>{RSVP_META[a.rsvp].short}</Badge>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-muted-foreground text-sm">
                Nobody is invited yet.{canEdit && " Add members under More details when you edit."}
              </p>
            )}
          </section>
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
          onDeleted={() => router.push(`/app/${orgSlug}/calendar`)}
        />
      )}
    </div>
  );
}

function Fact({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[auto_5.5rem_minmax(0,1fr)] items-start gap-3 px-3 py-2.5">
      <span className="text-muted-foreground mt-0.5">{icon}</span>
      <dt className="text-muted-foreground mt-0.5 text-xs font-medium tracking-wide uppercase">{label}</dt>
      <dd className="break-words">{children}</dd>
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
