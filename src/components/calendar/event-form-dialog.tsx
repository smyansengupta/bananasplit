"use client";

import { ChevronDown, Globe, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { createEvent, deleteEvent, updateEvent } from "@/app/app/[orgSlug]/calendar/actions";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ConferenceProvider, EventKind, EventVisibility } from "@/generated/prisma/enums";
import { allDaySpan } from "@/lib/calendar/dates";
import { cn } from "@/lib/utils";

import { ConferenceProviderSelect } from "./conference-provider-select";
import { KIND_META, KIND_ORDER, kindStyle, VISIBILITY_META } from "./kinds";
import { MemberMultiPicker, type CalendarMember } from "./member-picker";
import { toDateInputValue, toDateTimeLocalValue } from "./utils";

/**
 * Create and edit an event.
 *
 * WHAT MAKES CREATING ONE FAST. An event has eighteen fields and almost
 * every one of them is optional, so the form leads with the five that are
 * not — title, when, type, visibility, where — and folds the rest behind
 * one disclosure. A board member adding next Tuesday's workshop fills a
 * title and presses Enter; everything else already has the right answer.
 *
 * - The whole thing is a real <form>, so Enter saves from any field and
 *   Cmd/Ctrl+Enter saves from the description too. Escape closes (Dialog).
 * - Moving the start moves the end with it, keeping the duration, which is
 *   what you meant every time except the one where you are changing the
 *   length.
 * - The duration is printed next to the end, so a typo in the end time is
 *   visible without doing the arithmetic.
 * - The disclosure opens itself when an event already uses anything inside
 *   it, so editing never hides a filled-in field.
 */

/** The event as the form edits it (serializable from a server component). */
export interface EventFormEvent {
  id: string;
  title: string;
  description: string | null;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  location: string | null;
  conferenceProvider: ConferenceProvider;
  conferenceUrl: string | null;
  kind: EventKind;
  visibility: EventVisibility;
  hostUserId: string | null;
  hostName: string | null;
  rsvpUrl: string | null;
  capacityFull: boolean;
  featured: boolean;
  publicNote: string | null;
  stampSlot: number | null;
  attendeeIds: string[];
}

interface Props {
  orgId: string;
  /** The org timezone: all-day events are whole days there. */
  timeZone: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: EventFormEvent | null;
  defaultStart?: Date | null;
  defaultAllDay?: boolean;
  members: CalendarMember[];
  onSaved?: () => void;
  onDeleted?: () => void;
}

