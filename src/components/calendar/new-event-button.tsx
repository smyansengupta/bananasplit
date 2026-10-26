"use client";

import { ImageUp, Plus } from "@/components/icons";

import { CreateSplitButton } from "@/components/ui/create-split-button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

/** What the header's New event asks the calendar grid (event-calendar.tsx) to open. */
export const CALENDAR_CREATE_EVENT = "calendar:create";
export type CalendarCreateDetail = { from: "blank" | "screenshot" };

function ask(from: CalendarCreateDetail["from"]) {
  window.dispatchEvent(
    new CustomEvent<CalendarCreateDetail>(CALENDAR_CREATE_EVENT, { detail: { from } }),
  );
}

/**
 * The Calendar's create action, in the page header beside Google Calendar
 * sync like every other page's: New event, with "From a screenshot" under
 * its chevron. The dialogs live with the grid, so it asks the grid to open
 * them.
 */
export function NewEventButton() {
  return (
    <CreateSplitButton
      label="New event"
      onClick={() => ask("blank")}
      menuLabel="More ways to add events"
    >
      <DropdownMenuItem onSelect={() => ask("blank")}>
        <Plus className="size-4" aria-hidden="true" />
        New event
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => ask("screenshot")}>
        <ImageUp className="size-4" aria-hidden="true" />
        <span className="flex flex-col">
          From a screenshot
          <span className="text-muted-foreground text-xs">An invite, an email or a flyer</span>
        </span>
      </DropdownMenuItem>
    </CreateSplitButton>
  );
}
