import type { ViewerChart } from "@/lib/tasks/assignment";
import type { OrgMemberOption } from "@/server/members";
import type { ProjectOption, TaskListItem } from "@/server/tasks/queries";

/** Client-side shapes for the task views (type-only imports of server read shapes). */

export type TaskItem = TaskListItem;
export type SubtaskItem = TaskListItem["subtasks"][number];
export type MemberOption = OrgMemberOption;
export type { ProjectOption };

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

export interface TasksOrg {
  id: string;
  slug: string;
  timezone: string;
  /** The viewer's local today, "YYYY-MM-DD". */
  todayKey: string;
  requireOwner: boolean;
  requireDueDate: boolean;
}
