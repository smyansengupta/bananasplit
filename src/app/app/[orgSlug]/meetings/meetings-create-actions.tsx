import { CalendarPlus, MapPin, Video } from "@/components/icons";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { CreateSplitButton } from "@/components/ui/create-split-button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { newEventHref } from "@/lib/calendar/range";

/**
 * The two things you start from the Meetings page.
 *
 * New meeting is the one you want most days — a call or a room, which the
 * menu asks before the form opens so the form only shows the half that
 * applies. Create new event sits to its left for the other kind: something
 * with a public sign-up page.
 *
 * Both are links to the event's own page (calendar/new), carrying what the
 * button already knew. They used to open a dialog — one here, one over the
 * calendar — so the same errand looked like two different things depending
 * on which button you pressed, and neither had a page you could link
 * anyone to.
 */
export function MeetingsCreateActions({ orgSlug }: { orgSlug: string }) {
  const meeting = (shape: "IN_PERSON" | "ONLINE") =>
    newEventHref(orgSlug, { shape, from: "meetings" });
  return (
    <>
      <Button variant="outline" asChild>
        <Link href={newEventHref(orgSlug, { rsvp: true, from: "meetings" })}>
          <CalendarPlus aria-hidden="true" />
          Create new event
        </Link>
      </Button>

      <CreateSplitButton
        label="New meeting"
        href={meeting("IN_PERSON")}
        menuLabel="Online or in person"
      >
        <DropdownMenuItem asChild>
          <Link href={meeting("IN_PERSON")}>
            <MapPin className="size-4" aria-hidden="true" />
            In person
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={meeting("ONLINE")}>
            <Video className="size-4" aria-hidden="true" />
            Online
          </Link>
        </DropdownMenuItem>
      </CreateSplitButton>
    </>
  );
}
