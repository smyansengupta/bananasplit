"use client";

import { ListPlus } from "@/components/icons";
import { updateEvent } from "@/app/app/[orgSlug]/calendar/actions";
import { agendaWithTask } from "@/lib/ambient/tasks";

import { AmbientRow, type AmbientItem } from "./ambient-pills";
import { useTaskAmbientItems } from "./task-ambient";
import { useTasks } from "./tasks-context";
import type { TaskItem } from "./types";

export interface AgendaMeetingProp {
  id: string;
  title: string;
  /** "Thu", "tomorrow": when it is, in a word. */
  when: string;
  description: string | null;
}

/**
 * The task page's ambient buttons, above the editor: what the task's row
 * offers, plus Follow up while you wait on someone, and Add to agenda when
 * it's linked to a meeting this week that doesn't have it yet. Nothing at
 * all when nothing calls for it.
 */
export function TaskPageAmbient({
  task,
  meeting,
}: {
  task: TaskItem;
  /** The linked meeting this week, when the viewer may edit its agenda. */
  meeting: AgendaMeetingProp | null;
}) {
  const { org } = useTasks();
  const items: AmbientItem[] = useTaskAmbientItems(task, { page: true });
  if (meeting && task.status !== "COMPLETED") {
    const reason = `Linked to ${meeting.title}, ${meeting.when}`;
    items.push({
      key: "agenda",
      reason,
      action: {
        key: "agenda",
        label: "Add to agenda",
        icon: ListPlus,
        reason,
        ariaLabel: `Add ${task.title} to the agenda of ${meeting.title}`,
        run: () =>
          updateEvent(org.id, meeting.id, {
            description: agendaWithTask(meeting.description, task, org.slug),
          }),
        done: `On the agenda for ${meeting.title}`,
      },
    });
  }
  if (items.length === 0) return null;
  return (
    <div className="bg-card edge rounded-card px-4 py-3">
      <AmbientRow items={items} why align="start" />
    </div>
  );
}
