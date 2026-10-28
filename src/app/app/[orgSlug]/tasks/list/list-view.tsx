"use client";

import { ChevronRight, CircleCheck, Plus } from "@/components/icons";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

import { createTask } from "@/app/app/[orgSlug]/tasks/actions";
import { EmptyState } from "@/components/empty-state";
import { ClearCompletedButton } from "@/components/tasks/clear-completed";
import { TASK_PANEL } from "@/components/tasks/layout-ui";
import { HashTagHint } from "@/components/tasks/tag-menu";
import { EpicDot } from "@/components/tasks/epic-menu";
import { TaskRow } from "@/components/tasks/task-row";
import { ProgressBar, TaskTypeChip } from "@/components/tasks/task-type";
import { useTasks, useWorkspace } from "@/components/tasks/tasks-context";
import type { TaskItem } from "@/components/tasks/types";
import { useHashTags } from "@/components/tasks/use-hash-tags";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { rollUp } from "@/lib/tasks/hierarchy";
import { epicColor } from "@/lib/tasks/epic";
import { cn } from "@/lib/utils";

type Ref = { id: string; title: string; color?: string | null };

interface StoryGroup {
  story: Ref;
  item?: TaskItem;
  tasks: TaskItem[];
}

interface EpicGroup {
  epic: Ref | null;
  item?: TaskItem;
  stories: Map<string, StoryGroup>;
  tasks: TaskItem[];
  /** Open order: where the group's first row was in the soonest-due list. */
  order: number;
}

/**
 * Sorts the open tasks into epics, each with its stories (their tasks under
 * them) and its plain tasks, then everything outside an epic. Two levels up
 * are known from each task (parentTask.parentTask), so a task finds its
 * epic even when its story isn't in the list.
 */
function groupByEpic(tasks: TaskItem[]): EpicGroup[] {
  const groups = new Map<string, EpicGroup>();
  const groupFor = (epic: Ref | null, order: number) => {
    const key = epic?.id ?? "none";
    let g = groups.get(key);
    if (!g) {
      g = { epic, stories: new Map(), tasks: [], order };
      groups.set(key, g);
    }
    return g;
  };
  const storyIn = (g: EpicGroup, story: Ref) => {
    let s = g.stories.get(story.id);
    if (!s) {
      s = { story, tasks: [] };
      g.stories.set(story.id, s);
    }
    return s;
  };
  tasks.forEach((t, i) => {
    const parent = t.parentTask;
    const grand = parent?.parentTask ?? null;
    if (t.type === "EPIC") {
      groupFor({ id: t.id, title: t.title, color: t.color }, i).item = t;
      return;
    }
    const epic = parent?.type === "EPIC" ? parent : grand?.type === "EPIC" ? grand : null;
    const g = groupFor(epic ? { id: epic.id, title: epic.title, color: epic.color } : null, i);
    if (t.type === "STORY") {
      storyIn(g, { id: t.id, title: t.title }).item = t;
    } else if (parent?.type === "STORY") {
      storyIn(g, { id: parent.id, title: parent.title }).tasks.push(t);
    } else {
      g.tasks.push(t);
    }
  });
  return [...groups.values()].sort((a, b) => (!a.epic ? 1 : !b.epic ? -1 : a.order - b.order));
}

/**
 * The List: the club's open work grouped by epic (epic > stories > tasks,
 * with roll-up progress), then what sits outside an epic, and what was done
 * this week folded away underneath. A club that never makes epics gets one
 * plain list, soonest due first, as before. The quick add at the top takes
 * `#tags` (not on a phone, where the List is the only layout and New task at
 * the top right adds).
 */
