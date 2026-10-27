"use client";

import {
  AlertTriangle,
  CalendarPlus,
  Check,
  Copy,
  ExternalLink,
  MapPin,
  Mic,
  NotebookText,
  Pencil,
  Printer,
  PowerOff,
  ScanLine,
  Ticket,
  Trash2,
  Video,
  type IconComponent,
} from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { deleteEvent, rsvpToEvent } from "@/app/app/[orgSlug]/calendar/actions";
import {
  turnOffRsvpPage,
  turnOnRsvpPage,
} from "@/app/app/[orgSlug]/calendar/[eventId]/rsvp/actions";
import { createNote } from "@/app/app/[orgSlug]/notes/actions";
import { BackLink } from "@/components/back-link";
import { ItemMenu } from "@/components/item-menu";
import { PageHeader } from "@/components/page-header";
import { PagePreview } from "@/components/rsvp/page-preview";
import { RsvpGuests } from "@/components/rsvp/rsvp-guests";
import { RsvpSettings } from "@/components/rsvp/rsvp-settings";
import type { RsvpManagerProps } from "@/components/rsvp/rsvp-manager";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
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
 * An event, in one place.
 *
 * This used to be a page to read plus a separate RSVP page under it, which
 * had its own header, its own back link and its own two tabs. An event made
 * with a sign-up page dropped you on that second page, and once you clicked
 * away the only route back was a chip in the calendar grid — so the thing
 * you had just made was, in practice, gone.
 *
 * Now there is one route for an event. Everything about it — what it is,
 * who's coming, and its sign-up page when it has one — is here, under one
 * title, and the tab bar only appears when there is a sign-up page to have
 * an opinion about.
 */

const RSVP_BADGE_VARIANT: Record<RSVPStatus, "success" | "destructive" | "secondary" | "outline"> =
  {
    PENDING: "outline",
    YES: "success",
    NO: "destructive",
    MAYBE: "secondary",
  };

export type EventTab = "details" | "guests" | "page";

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

/** The sign-up page's own data, for admins, when this event has one. */
export interface EventRsvpSection extends Omit<RsvpManagerProps, "initialTab"> {
  door: string;
  flyer: string;
}

