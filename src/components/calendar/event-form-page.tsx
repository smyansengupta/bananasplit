"use client";

import { useRouter } from "next/navigation";

import type { EventTagOption } from "@/lib/calendar/tags";

import { EventForm, type MeetingShape } from "./event-form-dialog";
import type { CalendarMember } from "./member-picker";

/**
 * The event form as a page of its own (/calendar/new).
 *
 * The same fields the dialog shows, given the width of a page: making an
 * event is its own errand — a title, a time, a place, and often a sign-up
 * page after it — and doing that through an overlay stacked on the calendar
 * meant the thing you were leaving was still behind the glass, and closing
 * the form dropped you wherever the overlay had been opened from.
 *
 * Where you go afterwards is the page's job, not the form's: saving sends
 * you to the event, cancelling sends you back where you came from.
 */
export function EventFormPage({
  orgId,
  timeZone,
  members,
  tags,
  defaultRsvpPage,
  defaultShape,
  backHref,
  cancelLabel,
}: {
  orgId: string;
  timeZone: string;
  members: CalendarMember[];
  tags: EventTagOption[];
  defaultRsvpPage?: boolean;
  defaultShape?: MeetingShape;
  /** Where Cancel goes. */
  backHref: string;
  cancelLabel?: string;
}) {
  const router = useRouter();
  return (
    <EventForm
      chrome="page"
      cancelLabel={cancelLabel}
      orgId={orgId}
      timeZone={timeZone}
      event={null}
      members={members}
      tags={tags}
      defaultRsvpPage={defaultRsvpPage}
      defaultShape={defaultShape}
      // The form calls this to dismiss itself, which on a page means
      // leaving it: Cancel, and nothing else. A save navigates to the new
      // event itself (chrome="page" in event-form-dialog.tsx), so this
      // never races a push of its own.
      onOpenChange={(open) => {
        if (!open) router.push(backHref);
      }}
    />
  );
}
