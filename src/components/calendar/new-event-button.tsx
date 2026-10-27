"use client";

import { ImageUp, Plus } from "@/components/icons";
import Link from "next/link";

import { CreateSplitButton } from "@/components/ui/create-split-button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { newEventHref } from "@/lib/calendar/range";

/** What "From a screenshot" asks the calendar grid (event-calendar.tsx) to open. */
export const CALENDAR_CREATE_EVENT = "calendar:create";
export type CalendarCreateDetail = { from: "screenshot" };

function askForScreenshot() {
  window.dispatchEvent(
    new CustomEvent<CalendarCreateDetail>(CALENDAR_CREATE_EVENT, { detail: { from: "screenshot" } }),
  );
}

/**
 * The Calendar's create action, in the page header beside Google Calendar
 * sync like every other page's: New event, with "From a screenshot" under
 * its chevron.
 *
 * New event is a link to the event's own page. It used to open a dialog
 * over the grid, which made the errand a submenu of the calendar; a day
 * cell's "+" still opens the quick dialog, because that one starts from a
 * time you already picked. The screenshot reader stays with the grid, so
 * that one still asks it.
 */
export function NewEventButton({ orgSlug }: { orgSlug: string }) {
  const href = newEventHref(orgSlug);
  return (
    <CreateSplitButton label="New event" href={href} menuLabel="More ways to add events">
      <DropdownMenuItem asChild>
        <Link href={href}>
          <Plus className="size-4" aria-hidden="true" />
          New event
        </Link>
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={askForScreenshot}>
        <ImageUp className="size-4" aria-hidden="true" />
        <span className="flex flex-col">
          From a screenshot
          <span className="text-muted-foreground text-xs">An invite, an email or a flyer</span>
        </span>
      </DropdownMenuItem>
    </CreateSplitButton>
  );
}
