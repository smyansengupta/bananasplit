"use client";

import { CalendarPlus, MapPin, Video } from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { EventFormDialog, type MeetingShape } from "@/components/calendar/event-form-dialog";
import type { CalendarMember } from "@/components/calendar/member-picker";
import { Button } from "@/components/ui/button";
import { CreateSplitButton } from "@/components/ui/create-split-button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import type { EventTagOption } from "@/lib/calendar/tags";

/**
 * The two things you start from the Meetings page.
 *
 * New meeting is the one you want most days — a call or a room, which the
 * menu asks before the form opens so the form only shows the half that
 * applies. It opens here rather than sending you to the Calendar with a
 * query string, which used to leave you on a different page than the one
 * you started from.
 *
 * Create new event sits to its left for the other kind: something with a
 * public sign-up page, which is the Calendar's event flow.
 */
export function MeetingsCreateActions({
  orgId,
  timeZone,
  members,
  tags,
  newEventHref,
}: {
  orgId: string;
  timeZone: string;
  members: CalendarMember[];
  tags: EventTagOption[];
  /** The Calendar's new-event flow, with the sign-up page switched on. */
  newEventHref: string;
}) {
  const router = useRouter();
  const [shape, setShape] = useState<MeetingShape | null>(null);

  return (
    <>
      <Button variant="outline" asChild>
        <Link href={newEventHref}>
          <CalendarPlus aria-hidden="true" />
          Create new event
        </Link>
      </Button>

      <CreateSplitButton
        label="New meeting"
        onClick={() => setShape("IN_PERSON")}
        menuLabel="Online or in person"
      >
        <DropdownMenuItem onSelect={() => setShape("IN_PERSON")}>
          <MapPin className="size-4" aria-hidden="true" />
          In person
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setShape("ONLINE")}>
          <Video className="size-4" aria-hidden="true" />
          Online
        </DropdownMenuItem>
      </CreateSplitButton>

      <EventFormDialog
        orgId={orgId}
        timeZone={timeZone}
        open={shape !== null}
        onOpenChange={(open) => !open && setShape(null)}
        event={null}
        defaultShape={shape ?? undefined}
        members={members}
        tags={tags}
        onSaved={() => {
          setShape(null);
          router.refresh();
        }}
      />
    </>
  );
}
