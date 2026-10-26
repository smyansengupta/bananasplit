import type { ViewerChart } from "@/lib/tasks/assignment";
import type { OrgMemberOption } from "@/server/members";
import type { FileRefOption } from "@/server/notes/files";
import type { ParentOption, TaskListItem } from "@/server/tasks/queries";

/** Client-side shapes for the task views (type-only imports of server read shapes). */

export type TaskItem = TaskListItem;
export type SubtaskItem = TaskListItem["subtasks"][number];
export type MemberOption = OrgMemberOption;
/** A club file a title or description can point at (`/` in either field). */
export type FileOption = FileRefOption;
export type { ParentOption };

export interface LabelOption {
  id: string;
  name: string;
  color: string;
}

export interface TasksViewer {
  userId: string;
  name: string | null;
  /** OWNER or ADMIN. */
  isAdmin: boolean;
  chart: ViewerChart;
}

/** What the viewer may make on the spot, from the club's creation rules. */
export interface TasksCan {
  /** OrgSettings.memberCanCreateTags, or an owner/admin. */
  createTags: boolean;
}

export interface TasksOrg {
  id: string;
  slug: string;
  timezone: string;
  /** The viewer's local today, "YYYY-MM-DD". */
  todayKey: string;
  requireOwner: boolean;
  requireDueDate: boolean;
}
