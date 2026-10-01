"use client";

import { Network, Plus, UserRoundSearch } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { TaskRow } from "@/components/tasks/task-row";
import { useTasks, useWorkspace } from "@/components/tasks/tasks-context";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UserAvatar } from "@/components/user-avatar";
import { dueDateKey } from "@/lib/tasks/dates";
import { cn } from "@/lib/utils";
import type { TeamLane, TeamView as TeamViewData } from "@/server/tasks/team";
import { TASK_PANEL } from "@/components/tasks/layout-ui";

const LANE_PREVIEW = 6;

/**
 * Team: one lane per person down the viewer's reporting line (the whole
 * chart, or any position, for OWNER/ADMIN), with open hires, advisors and an
 * unpositioned bucket.
 *
 * The lanes hold ROWS, not a horizontal strip of cards. Cards in a sideways
 * scroller meant you could not compare two people without dragging, and the
 * fifth task in a lane was always off screen. Rows stack, so a lane's height
 * is its load — the thing a president is actually scanning for — and due
 * dates line up down the right edge across every lane.
 *
 * Each lane header carries "New task for {name}", which is what handing work
 * down actually looks like: you are already looking at the person.
 */
export function TeamView({ data }: { data: TeamViewData }) {
  const { org } = useTasks();
  const ws = useWorkspace();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

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
          <Link
            href={`/app/${org.slug}/org-chart`}
            className="text-sm underline underline-offset-4"
          >
            View the org chart
          </Link>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      {(data.scopeOptions.length > 0 || !data.hasChart) && (
        <div className="flex flex-wrap items-center gap-3">
          {data.scopeOptions.length > 0 && (
            <Select value={data.scope} onValueChange={setScope}>
              <SelectTrigger className="h-8 w-72 text-sm" aria-label="Which part of the chart">
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
              No published org chart, so this is one lane per member.{" "}
              <Link href={`/app/${org.slug}/org-chart`} className="underline underline-offset-4">
                Publish a chart
              </Link>{" "}
              to group them by reporting line.
            </p>
          )}
        </div>
      )}

      {ws.filterCount > 0 && (
        <p className="text-muted-foreground text-xs">
          Lanes are filtered by the toolbar. Someone with no matching task still shows an empty
          lane.
        </p>
      )}

      <div className="space-y-2.5">
        {data.lanes.map((lane) => (
          <Lane key={lane.key} lane={lane} todayKey={org.todayKey} />
        ))}
      </div>

      {data.advisors.length > 0 && (
        <section className="space-y-2.5" aria-labelledby="team-advisors">
          <h2
            id="team-advisors"
            className="text-muted-foreground text-xs font-semibold tracking-wide uppercase"
          >
            Advisors
          </h2>
          {data.advisors.map((lane) => (
            <Lane key={lane.key} lane={{ ...lane, depth: 0 }} todayKey={org.todayKey} />
          ))}
        </section>
      )}

      {data.unpositioned && data.unpositioned.length > 0 && (
        <Lane
          lane={{
            key: "unpositioned",
            positionTitle: "Owned by members without a position, or not owned at all",
            person: null,
            personName: "Off the chart",
            isOpen: false,
            depth: 0,
            tasks: data.unpositioned,
          }}
          todayKey={org.todayKey}
        />
      )}
    </div>
  );
}

function Lane({ lane, todayKey }: { lane: TeamLane; todayKey: string }) {
  const { newTask } = useTasks();
  const [expanded, setExpanded] = useState(false);
  const blocked = lane.tasks.filter((t) => t.status === "BLOCKED").length;
  const overdue = lane.tasks.filter(
    (t) => t.status !== "BLOCKED" && t.dueDate && dueDateKey(t.dueDate) < todayKey,
  ).length;
  const shown = expanded ? lane.tasks : lane.tasks.slice(0, LANE_PREVIEW);
  const hidden = lane.tasks.length - shown.length;
  const ownerId = lane.person?.id ?? null;

  return (
    <section
      className={cn("group/lane", TASK_PANEL)}
      style={{ marginInlineStart: `min(${lane.depth * 1.25}rem, 10vw)` }}
      aria-label={`${lane.personName ?? "Open position"}${lane.positionTitle ? `, ${lane.positionTitle}` : ""}`}
    >
      <header className="bg-muted/40 flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b px-3 py-2">
        {lane.person ? (
          <UserAvatar user={lane.person} size="sm" />
        ) : (
          <span
            className="border-border size-6 rounded-full border border-dashed"
            aria-hidden="true"
          />
        )}
        <span className="text-sm font-medium">
          {lane.isOpen ? "Open hire" : (lane.personName ?? "Unfilled")}
        </span>
        {lane.positionTitle && (
          <span className="text-muted-foreground text-xs">{lane.positionTitle}</span>
        )}

        <span className="ms-auto flex items-center gap-2.5 text-xs">
          <span className="text-muted-foreground tabular-nums">{lane.tasks.length} open</span>
          {overdue > 0 && (
            <span className="text-destructive font-medium tabular-nums">{overdue} overdue</span>
          )}
          {blocked > 0 && (
            <span className="text-destructive font-medium tabular-nums">{blocked} blocked</span>
          )}
          {ownerId && (
            <button
              type="button"
              onClick={() => newTask({ ownerId })}
              className={cn(
                "text-muted-foreground hover:text-foreground hover:bg-background focus-visible:ring-ring inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium transition-opacity duration-150 focus-visible:ring-2 focus-visible:outline-none",
                "opacity-0 group-focus-within/lane:opacity-100 group-hover/lane:opacity-100 focus-visible:opacity-100",
              )}
            >
              <Plus className="size-3.5" aria-hidden="true" />
              New task for {(lane.personName ?? "them").split(" ")[0]}
            </button>
          )}
        </span>
      </header>

      {lane.isOpen ? (
        <p className="text-muted-foreground px-3 py-3 text-sm">
          Nobody holds this position yet, so its work sits with the manager above.
        </p>
      ) : lane.tasks.length === 0 ? (
        <p className="text-muted-foreground px-3 py-3 text-sm">
          Nothing open.
          {ownerId && (
            <button
              type="button"
              onClick={() => newTask({ ownerId })}
              className="text-foreground ms-1 underline underline-offset-4"
            >
              Hand something down.
            </button>
          )}
        </p>
      ) : (
        <>
          <ul className="divide-border divide-y">
            {shown.map((task) => (
              <TaskRow key={task.id} task={task} showRole={false} />
            ))}
          </ul>
          {hidden > 0 && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="text-muted-foreground hover:text-foreground hover:bg-muted/40 w-full border-t px-3 py-1.5 text-left text-xs transition-colors"
            >
              Show {hidden} more
            </button>
          )}
        </>
      )}
    </section>
  );
}