export function ListView({
  open,
  completed,
  hasMore,
  moreLimit,
}: {
  open: TaskItem[];
  completed: TaskItem[];
  hasMore: boolean;
  moreLimit: number;
}) {
  const { newTask } = useTasks();
  const ws = useWorkspace();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [showDone, setShowDone] = useState(false);
  const mine = ws.query.scope === "mine";
  const groups = groupByEpic(open);
  const anyEpic = groups.some((g) => g.epic);

  function showMore() {
    const params = new URLSearchParams(searchParams.toString());
    params.set("limit", String(moreLimit));
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }

  if (open.length === 0 && completed.length === 0) {
    return (
      <div className="space-y-4">
        <QuickAdd />
        <EmptyState
          icon={CircleCheck}
          title={ws.filterCount > 0 ? "Nothing matches that" : "No tasks yet"}
          description={
            ws.filterCount > 0
              ? "Clear the search or filters to see every task."
              : "Write down what needs doing and who is on it."
          }
          action={
            ws.filterCount > 0 ? (
              <Button variant="outline" onClick={ws.clearFilters}>
                Clear filters
              </Button>
            ) : (
              <Button variant="create" onClick={() => newTask()}>
                New task
              </Button>
            )
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-[30px] max-md:space-y-5">
      <QuickAdd />
      {open.length === 0 && (
        <p className="text-muted-foreground text-sm">Everything here is done.</p>
      )}
      {!anyEpic && open.length > 0 && (
        <ul className={TASK_PANEL} aria-label="Open tasks">
          {open.map((task) => (
            <TaskRow key={task.id} task={task} showOwner={!mine} />
          ))}
        </ul>
      )}
      {anyEpic &&
        groups.map((g) => <EpicSection key={g.epic?.id ?? "none"} group={g} showOwner={!mine} />)}

      {hasMore && (
        <Button variant="outline" onClick={showMore}>
          Show more open tasks
        </Button>
      )}

      {completed.length > 0 && (
        <section>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowDone((v) => !v)}
              aria-expanded={showDone}
              className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 rounded-full py-1 text-sm font-medium transition-colors"
            >
              <ChevronRight
                className={cn("size-4 transition-transform duration-150", showDone && "rotate-90")}
                aria-hidden="true"
              />
              Done in the last 7 days
              <Badge variant="secondary">{completed.length}</Badge>
            </button>
            <span className="flex-1" />
            <ClearCompletedButton tasks={completed} />
          </div>
          {showDone && (
            <ul className={cn("mt-2", TASK_PANEL)}>
              {completed.map((task) => (
                <TaskRow key={task.id} task={task} showOwner={!mine} />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function EpicSection({ group, showOwner }: { group: EpicGroup; showOwner: boolean }) {
  const { openTask, showTask, newTask } = useTasks();
  const epic = group.epic;
  const item = group.item;
  const progress = item ? rollUp(item.subtasks) : null;
  const color = epic ? epicColor({ id: epic.id, color: item?.color ?? epic.color ?? null }) : null;
  const count =
    group.tasks.length + [...group.stories.values()].reduce((n, s) => n + 1 + s.tasks.length, 0);

  return (
    <section className="space-y-2.5" aria-label={epic ? `Epic: ${epic.title}` : "Not in an epic"}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 px-1">
        {epic ? (
          <>
            <EpicDot epic={{ id: epic.id, color: item?.color ?? epic.color ?? null }} />
            <button
              type="button"
              onClick={() => (item ? showTask(item) : openTask(epic.id))}
              className="heading min-w-0 truncate text-left underline-offset-4 hover:underline"
            >
              {epic.title}
            </button>
            {progress && progress.total > 0 && (
              <ProgressBar
                done={progress.done}
                total={progress.total}
                color={color ?? "var(--chart-4)"}
                className="w-36"
              />
            )}
            <span className="flex-1" />
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                newTask({
                  parentTaskId: epic.id,
                  parentType: "EPIC",
                  visibility: item?.visibility,
                })
              }
            >
              <Plus className="size-4" aria-hidden="true" />
              Add to epic
            </Button>
          </>
        ) : (
          <>
            <h2 className="heading">Not in an epic</h2>
            <Badge variant="secondary">{count}</Badge>
          </>
        )}
      </div>
      {count > 0 && (
        <ul className={TASK_PANEL}>
          {[...group.stories.values()].map((s) => (
            <StoryRows key={s.story.id} group={s} showOwner={showOwner} nested={Boolean(epic)} />
          ))}
          {group.tasks.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              showOwner={showOwner}
              showParent={false}
              showEpic={false}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function StoryRows({
  group,
  showOwner,
  nested: _nested,
}: {
  group: StoryGroup;
  showOwner: boolean;
  nested: boolean;
}) {
  const { openTask } = useTasks();
  return (
    <>
      {group.item ? (
        <TaskRow task={group.item} showOwner={showOwner} showParent={false} showEpic={false} />
      ) : (
        <li className="rounded-field relative flex items-center gap-3 px-3 py-2.5">
          <TaskTypeChip type="STORY" iconOnly />
          <button
            type="button"
            onClick={() => openTask(group.story.id)}
            className="text-muted-foreground truncate text-left text-sm font-medium hover:underline"
          >
            {group.story.title}
          </button>
        </li>
      )}
      {group.tasks.map((t) => (
        <TaskRow
          key={t.id}
          task={t}
          showOwner={showOwner}
          showParent={false}
          showEpic={false}
          depth={1}
        />
      ))}
    </>
  );
}

/** "Add a task… #tag": a title (with #tags), into the epic in view. */
function QuickAdd() {
  const { org, viewer, announce } = useTasks();
  const ws = useWorkspace();
  const hashTags = useHashTags();
  const [title, setTitle] = useState("");
  const [isPending, startTransition] = useTransition();

  function submit() {
    const text = title.trim();
    if (!text || isPending) return;
    startTransition(async () => {
      const resolved = await hashTags.resolve(text);
      if (resolved.error) announce(resolved.error);
      const result = await createTask(org.id, {
        title: resolved.title,
        labelIds: resolved.labelIds,
        parentTaskId: ws.query.epicId ?? null,
        ownerId: viewer.userId,
      });
      if (result.error) {
        announce(result.error);
        return;
      }
      setTitle("");
    });
  }

  // Not on a phone: there, adding is the header's New task, at the top right.
  return (
    <div className="space-y-1.5 max-md:hidden">
      <div className="bg-card edge focus-within:outline-foreground flex h-12 items-center gap-3 rounded-full ps-4 pe-1.5 focus-within:outline-2 focus-within:outline-offset-2">
        <Plus className="text-muted-foreground size-5 shrink-0" aria-hidden="true" />
        <label htmlFor="quick-add" className="sr-only">
          Add a task
        </label>
        <input
          id="quick-add"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          maxLength={240}
          placeholder="Add a task… (#tag to tag it)"
          className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-[15px] outline-none"
        />
        <Button size="sm" onClick={submit} disabled={isPending || !title.trim()}>
          {isPending ? "Adding…" : "Add"}
        </Button>
      </div>
      <HashTagHint title={title} className="ps-4" />
    </div>
  );
}
