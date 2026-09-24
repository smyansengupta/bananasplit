"use client";

import { Network, UserRoundSearch } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { TaskCard } from "@/components/tasks/task-card";
import { TaskDetailDialog } from "@/components/tasks/task-detail-dialog";
import { useTasks } from "@/components/tasks/tasks-context";
import type { TaskItem } from "@/components/tasks/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UserAvatar } from "@/components/user-avatar";
import { dueDateKey } from "@/lib/tasks/dates";
import type { TeamLane, TeamView as TeamViewData } from "@/server/tasks/team";

/**
 * Team: one swimlane per person down the viewer's reporting line (the whole
 * chart, or any position, for OWNER/ADMIN), with open hires, advisors as a
 * side lane and an unpositioned bucket.
 */
export function TeamView({ data }: { data: TeamViewData }) {
  const { org } = useTasks();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  const allTasks = useMemo(
    () => [...data.lanes, ...data.advisors].flatMap((l) => l.tasks).concat(data.unpositioned ?? []),
    [data],
  );
  const openTask = openTaskId ? (allTasks.find((t) => t.id === openTaskId) ?? null) : null;

  function setScope(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("position", value);
    router.replace(`${pathname}?${params.toString()}`);
  }

  if (data.offChart) {
    return (
      <EmptyState
        icon={UserRoundSearch}
        title="You're not on the org chart yet"
        description="The Team view follows reporting lines. Once an admin places you on the published chart, your team shows up here."
        action={
          <Link href={`/app/${org.slug}/org-chart`} className="text-sm underline underline-offset-4">
            View the org chart
          </Link>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {data.scopeOptions.length > 0 && (
          <Select value={data.scope} onValueChange={setScope}>
            <SelectTrigger className="w-72" aria-label="Team scope">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {data.scopeOptions.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {!data.hasChart && (
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <Network className="size-4" aria-hidden="true" />
            No published org chart: one lane per member. Publish a chart to group lanes by reporting line.
          </p>
        )}
      </div>

      <div className="space-y-3">
        {data.lanes.map((lane) => (
          <Lane key={lane.key} lane={lane} todayKey={org.todayKey} onOpen={setOpenTaskId} />
        ))}
      </div>

      {data.advisors.length > 0 && (
        <section className="space-y-2" aria-labelledby="team-advisors">
          <h2 id="team-advisors" className="text-muted-foreground text-sm font-semibold">
            Advisors
          </h2>
          {data.advisors.map((lane) => (
            <Lane key={lane.key} lane={{ ...lane, depth: 0 }} todayKey={org.todayKey} onOpen={setOpenTaskId} />
          ))}
        </section>
      )}

      {data.unpositioned && data.unpositioned.length > 0 && (
        <Lane
          lane={{
            key: "unpositioned",
            positionTitle: "Owned by members without a position, or unowned",
            person: null,
            personName: "Unpositioned",
            isOpen: false,
            depth: 0,
            tasks: data.unpositioned,
          }}
          todayKey={org.todayKey}
          onOpen={setOpenTaskId}
        />
      )}

      <TaskDetailDialog open={openTaskId !== null} onOpenChange={(o) => !o && setOpenTaskId(null)} task={openTask} />
    </div>
  );
}

function Lane({ lane, todayKey, onOpen }: { lane: TeamLane; todayKey: string; onOpen: (id: string) => void }) {
  const blocked = lane.tasks.filter((t) => t.status === "BLOCKED").length;
  const overdue = lane.tasks.filter((t) => t.status !== "BLOCKED" && t.dueDate && dueDateKey(t.dueDate) < todayKey).length;
  return (
    <section
      className="rounded-lg border"
      style={{ marginLeft: `min(${lane.depth * 1.5}rem, 12vw)` }}
      aria-label={`${lane.personName ?? "Open position"}${lane.positionTitle ? `, ${lane.positionTitle}` : ""}`}
    >
      <header className="bg-muted/40 flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-2">
        {lane.person ? (
          <UserAvatar user={lane.person} size="sm" />
        ) : (
          <span className="size-6 rounded-full border border-dashed" aria-hidden="true" />
        )}
        <span className="text-sm font-medium">{lane.isOpen ? "Open hire" : (lane.personName ?? "Unfilled")}</span>
        {lane.positionTitle && <span className="text-muted-foreground text-sm">{lane.positionTitle}</span>}
        <span className="text-muted-foreground ml-auto flex gap-3 text-xs">
          <span>{lane.tasks.length} open</span>
          {overdue > 0 && <span className="text-destructive">{overdue} overdue</span>}
          {blocked > 0 && <span className="text-destructive">{blocked} blocked</span>}
        </span>
      </header>
      {lane.isOpen ? (
        <p className="text-muted-foreground px-3 py-3 text-sm">Nobody holds this position yet; its work goes to the manager above.</p>
      ) : lane.tasks.length === 0 ? (
        <p className="text-muted-foreground px-3 py-3 text-sm">No open tasks.</p>
      ) : (
        <ul className="flex gap-2 overflow-x-auto p-2">
          {lane.tasks.map((t: TaskItem) => (
            <li key={t.id} className="w-64 shrink-0">
              <button type="button" className="w-full text-left" onClick={() => onOpen(t.id)} aria-label={`Open ${t.title}`}>
                <TaskCard task={t} todayKey={todayKey} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
