"use client";

import {
  CalendarClock,
  CalendarDays,
  CheckSquare,
  Database,
  FolderOpen,
  Video,
  type IconComponent,
} from "@/components/icons";
import Link from "next/link";

import { segmentedItem, segmentedTrack } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";

const SHORTCUTS: readonly { path: string; label: string; icon: IconComponent }[] = [
  { path: "/tasks", label: "Tasks", icon: CheckSquare },
  { path: "/calendar", label: "Calendar", icon: CalendarDays },
  { path: "/notes", label: "Files", icon: FolderOpen },
  { path: "/databases", label: "Databases", icon: Database },
  { path: "/calendar/find-a-time", label: "Find a time", icon: CalendarClock },
  { path: "/meetings", label: "Meetings", icon: Video },
];

/**
 * The Personal dashboard's way into its pages, on the same muted track as
 * the Tasks layouts (Board / Week / Table): each option rises onto the page
 * colour under the pointer. They are links to other pages, not views of
 * this one, so none of them is shown as chosen.
 */
export function PersonalShortcuts({ base }: { base: string }) {
  return (
    <nav aria-label="Personal" className="max-w-full overflow-x-auto">
      <ul className={cn(segmentedTrack, "min-w-max")}>
        {SHORTCUTS.map(({ path, label, icon: Icon }) => (
          <li key={path}>
            <Link
              href={`${base}${path}`}
              className={cn(
                segmentedItem(false),
                "hover:bg-background dark:hover:bg-input/60 focus-visible:bg-background",
              )}
            >
              <Icon aria-hidden="true" />
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
