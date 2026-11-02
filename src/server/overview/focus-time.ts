import type { Availability } from "@/lib/availability";
import type { FocusWeek } from "@/lib/overview/focus-time";
import type { ItemRef } from "@/lib/overview/types";

/**
 * Focus time's data (src/components/overview/focus-time.tsx), on the
 * Personal home: the viewer's free hours over the next seven days
 * (src/lib/overview/focus-time.ts), from their own availability and the
 * timed events they said yes or maybe to in any space. All-day events don't
 * take hours. Tasks have no time estimates, so the card names the next two
 * open tasks due rather than claiming they fit. Built by focusOf in
 * src/server/personal/home.ts.
 */

export interface FocusTask {
  id: string;
  title: string;
  href: string;
  dueKey: string;
}

export interface FocusTimeData {
  week: FocusWeek;
  todayKey: string;
  /** The viewer's availability as saved, so Block it off can add one date rule to it. */
  availability: Availability;
  tasks: FocusTask[];
  /** The profile page, where availability is edited. */
  availabilityHref: string;
  links: ItemRef[];
}
