"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { createEvent, deleteEvent, updateEvent } from "@/app/app/[orgSlug]/calendar/actions";
import type { EventWithRelations } from "@/app/app/[orgSlug]/calendar/queries";
import { AssigneePicker, type OrgMemberOption } from "@/components/tasks/assignee-picker";
import { Button } from "@/components/ui/button";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ConferenceProvider } from "@/generated/prisma/enums";

import { ConferenceProviderSelect } from "./conference-provider-select";
import { toDateInputValue, toDateTimeLocalValue } from "./utils";

interface Props {
  orgId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: EventWithRelations | null;
  defaultStart?: Date | null;
  members: OrgMemberOption[];
  onSaved?: () => void;
}

/** Keyed by event id so opening a different event (or switching create/edit) remounts cleanly. */
export function EventFormDialog({ open, onOpenChange, event, defaultStart, ...rest }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
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

function EventForm({
  orgId,
  onOpenChange,
  event,
  defaultStart,
  members,
  onSaved,
}: Omit<Props, "open">) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const initialStart = event?.startsAt ?? defaultStart ?? roundToNextHour(new Date());
  const initialEnd = event?.endsAt ?? new Date(initialStart.getTime() + 60 * 60 * 1000);

  const [title, setTitle] = useState(event?.title ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [allDay, setAllDay] = useState(event?.allDay ?? false);
  const [startValue, setStartValue] = useState(
    allDayInit(event) ? toDateInputValue(initialStart) : toDateTimeLocalValue(initialStart),
  );
  const [endValue, setEndValue] = useState(
    allDayInit(event) ? toDateInputValue(initialEnd) : toDateTimeLocalValue(initialEnd),
  );
  const [location, setLocation] = useState(event?.location ?? "");
  const [provider, setProvider] = useState<ConferenceProvider>(
    event?.conferenceProvider ?? ConferenceProvider.NONE,
  );
  const [conferenceUrl, setConferenceUrl] = useState(event?.conferenceUrl ?? "");
  const [attendeeIds, setAttendeeIds] = useState<string[]>(
    event?.attendees.map((a) => a.user.id) ?? [],
  );

  function allDayInit(e: EventWithRelations | null) {
    return e?.allDay ?? false;
  }

  function toggleAllDay(next: boolean) {
    setAllDay(next);
    const start = new Date(startValue);
    const end = new Date(endValue);
    if (next) {
      setStartValue(toDateInputValue(start));
      setEndValue(toDateInputValue(end));
    } else {
      setStartValue(toDateTimeLocalValue(start));
      setEndValue(toDateTimeLocalValue(end));
    }
  }

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const startsAt = allDay ? `${startValue}T00:00:00` : startValue;
      const endsAt = allDay ? `${endValue}T23:59:59` : endValue;

      const input = {
        title,
        description: description || null,
        startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(endsAt).toISOString(),
        allDay,
        location: location || null,
        conferenceProvider: provider,
        conferenceUrl: provider === ConferenceProvider.NONE ? null : conferenceUrl || null,
        attendeeIds,
      };

      const result = event
        ? await updateEvent(orgId, event.id, input)
        : await createEvent(orgId, input);

      if (result?.error) {
        setError(result.error);
        return;
      }
      onOpenChange(false);
      onSaved?.();
      router.refresh();
    });
  }

  function handleDelete() {
    if (!event) return;
    startTransition(async () => {
      await deleteEvent(orgId, event.id);
      onOpenChange(false);
      onSaved?.();
      router.refresh();
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{event ? "Edit event" : "New event"}</DialogTitle>
        <DialogDescription className="sr-only">Event details</DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="grid gap-1.5">
          <Label htmlFor="event-title">Title</Label>
          <Input
            id="event-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="event-description">Description</Label>
          <Textarea
            id="event-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
          />
        </div>

        <div className="flex items-center gap-2">
          <Switch id="event-all-day" checked={allDay} onCheckedChange={toggleAllDay} />
          <Label htmlFor="event-all-day">All-day</Label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="event-start">Starts</Label>
            <Input
              id="event-start"
              type={allDay ? "date" : "datetime-local"}
              value={startValue}
              onChange={(e) => setStartValue(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="event-end">Ends</Label>
            <Input
              id="event-end"
              type={allDay ? "date" : "datetime-local"}
              value={endValue}
              onChange={(e) => setEndValue(e.target.value)}
            />
          </div>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="event-location">Location</Label>
          <Input
            id="event-location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Room, address, or leave blank"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
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
          <Label>Attendees</Label>
          <AssigneePicker members={members} selectedIds={attendeeIds} onChange={setAttendeeIds} />
        </div>

        {error && <p className="text-destructive text-sm">{error}</p>}
      </div>

      <DialogFooter className="mt-6 flex items-center justify-between sm:justify-between">
        {event ? (
          <Button type="button" variant="ghost" onClick={handleDelete} disabled={isPending}>
            Delete
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={isPending || !title.trim()}>
            {event ? "Save" : "Create"}
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}

function roundToNextHour(date: Date): Date {
  const rounded = new Date(date);
  rounded.setMinutes(0, 0, 0);
  rounded.setHours(rounded.getHours() + 1);
  return rounded;
}