/** Keyed by event id so opening a different event (or switching create/edit) remounts cleanly. */
export function EventFormDialog({ open, onOpenChange, event, defaultStart, ...rest }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] gap-4 overflow-x-hidden overflow-y-auto sm:max-w-lg">
        {open && (
          <EventForm
            key={event?.id ?? `new-${defaultStart?.toISOString() ?? ""}`}
            event={event}
            defaultStart={defaultStart}
            onOpenChange={onOpenChange}
            {...rest}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

const NO_HOST = "__none";
const GUEST_HOST = "__guest";

function initialTimes(
  event: EventFormEvent | null,
  defaultStart: Date | null | undefined,
  allDay: boolean,
  timeZone: string,
) {
  if (event?.allDay) {
    const span = allDaySpan(event.startsAt, event.endsAt, timeZone);
    return { start: span.start, end: span.lastDay };
  }
  const start = event?.startsAt ?? defaultStart ?? nextClubHour(new Date());
  const end = event?.endsAt ?? new Date(start.getTime() + 60 * 60 * 1000);
  return allDay
    ? { start: toDateInputValue(start), end: toDateInputValue(start) }
    : { start: toDateTimeLocalValue(start), end: toDateTimeLocalValue(end) };
}

/** True when this event already uses something behind the disclosure. */
function usesMoreDetails(event: EventFormEvent | null): boolean {
  if (!event) return false;
  return Boolean(
    event.description ||
      event.hostUserId ||
      event.hostName ||
      event.rsvpUrl ||
      event.publicNote ||
      event.stampSlot ||
      event.capacityFull ||
      event.featured ||
      event.conferenceUrl ||
      event.conferenceProvider !== ConferenceProvider.NONE ||
      event.attendeeIds.length > 0,
  );
}

function EventForm({
  orgId,
  timeZone,
  onOpenChange,
  event,
  defaultStart,
  defaultAllDay,
  members,
  onSaved,
  onDeleted,
}: Omit<Props, "open">) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmEl, confirm] = useConfirm();
  const [error, setError] = useState<string | null>(null);
  const moreId = useId();

  const [title, setTitle] = useState(event?.title ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  // A club runs workshops; the type is the one field whose common answer is
  // knowable, so it starts there instead of on "Other".
  const [kind, setKind] = useState<EventKind>(event?.kind ?? EventKind.WORKSHOP);
  const [visibility, setVisibility] = useState<EventVisibility>(event?.visibility ?? EventVisibility.INTERNAL);
  const [allDay, setAllDay] = useState(event?.allDay ?? defaultAllDay ?? false);
  const initial = initialTimes(event, defaultStart, event?.allDay ?? defaultAllDay ?? false, timeZone);
  const [startValue, setStartValue] = useState(initial.start);
  const [endValue, setEndValue] = useState(initial.end);
  const [location, setLocation] = useState(event?.location ?? "");
  const [provider, setProvider] = useState<ConferenceProvider>(event?.conferenceProvider ?? ConferenceProvider.NONE);
  const [conferenceUrl, setConferenceUrl] = useState(event?.conferenceUrl ?? "");
  const [host, setHost] = useState<string>(event?.hostUserId ?? (event?.hostName ? GUEST_HOST : NO_HOST));
  const [hostName, setHostName] = useState(event?.hostName ?? "");
  const [rsvpUrl, setRsvpUrl] = useState(event?.rsvpUrl ?? "");
  const [capacityFull, setCapacityFull] = useState(event?.capacityFull ?? false);
  const [featured, setFeatured] = useState(event?.featured ?? false);
  const [publicNote, setPublicNote] = useState(event?.publicNote ?? "");
  const [stampSlot, setStampSlot] = useState(event?.stampSlot ? String(event.stampSlot) : "");
  const [attendeeIds, setAttendeeIds] = useState<string[]>(event?.attendeeIds ?? []);
  const [notifyAttendees, setNotifyAttendees] = useState(true);
  const [showMore, setShowMore] = useState(() => usesMoreDetails(event));

  const isPublic = visibility === EventVisibility.PUBLIC;

  function toggleAllDay(next: boolean) {
    setAllDay(next);
    if (next) {
      setStartValue(startValue.slice(0, 10));
      setEndValue(endValue.slice(0, 10) < startValue.slice(0, 10) ? startValue.slice(0, 10) : endValue.slice(0, 10));
    } else {
      const start = new Date(`${startValue.slice(0, 10)}T18:00`);
      setStartValue(toDateTimeLocalValue(start));
      setEndValue(toDateTimeLocalValue(new Date(start.getTime() + 60 * 60 * 1000)));
    }
  }

  /** Moving the start carries the end with it, so the duration survives. */
  function changeStart(next: string) {
    const previous = startValue;
    setStartValue(next);
    if (allDay) {
      if (endValue < next) setEndValue(next);
      return;
    }
    const before = new Date(previous).getTime();
    const after = new Date(next).getTime();
    const end = new Date(endValue).getTime();
    if (Number.isNaN(before) || Number.isNaN(after) || Number.isNaN(end)) return;
    setEndValue(toDateTimeLocalValue(new Date(end + (after - before))));
  }

  function payload() {
    return {
      title: title.trim(),
      description: description || null,
      allDay,
      // All-day: the first and last day; timed: the browser's wall time as an instant.
      startsAt: allDay ? startValue : new Date(startValue).toISOString(),
      endsAt: allDay ? endValue : new Date(endValue).toISOString(),
      location: location || null,
      conferenceProvider: provider,
      conferenceUrl: provider === ConferenceProvider.NONE ? null : conferenceUrl || null,
      kind,
      visibility,
      hostUserId: host !== NO_HOST && host !== GUEST_HOST ? host : null,
      hostName: host === GUEST_HOST ? hostName || null : null,
      rsvpUrl: rsvpUrl || null,
      capacityFull,
      featured,
      publicNote: publicNote || null,
      stampSlot: stampSlot ? Number(stampSlot) : null,
      attendeeIds,
      notifyAttendees,
    };
  }

  function handleSubmit(submitEvent: React.FormEvent) {
    submitEvent.preventDefault();
    if (isPending || !title.trim()) return;
    setError(null);
    if (!allDay && (Number.isNaN(new Date(startValue).getTime()) || Number.isNaN(new Date(endValue).getTime()))) {
      setError("Enter a valid start and end time.");
      return;
    }
    if (!allDay && new Date(endValue).getTime() < new Date(startValue).getTime()) {
      setError("The event ends before it starts. Check the end time.");
      return;
    }
    startTransition(async () => {
      const result = event ? await updateEvent(orgId, event.id, payload()) : await createEvent(orgId, payload());
      if (result?.error) {
        setError(result.error);
        return;
      }
      onOpenChange(false);
      onSaved?.();
      router.refresh();
    });
  }

  async function handleDelete() {
    if (!event) return;
    const ok = await confirm({
      title: `Delete “${event.title}”?`,
      description: notifyAttendees
        ? "Invited members are told it was cancelled."
        : "Invited members won't be notified.",
      confirmLabel: "Delete event",
      run: async () => (await deleteEvent(orgId, event.id, { notifyAttendees }))?.error,
    });
    if (!ok) return;
    onOpenChange(false);
    onDeleted?.();
    router.refresh();
  }

  /** Cmd/Ctrl+Enter saves from anywhere, including the description. */
  function onKeyDown(keyEvent: React.KeyboardEvent<HTMLFormElement>) {
    if ((keyEvent.metaKey || keyEvent.ctrlKey) && keyEvent.key === "Enter") {
      keyEvent.preventDefault();
      keyEvent.currentTarget.requestSubmit();
    }
  }

  return (
    <form onSubmit={handleSubmit} onKeyDown={onKeyDown} className="contents">
      <DialogHeader>
        <DialogTitle>{event ? "Edit event" : "New event"}</DialogTitle>
        <DialogDescription>
          {event
            ? "Changes reach the website and Google Calendar the same way the original did."
            : "A title and a time are all it takes. Everything else has a sensible default."}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="grid gap-1.5">
          <Label htmlFor="event-title">Title</Label>
          <Input
            id="event-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            required
            maxLength={200}
            placeholder="e.g. General meeting"
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 [&>*]:min-w-0">
          <div className="grid gap-1.5">
            <Label htmlFor="event-kind">Type</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as EventKind)}>
              <SelectTrigger id="event-kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KIND_ORDER.map((k) => (
                  <SelectItem key={k} value={k}>
                    <span
                      aria-hidden
                      className="size-2 shrink-0 rounded-full"
                      style={{ ...kindStyle(k), background: "var(--kind)" }}
                    />
                    {KIND_META[k].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="event-visibility">Visibility</Label>
            <Select value={visibility} onValueChange={(v) => setVisibility(v as EventVisibility)}>
              <SelectTrigger id="event-visibility" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["INTERNAL", "PUBLIC"] as const).map((v) => (
                  <SelectItem key={v} value={v}>
                    {VISIBILITY_META[v].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">{VISIBILITY_META[visibility].hint}</p>
          </div>
        </div>

        {isPublic && (
          <p
            role="note"
            className="border-warning/40 bg-warning/10 flex gap-2 rounded-md border p-3 text-xs leading-relaxed"
          >
            <TriangleAlert className="text-warning mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              Public events are world-readable: the title, description, location and RSVP link appear on the club
              website, the public events feed and the public Google Calendar. Attendees and meeting links never do.
            </span>
          </p>
        )}

        <fieldset className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <legend className="text-sm font-medium">When</legend>
            <div className="flex items-center gap-2">
              <Switch id="event-all-day" checked={allDay} onCheckedChange={toggleAllDay} />
              <Label htmlFor="event-all-day" className="text-sm font-normal">
                All-day
              </Label>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="event-start">{allDay ? "First day" : "Starts"}</Label>
              <Input
                id="event-start"
                type={allDay ? "date" : "datetime-local"}
                value={startValue}
                onChange={(e) => changeStart(e.target.value)}
                required
              />
            </div>
            <div className="grid gap-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <Label htmlFor="event-end">{allDay ? "Last day" : "Ends"}</Label>
                {!allDay && (
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {durationLabel(startValue, endValue)}
                  </span>
                )}
              </div>
              <Input
                id="event-end"
                type={allDay ? "date" : "datetime-local"}
                value={endValue}
                onChange={(e) => setEndValue(e.target.value)}
                required
              />
            </div>
          </div>
          <p className="text-muted-foreground text-xs">
            {allDay ? `All-day events are whole days in ${timeZone}.` : "Times are in your own timezone."}
          </p>
        </fieldset>

        <div className="grid gap-1.5">
          <Label htmlFor="event-location">Location</Label>
          <Input
            id="event-location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Room, address, or leave blank"
            maxLength={300}
          />
        </div>

        <div>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground flex w-full items-center gap-1.5 border-t pt-3 text-sm font-medium transition-colors"
            aria-expanded={showMore}
            aria-controls={moreId}
            onClick={() => setShowMore((v) => !v)}
          >
            <ChevronDown aria-hidden className={cn("size-4 transition-transform", showMore && "rotate-180")} />
            {showMore ? "Fewer details" : "More details"}
            {!showMore && (
              <span className="text-muted-foreground/80 ml-1 text-xs font-normal">
                host, RSVP link, invites, description
              </span>
            )}
          </button>
        </div>

        {showMore && (
          <div id={moreId} className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="event-host">Host</Label>
                <Select value={host} onValueChange={setHost}>
                  <SelectTrigger id="event-host" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_HOST}>No host</SelectItem>
                    {members.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name ?? "Member"}
                      </SelectItem>
                    ))}
                    <SelectItem value={GUEST_HOST}>A guest (type a name)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {host === GUEST_HOST && (
                <div className="grid gap-1.5">
                  <Label htmlFor="event-host-name">Guest host</Label>
                  <Input
                    id="event-host-name"
                    value={hostName}
                    onChange={(e) => setHostName(e.target.value)}
                    placeholder="e.g. a guest speaker"
                    maxLength={120}
                  />
                </div>
              )}
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="event-rsvp">RSVP link</Label>
              <Input
                id="event-rsvp"
                type="url"
                value={rsvpUrl}
                onChange={(e) => setRsvpUrl(e.target.value)}
                placeholder="https://lu.ma/…"
              />
            </div>

            {isPublic && (
              <fieldset className="space-y-3 rounded-md border p-3">
                <legend className="flex items-center gap-1 px-1 text-xs font-medium">
                  <Globe className="size-3" aria-hidden /> On the website
                </legend>
                <div className="flex flex-wrap gap-x-6 gap-y-2">
                  <div className="flex items-center gap-2">
                    <Switch id="event-full" checked={capacityFull} onCheckedChange={setCapacityFull} />
                    <Label htmlFor="event-full">Full (hide the RSVP button)</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch id="event-featured" checked={featured} onCheckedChange={setFeatured} />
                    <Label htmlFor="event-featured">Featured</Label>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_8rem]">
                  <div className="grid gap-1.5">
                    <Label htmlFor="event-note">Public note</Label>
                    <Input
                      id="event-note"
                      value={publicNote}
                      onChange={(e) => setPublicNote(e.target.value)}
                      placeholder="e.g. No more space"
                      maxLength={500}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="event-stamp">Stamp slot</Label>
                    <Input
                      id="event-stamp"
                      type="number"
                      min={1}
                      max={12}
                      value={stampSlot}
                      onChange={(e) => setStampSlot(e.target.value)}
                      placeholder="1-12"
                    />
                  </div>
                </div>
              </fieldset>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>Conferencing</Label>
                <ConferenceProviderSelect value={provider} onChange={setProvider} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="event-conference-url">Meeting link</Label>
                <Input
                  id="event-conference-url"
                  value={conferenceUrl}
                  onChange={(e) => setConferenceUrl(e.target.value)}
                  disabled={provider === ConferenceProvider.NONE}
                  placeholder="https://…"
                />
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="event-description">Description</Label>
              <Textarea
                id="event-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="What it covers, what to bring, anything the website should say."
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="event-attendees">Invite members</Label>
              <MemberMultiPicker
                id="event-attendees"
                members={members}
                selectedIds={attendeeIds}
                onChange={setAttendeeIds}
              />
            </div>

            {event && (
              <div className="flex items-start gap-2">
                <Checkbox
                  id="event-notify"
                  className="mt-0.5"
                  checked={notifyAttendees}
                  onCheckedChange={(v) => setNotifyAttendees(v === true)}
                />
                <Label htmlFor="event-notify" className="text-sm leading-snug font-normal">
                  Notify invited members if the time or place changes, or the event is cancelled
                </Label>
              </div>
            )}
          </div>
        )}

        {error && (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        )}
      </div>

      {confirmEl}
      <DialogFooter className="flex items-center justify-between sm:justify-between">
        {event ? (
          <Button type="button" variant="ghost" onClick={() => void handleDelete()} disabled={isPending}>
            Delete
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={isPending || !title.trim()}>
            {isPending ? "Saving…" : event ? "Save" : "Create"}
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}

/** "1 hr", "1 hr 30 min", "45 min", or "" when the pair makes no sense. */
function durationLabel(start: string, end: string): string {
  const a = new Date(start).getTime();
  const b = new Date(end).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return "";
  const minutes = Math.round((b - a) / 60_000);
  if (minutes < 0) return "ends before it starts";
  if (minutes === 0) return "no length";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  if (rest === 0) return `${hours} hr`;
  return `${hours} hr ${rest} min`;
}

/**
 * The hour a new event starts on by default: the next whole hour, but not
 * before 6pm today, because a club's sessions are evening sessions and
 * "now plus an hour" is almost never the answer.
 */
function nextClubHour(date: Date): Date {
  const rounded = new Date(date);
  rounded.setMinutes(0, 0, 0);
  rounded.setHours(rounded.getHours() + 1);
  if (rounded.getHours() < 18 && rounded.getDate() === date.getDate()) rounded.setHours(18);
  return rounded;
}
