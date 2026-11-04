"use client";

import { ImageUp } from "@/components/icons";

import { Button } from "@/components/ui/button";
import { CreateSplitButton } from "@/components/ui/create-split-button";

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
  // The menu only repeated New event and held one other way in, so that
  // one is its own button beside it.
  return (
    <span className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={() => ask("screenshot")}
        aria-label="New event from a screenshot"
        title="From a screenshot"
      >
        <ImageUp className="size-[18px]" aria-hidden="true" />
      </Button>
      <CreateSplitButton label="New event" onClick={() => ask("blank")} />
    </span>
  );
}
