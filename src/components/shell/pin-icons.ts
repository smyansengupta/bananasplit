import {
  CalendarDays,
  CheckSquare,
  Database,
  FileText,
  Folder,
  NotebookText,
  Paperclip,
  User,
  type LucideIcon,
} from "lucide-react";

import type { PinKind } from "@/lib/pins/pages";

/** The icon for each kind of pinned or recently visited item. */
export const PIN_ICONS: Record<PinKind, LucideIcon> = {
  page: FileText,
  note: NotebookText,
  task: CheckSquare,
  event: CalendarDays,
  database: Database,
  person: User,
  file: Paperclip,
  folder: Folder,
};

/** What each kind is called on a pin card. */
export const PIN_KIND_LABELS: Record<PinKind, string> = {
  page: "Page",
  note: "Note",
  task: "Task",
  event: "Event",
  database: "Database",
  person: "Person",
  file: "File",
  folder: "Folder",
};
