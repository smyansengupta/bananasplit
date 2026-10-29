"use client";

import type { MeetingType } from "@/lib/meetings/meeting-types";
import { Plus } from "@/components/icons";
import dynamic from "next/dynamic";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import type { CalendarMember } from "@/components/calendar/member-picker";
import { Button } from "@/components/ui/button";
import { NEW_EVENT_PARAM } from "@/lib/calendar/range";
import type { MeetingShape } from "@/lib/meetings/shape";

/** The create form, fetched when someone first asks for it, as the Calendar does. */
const EventFormDialog = dynamic(
  () => import("@/components/calendar/event-form-dialog").then((m) => m.EventFormDialog),
  { ssr: false },
);

/**
 * New meeting, on the Meetings page (docs/features/meetings.md): the same
 * create form the Calendar has, opened in place. A create lands on the
 * meeting's own page, where its call, its place and its sign-up page can be
 * added later; a new Event goes on to its sign-up settings first, as it does
 * from the Calendar.
 *
 * Every way in is this one flow. The page's button opens it with nothing
 * preset. A link opens it from outside: the + menu's New meeting (`?new=1`),
 * or `?new=online|in-person|event` to start on a shape, which the page passes
 * in as `startOpen` and `initialShape`. The parameter is dropped once it has
 * opened the form, so a reload or Back doesn't open another. Only the button
 * that is handed `startOpen` does any of that: the page's second one, in its
 * empty state, is left alone.
 */
export function NewMeetingButton({
  orgId,
  timeZone,
  members,
  defaultReminderMinutes,
  meetingTypes,
  initialShape = null,
  startOpen = false,
  variant = "create",
}: {
  orgId: string;
  /** The organization's timezone: all-day events are whole days there. */
  timeZone: string;
  members: CalendarMember[];
  /** The organization's reminder times, which a new meeting starts with. */
  defaultReminderMinutes: number[];
  /** The organization's meeting types (OrgSettings.eventTypes), offered on the form. */
  meetingTypes?: MeetingType[];
  /** The shape the form opens on (from ?new=), or none for its own default. */
  initialShape?: MeetingShape | null;
  /** Open on arrival (?new= is on the address). */
  startOpen?: boolean;
  /** `create` in the header, the quieter `secondary` where an empty page repeats it. */
  variant?: "create" | "secondary";
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const params = useParams<{ orgSlug?: string }>();
  const [open, setOpen] = useState(startOpen);
  const [shape, setShape] = useState<MeetingShape | null>(initialShape);

  // A link followed while Meetings is already on screen (the + menu) asks
  // again with the same button still mounted. The state is adjusted while
  // rendering, as the Calendar's is, so it opens on that very render.
  const [wasAsked, setWasAsked] = useState(startOpen);
  if (startOpen !== wasAsked) {
    setWasAsked(startOpen);
    if (startOpen) {
      setShape(initialShape);
      setOpen(true);
    }
  }

  // Then drop the param, keeping the rest of the query (a connect notice).
  useEffect(() => {
    if (!startOpen || !searchParams.has(NEW_EVENT_PARAM)) return;
    const next = new URLSearchParams(searchParams.toString());
    next.delete(NEW_EVENT_PARAM);
    const search = next.toString();
    router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
  }, [startOpen, searchParams, router, pathname]);

  return (
    <>
      <Button
        variant={variant}
        onClick={() => {
          setShape(null);
          setOpen(true);
        }}
      >
        <Plus aria-hidden="true" />
        New meeting
      </Button>

      {open && (
        <EventFormDialog
          orgId={orgId}
          timeZone={timeZone}
          open
          onOpenChange={setOpen}
          event={null}
          defaultShape={shape ?? undefined}
          noun="meeting"
          defaultReminderMinutes={defaultReminderMinutes}
          meetingTypes={meetingTypes}
          members={members}
          afterCreate={(eventId) =>
            params.orgSlug ? `/app/${params.orgSlug}/meetings/${eventId}` : null
          }
        />
      )}
    </>
  );
}
