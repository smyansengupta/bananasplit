"use client";

import { formatDistanceToNow } from "date-fns";
import { useState, useTransition } from "react";

import { loadTaskActivity } from "@/app/app/[orgSlug]/tasks/actions";
import { Button } from "@/components/ui/button";
import { RELATION_LABELS, type AssignmentRelationValue } from "@/lib/tasks/assignment";
import { formatDueKey } from "@/lib/tasks/dates";
import type { TaskActivityItem } from "@/server/tasks/queries";

import { STATUS_LABELS } from "./status-select";
import { useTasks } from "./tasks-context";

/** The task's history (TaskActivity, append-only), loaded on demand. */

type Diff = Record<string, unknown>;

function describe(item: TaskActivityItem, nameOf: (id: unknown) => string): string {
  const d = (item.diffJson ?? {}) as Diff;
  const role = d.role === "owner" ? "owner" : "collaborator";
  switch (item.type) {
    case "CREATED":
      return d.intake
        ? "filed this request"
        : d.parentTaskId
          ? "created this subtask"
          : "created this task";
    case "ASSIGNED": {
      const rel =
        typeof d.relation === "string"
          ? RELATION_LABELS[d.relation as AssignmentRelationValue]
          : null;
      return `made ${nameOf(d.userId)} the ${role}${rel ? ` (${rel.toLowerCase()})` : ""}`;
    }
    case "UNASSIGNED":
      return `removed ${nameOf(d.userId)} as ${role}`;
    case "FLAGGED":
      return `assigned ${nameOf(d.userId)} above their level (flagged)`;
    case "FLAG_ACKNOWLEDGED":
      return `acknowledged the flag for ${nameOf(d.userId)}`;
    case "STATUS_CHANGED":
      return `moved it from ${STATUS_LABELS[d.from as keyof typeof STATUS_LABELS] ?? d.from} to ${
        STATUS_LABELS[d.to as keyof typeof STATUS_LABELS] ?? d.to
      }`;
    case "BLOCKED":
      return `marked it blocked: ${typeof d.reason === "string" ? d.reason : ""}`;
    case "DUE_CHANGED":
      return `changed the due date to ${typeof d.to === "string" ? formatDueKey(d.to) : "none"}`;
    case "COMMENTED":
      return "commented";
    default:
      return item.type.toLowerCase().replace(/_/g, " ");
  }
}

export function TaskActivity({ taskId }: { taskId: string }) {
  const { org, memberById } = useTasks();
  const [items, setItems] = useState<TaskActivityItem[] | null>(null);
  const [isPending, startTransition] = useTransition();
  const nameOf = (id: unknown) =>
    typeof id === "string" ? (memberById.get(id)?.name ?? "a former member") : "someone";

  if (items === null) {
    return (
      <Button
        variant="link"
        size="sm"
        className="h-auto p-0"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            setItems(await loadTaskActivity(org.id, taskId));
          })
        }
      >
        {isPending ? "Loading history…" : "Show history"}
      </Button>
    );
  }
  if (items.length === 0) return <p className="text-muted-foreground text-sm">No history yet.</p>;
  return (
    <ol className="text-muted-foreground space-y-1.5 text-xs">
      {items.map((item) => (
        <li key={item.id}>
          <span className="text-foreground font-medium">{item.actor?.name ?? "Someone"}</span>{" "}
          {describe(item, nameOf)}{" "}
          <time dateTime={new Date(item.createdAt).toISOString()}>
            · {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
          </time>
        </li>
      ))}
    </ol>
  );
}
