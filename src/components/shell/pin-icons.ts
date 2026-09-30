import {
  CalendarDays,
  CheckSquare,
  Database,
  FileText,
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
};