export function EventDetailView({
  orgId,
  orgSlug,
  timeZone,
  event,
  tags,
  members,
  rsvp,
  rsvpSection,
  tab: initialTab = "details",
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
  /** Admins only, and only once the event has a sign-up page or guests. */
  rsvpSection?: EventRsvpSection | null;
  /** Which section the link that brought you here meant. */
  tab?: EventTab;
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
  const [tab, setTab] = useState<EventTab>(initialTab);
  const [copied, setCopied] = useState(false);

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

  function turnOnPage() {
    startTransition(async () => {
      const result = await turnOnRsvpPage(orgId, event.id);
      if (result.error) {
        toast({ title: "Couldn't turn on the page", description: result.error });
        return;
      }
      toast({
        title: "Your sign-up page is live",
        description: "Share the link to start taking sign-ups.",
      });
      setTab("page");
      router.refresh();
    });
  }

  async function turnOffPage() {
    const ok = await confirm({
      title: "Turn off the sign-up page?",
      description:
        "The link stops working and nobody new can sign up. Everyone already signed up stays on the list, and turning it back on brings the same link back.",
      confirmLabel: "Turn off",
      run: async () => (await turnOffRsvpPage(orgId, event.id)).error,
    });
    if (ok) router.refresh();
  }

  async function copyLink() {
    if (!rsvp.url) return;
    try {
      await navigator.clipboard.writeText(rsvp.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({ title: "Couldn't copy the link" });
    }
  }

  const hostLabel = event.host?.name ?? event.hostName;
  const zone = useViewerTimeZone(timeZone);
  const going = event.attendees.filter((a) => a.rsvp === "YES");
  const guestCount = rsvpSection
    ? rsvpSection.guests.filter((g) => g.status !== "CANCELLED").length
    : 0;
  // The tab bar is for people who have a sign-up page to run. Without one
  // this is a single page with no chrome to read past.
  const tabbed = Boolean(rsvpSection) && canEdit;
  const showing: EventTab = tabbed ? tab : "details";

  return (
    <div className="mx-auto max-w-5xl space-y-6">
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
              {rsvp.enabled && rsvp.url && rsvpSection && (
                <Button variant="outline" asChild>
                  <Link href={rsvpSection.door}>
                    <ScanLine aria-hidden className="size-4" />
                    Check in guests
                  </Link>
                </Button>
              )}
              <Button variant="outline" onClick={() => setEditOpen(true)}>
                <Pencil aria-hidden className="size-4" />
                Edit event
              </Button>
              <ItemMenu
                label="More event actions"
                items={[
                  ...(rsvp.enabled && rsvp.url
                    ? [
                        {
                          label: "Open the sign-up page",
                          icon: ExternalLink,
                          onSelect: () => window.open(rsvp.url!, "_blank", "noopener"),
                        },
                      ]
                    : []),
                  ...(rsvp.enabled && rsvpSection
                    ? [
                        {
                          label: "Print a flyer",
                          icon: Printer,
                          onSelect: () => window.open(rsvpSection.flyer, "_blank", "noopener"),
                        },
                        {
                          label: "Turn off the sign-up page",
                          icon: PowerOff,
                          onSelect: () => void turnOffPage(),
                        },
                      ]
                    : []),
                  {
                    label: "Delete event",
                    icon: Trash2,
                    onSelect: () => void handleDelete(),
                    destructive: true,
                    separated: true,
                  },
                ]}
              />
            </>
          ) : null
        }
      />

      <div className="-mt-2 flex flex-wrap gap-1.5">
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

      {rsvp.enabled && rsvp.url && (
        <div className="bg-card text-card-foreground ring-foreground/6 edge flex flex-wrap items-center gap-3 rounded-full py-1.5 ps-5 pe-1.5 ring-1">
          <span className="text-muted-foreground text-[13px] font-medium">Sign-up link</span>
          <a
            href={rsvp.url}
            target="_blank"
            rel="noopener noreferrer"
            className="min-w-0 flex-1 truncate text-[15px] font-medium underline-offset-4 hover:underline"
          >
            {rsvp.url.replace(/^https?:\/\//, "")}
          </a>
          <Button variant="secondary" size="sm" onClick={() => void copyLink()}>
            {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      )}

      {tabbed && (
        <Segmented
          label="This event"
          value={showing}
          onSelect={(v) => setTab(v as EventTab)}
          options={[
            { value: "details", label: "Details" },
            { value: "guests", label: `Guests (${guestCount})` },
            { value: "page", label: "Sign-up page" },
          ]}
        />
      )}

      {showing === "guests" && rsvpSection && (
        <RsvpGuests
          orgId={orgId}
          eventId={event.id}
          eventTitle={event.title}
          guests={rsvpSection.guests}
          canAdd={rsvp.enabled}
          shareUrl={rsvp.url}
          owes={rsvpSection.owes}
        />
      )}

      {showing === "page" && rsvpSection && (
        <RsvpSettings
          orgId={orgId}
          eventId={event.id}
          title={event.title}
          location={event.location}
          cover={rsvpSection.page.cover}
          initial={rsvpSection.page.settings}
          messaging={rsvpSection.messaging}
          editHref={`/app/${orgSlug}/calendar/${event.id}?edit=1`}
          going={rsvpSection.guests.filter((g) => g.status === "GOING").length}
          items={rsvpSection.items}
        />
      )}

      {showing === "details" && (
        <div className="grid gap-[18px] lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="space-y-[18px]">
            <Card>
              <CardContent className="space-y-5">
                {event.description ? (
                  <p className="text-[15px] leading-relaxed whitespace-pre-wrap">
                    {event.description}
                  </p>
                ) : (
                  <p className="text-muted-foreground text-sm">
                    No description yet.
                    {canEdit && " Add one with Edit event."}
                  </p>
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
                    <a
                      href={buildGoogleCalendarUrl(event)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="size-4" />
                      Add to Google Calendar
                    </a>
                  </Button>
                  {event.notes.length === 0 && canEdit && (
                    <Button
                      variant="outline"
                      onClick={handleCreateMeetingNotes}
                      disabled={isPending}
                    >
                      <NotebookText className="size-4" />
                      Create meeting notes
                    </Button>
                  )}
                </div>

                {event.notes.length > 0 && (
                  <ul className="-mx-2 border-t pt-3">
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
                )}
              </CardContent>
            </Card>

            {/*
              No sign-up page yet: one offer, where the tab bar would be, so
              the way to make one is on the event rather than a page away.
            */}
            {canEdit && !rsvp.enabled && (
              <Card>
                <CardContent className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_200px] sm:items-center">
                  <div className="space-y-2.5">
                    <IconChip icon={Ticket} size="md" />
                    <h2 className="display-title text-[21px]">
                      {rsvp.url ? "This sign-up page is off" : "Let anyone sign up with a link"}
                    </h2>
                    <p className="text-muted-foreground max-w-prose text-sm leading-relaxed">
                      {rsvp.url
                        ? "Turn it back on and the same link works again. Everyone who signed up is still on the list."
                        : "A public page for this event: the time and place with a map, who's hosting and who's going, and a sign-up form."}
                    </p>
                    <Button onClick={turnOnPage} disabled={isPending}>
                      <Ticket aria-hidden />
                      {isPending
                        ? "Turning on…"
                        : rsvp.url
                          ? "Turn the page back on"
                          : "Turn on the sign-up page"}
                    </Button>
                  </div>
                  {rsvpSection && (
                    <PagePreview
                      cover={rsvpSection.page.cover}
                      background={rsvpSection.page.settings.background}
                      title={event.title}
                    />
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          <aside className="space-y-[18px]">
            <Card>
              <CardHeader className="flex items-center gap-2">
                <CardTitle>Who&apos;s coming</CardTitle>
                <Badge variant="secondary">{event.attendees.length}</Badge>
                <span className="flex-1" />
                {going.length > 0 && <FaceStack people={going.map((a) => a.user)} />}
              </CardHeader>
              <CardContent className="space-y-4">
                {myAttendance && (
                  <div>
                    <p className="text-muted-foreground mb-2 text-[13px] font-medium">
                      {myAttendance.rsvp === "PENDING" ? "Are you going?" : "Your answer"}
                    </p>
                    <div className="flex gap-1.5" role="group" aria-label="Your RSVP">
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
                              "h-9 flex-1 rounded-full text-[13px] font-semibold transition-[background-color,transform] active:scale-[0.97] disabled:opacity-60",
                              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current",
                              on
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted hover:bg-muted/70",
                            )}
                          >
                            {RSVP_META[status].short}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {event.attendees.length > 0 ? (
                  <div className="space-y-3">
                    <p className="text-muted-foreground text-[13px] tabular-nums">
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
                  </div>
                ) : (
                  <p className="text-muted-foreground text-sm leading-relaxed">
                    Nobody from the club is invited yet.
                    {canEdit && " Add members under More details when you edit."}
                  </p>
                )}

                {canEdit && rsvp.enabled && (
                  <p className="text-muted-foreground border-t pt-3 text-[13px] tabular-nums">
                    {rsvp.going} signed up through the public page
                    {rsvp.waitlist > 0 && ` · ${rsvp.waitlist} waitlisted`}
                    {rsvp.capacity && ` · ${rsvp.capacity} spots`}
                  </p>
                )}
              </CardContent>
            </Card>
          </aside>
        </div>
      )}

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
