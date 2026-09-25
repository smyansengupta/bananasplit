"use client";

import { ChevronDown, ChevronRight, Columns3 } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { useBlockedReason, useConfirmFlagged } from "@/components/tasks/prompts";
import { QuickPriority, QuickStatus } from "@/components/tasks/quick-controls";
import { STATUS_LABELS } from "@/components/tasks/status-select";
import {
  DueLabel,
  FlagBadge,
  PrivateMark,
  isTaskFlagged,
  isTaskPrivate,
} from "@/components/tasks/task-badges";
import { accessSubjectOf, useTasks, useWorkspace } from "@/components/tasks/tasks-context";
import type { TaskItem } from "@/components/tasks/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UserAvatar } from "@/components/user-avatar";
import { TaskStatus } from "@/generated/prisma/enums";
import { canEditTask, canTriage } from "@/lib/tasks/access";
import { relationFor } from "@/lib/tasks/assignment";
import { cn } from "@/lib/utils";

import { bulkAssign, bulkDelete, bulkUpdateStatus } from "../actions";

/**
 * The task table: server-paginated (50 a page), sortable within the page,
 * hideable columns including Owner and Creator, and bulk status, assign
 * and delete through the same checked path as single edits.
 */

type SortKey = "title" | "dueDate" | "priority" | "status";
const PRIORITY_RANK: Record<string, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };
const COLUMN_KEYS = [
  "owner",
  "involved",
  "creator",
  "project",
  "labels",
  "priority",
  "dueDate",
] as const;
type ColumnKey = (typeof COLUMN_KEYS)[number];
const COLUMN_LABELS: Record<ColumnKey, string> = {
  owner: "Owner",
  involved: "Also involved",
  creator: "Creator",
  project: "Project",
  labels: "Labels",
  priority: "Priority",
  dueDate: "Due date",
};

export function TaskTable({
  tasks,
  total,
  page,
  pageSize,
}: {
  tasks: TaskItem[];
  total: number;
  page: number;
  pageSize: number;
}) {
  const { org, viewer, actor, members, memberById, announce, showTask, newTask } = useTasks();
  const ws = useWorkspace();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [blockedPrompt, askReason] = useBlockedReason();
  const [confirmElement, confirmFlagged] = useConfirmFlagged();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [visible, setVisible] = useState<Record<ColumnKey, boolean>>({
    owner: true,
    involved: false,
    creator: true,
    project: true,
    labels: true,
    priority: true,
    dueDate: true,
  });

  const sorted = useMemo(() => {
    if (!sortKey) return tasks;
    const factor = sortDir === "asc" ? 1 : -1;
    return [...tasks].sort((a, b) => {
      if (sortKey === "title") return factor * a.title.localeCompare(b.title);
      if (sortKey === "priority")
        return factor * (PRIORITY_RANK[a.priority]! - PRIORITY_RANK[b.priority]!);
      if (sortKey === "status") return factor * a.status.localeCompare(b.status);
      const at = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
      const bt = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
      return factor * (at - bt);
    });
  }, [tasks, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function runBulk(action: () => Promise<{ error?: string; confirm?: unknown }>) {
    startTransition(async () => {
      const result = await action();
      if (result.error) {
        announce(result.error);
        return;
      }
      setSelected(new Set());
    });
  }

  async function bulkStatus(status: TaskStatus) {
    let reason: string | null = null;
    if (status === TaskStatus.BLOCKED) {
      reason = await askReason();
      if (!reason) return;
    }
    runBulk(() => bulkUpdateStatus(org.id, [...selected], status, reason));
  }

  async function bulkOwner(userId: string) {
    let confirmed = false;
    if (relationFor(viewer.chart, userId) === "ABOVE") {
      confirmed = await confirmFlagged([memberById.get(userId)?.name ?? "This person"]);
      if (!confirmed) return;
    }
    runBulk(() =>
      bulkAssign(org.id, [...selected], userId, { role: "owner", confirmFlagged: confirmed }),
    );
  }

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const pageHref = (p: number) => {
    const params = new URLSearchParams(searchParams.toString());
    if (p <= 1) params.delete("page");
    else params.set("page", String(p));
    return `${pathname}?${params.toString()}`;
  };
  const colSpan = 3 + COLUMN_KEYS.filter((k) => visible[k]).length;

  return (
    <div className="space-y-3">
      {blockedPrompt}
      {confirmElement}
      {selected.size > 0 && (
        <div
          role="toolbar"
          aria-label="Actions for the selected tasks"
          className="bg-popover ring-border fixed inset-x-4 bottom-4 z-40 flex flex-wrap items-center gap-2 rounded-xl p-2 shadow-lg ring-1 sm:inset-x-auto sm:left-1/2 sm:w-auto sm:-translate-x-1/2"
        >
          <span className="ps-1.5 text-sm font-medium">{selected.size} selected</span>
          <Select onValueChange={(s) => void bulkStatus(s as TaskStatus)} disabled={isPending}>
            <SelectTrigger className="h-8 w-40">
              <SelectValue placeholder="Change status" />
            </SelectTrigger>
            <SelectContent>
              {Object.values(TaskStatus).map((s) => (
                <SelectItem key={s} value={s}>
                  {STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select onValueChange={(u) => void bulkOwner(u)} disabled={isPending}>
            <SelectTrigger className="h-8 w-44">
              <SelectValue placeholder="Set owner" />
            </SelectTrigger>
            <SelectContent>
              {members.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name ?? "Member"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="destructive"
            disabled={isPending}
            onClick={() => runBulk(() => bulkDelete(org.id, [...selected]))}
          >
            Delete
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Cancel
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-muted-foreground text-sm">
          {total === 0 ? "No tasks" : `${total} task${total === 1 ? "" : "s"}`}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Columns3 className="size-4" />
              Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {COLUMN_KEYS.map((key) => (
              <DropdownMenuCheckboxItem
                key={key}
                checked={visible[key]}
                onCheckedChange={(checked) => setVisible((prev) => ({ ...prev, [key]: checked }))}
              >
                {COLUMN_LABELS[key]}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={selected.size > 0 && selected.size === tasks.length}
                  onCheckedChange={() =>
                    setSelected((prev) =>
                      prev.size === tasks.length ? new Set() : new Set(tasks.map((t) => t.id)),
                    )
                  }
                  aria-label="Select all tasks on this page"
                />
              </TableHead>
              <SortableHead
                label="Title"
                sortKey="title"
                active={sortKey}
                dir={sortDir}
                onClick={toggleSort}
              />
              <SortableHead
                label="Status"
                sortKey="status"
                active={sortKey}
                dir={sortDir}
                onClick={toggleSort}
              />
              {visible.owner && <TableHead>Owner</TableHead>}
              {visible.involved && <TableHead>Also involved</TableHead>}
              {visible.priority && (
                <SortableHead
                  label="Priority"
                  sortKey="priority"
                  active={sortKey}
                  dir={sortDir}
                  onClick={toggleSort}
                />
              )}
              {visible.dueDate && (
                <SortableHead
                  label="Due"
                  sortKey="dueDate"
                  active={sortKey}
                  dir={sortDir}
                  onClick={toggleSort}
                />
              )}
              {visible.labels && <TableHead>Labels</TableHead>}
              {visible.project && <TableHead>Project</TableHead>}
              {visible.creator && <TableHead>Creator</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.length === 0 && (
              <TableRow>
                <TableCell colSpan={colSpan} className="py-12 text-center">
                  <p className="text-sm font-medium">
                    {ws.filterCount > 0 ? "No tasks match these filters" : "No tasks here yet"}
                  </p>
                  <p className="text-muted-foreground mt-1 text-sm">
                    {ws.filterCount > 0
                      ? "Remove one of the filters above to widen the search."
                      : "The table lists every task in the club, 50 to a page."}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-3"
                    onClick={() =>
                      ws.filterCount > 0
                        ? ws.setFilters({
                            status: undefined,
                            labelId: undefined,
                            q: undefined,
                            flagged: false,
                            blockers: false,
                            visibility: undefined,
                          })
                        : newTask()
                    }
                  >
                    {ws.filterCount > 0 ? "Clear filters" : "New task"}
                  </Button>
                </TableCell>
              </TableRow>
            )}
            {sorted.map((task) => {
              const access = accessSubjectOf(task);
              const editable = canEditTask(actor, access);
              const isExpanded = expanded.has(task.id);
              const doneSubtasks = task.subtasks.filter(
                (s) => s.status === TaskStatus.COMPLETED,
              ).length;
              return (
                <FragmentRows key={task.id}>
                  <TableRow
                    className="hover:bg-muted/50 cursor-pointer"
                    onClick={() => showTask(task)}
                  >
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selected.has(task.id)}
                        onCheckedChange={() => toggleSelected(task.id)}
                        aria-label={`Select ${task.title}`}
                      />
                    </TableCell>
                    <TableCell className="max-w-md">
                      <div className="flex items-center gap-1">
                        {task.subtasks.length > 0 ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpanded((prev) => {
                                const next = new Set(prev);
                                if (next.has(task.id)) next.delete(task.id);
                                else next.add(task.id);
                                return next;
                              });
                            }}
                            className="text-muted-foreground"
                            aria-label={isExpanded ? "Collapse subtasks" : "Expand subtasks"}
                          >
                            {isExpanded ? (
                              <ChevronDown className="size-4" />
                            ) : (
                              <ChevronRight className="size-4" />
                            )}
                          </button>
                        ) : (
                          <span className="w-4" />
                        )}
                        {isTaskPrivate(task) && <PrivateMark />}
                        <span className="truncate">{task.title}</span>
                        {task.subtasks.length > 0 && (
                          <span className="text-muted-foreground text-xs">
                            ({doneSubtasks}/{task.subtasks.length})
                          </span>
                        )}
                        {isTaskFlagged(task) && <FlagBadge className="ml-1" />}
                      </div>
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <QuickStatus task={task} disabled={!editable} />
                    </TableCell>
                    {visible.owner && (
                      <TableCell>
                        {task.owner ? (
                          <span className="flex items-center gap-1.5">
                            <UserAvatar user={task.owner} size="xs" />
                            <span className="truncate">{task.owner.name}</span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">No owner</span>
                        )}
                      </TableCell>
                    )}
                    {visible.involved && (
                      <TableCell>
                        <span className="flex -space-x-1">
                          {task.assignees.map((a) => (
                            <UserAvatar key={a.userId} user={a.user} size="xs" />
                          ))}
                          {task.assignees.length === 0 && (
                            <span className="text-muted-foreground">–</span>
                          )}
                        </span>
                      </TableCell>
                    )}
                    {visible.priority && (
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <QuickPriority
                          task={task}
                          disabled={!editable || !canTriage(actor, access)}
                        />
                      </TableCell>
                    )}
                    {visible.dueDate && (
                      <TableCell>
                        {task.dueDate ? (
                          <DueLabel
                            dueDate={task.dueDate}
                            todayKey={org.todayKey}
                            done={task.status === "COMPLETED"}
                          />
                        ) : (
                          <span className="text-muted-foreground">–</span>
                        )}
                      </TableCell>
                    )}
                    {visible.labels && (
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {task.labels.map(({ label }) => (
                            <Badge
                              key={label.id}
                              style={{ backgroundColor: label.color, color: "white" }}
                              className="border-0"
                            >
                              {label.name}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                    )}
                    {visible.project && <TableCell>{task.project?.name ?? "–"}</TableCell>}
                    {visible.creator && (
                      <TableCell>
                        <span className="flex items-center gap-1.5">
                          <UserAvatar user={task.createdBy} size="xs" />
                          <span className="truncate">{task.createdBy.name ?? "Former member"}</span>
                        </span>
                      </TableCell>
                    )}
                  </TableRow>
                  {isExpanded &&
                    task.subtasks.map((s) => (
                      <TableRow key={s.id} className="bg-muted/30">
                        <TableCell />
                        <TableCell colSpan={colSpan - 1}>
                          <div className="flex items-center gap-2 pl-6 text-sm">
                            <span
                              className={cn(
                                s.status === TaskStatus.COMPLETED &&
                                  "text-muted-foreground line-through",
                              )}
                            >
                              {s.title}
                            </span>
                            <span className="text-muted-foreground text-xs">
                              {STATUS_LABELS[s.status]}
                            </span>
                            {s.owner && <UserAvatar user={s.owner} size="xs" />}
                            {s.dueDate && (
                              <DueLabel
                                dueDate={s.dueDate}
                                todayKey={org.todayKey}
                                className="text-xs"
                              />
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                </FragmentRows>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          {total === 0
            ? "No tasks"
            : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`}
        </span>
        {pages > 1 && (
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm" disabled={page <= 1}>
              <Link
                href={pageHref(page - 1)}
                aria-disabled={page <= 1}
                className={cn(page <= 1 && "pointer-events-none opacity-50")}
              >
                Previous
              </Link>
            </Button>
            <span className="text-muted-foreground">
              Page {page} of {pages}
            </span>
            <Button asChild variant="outline" size="sm">
              <Link
                href={pageHref(page + 1)}
                aria-disabled={page >= pages}
                className={cn(page >= pages && "pointer-events-none opacity-50")}
              >
                Next
              </Link>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function FragmentRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function SortableHead({
  label,
  sortKey,
  active,
  dir,
  onClick,
}: {
  label: string;
  sortKey: SortKey;
  active: SortKey | null;
  dir: "asc" | "desc";
  onClick: (key: SortKey) => void;
}) {
  return (
    <TableHead>
      <button
        type="button"
        onClick={() => onClick(sortKey)}
        className="hover:text-foreground flex items-center gap-1"
      >
        {label}
        {active === sortKey && (
          <ChevronDown className={cn("size-3", dir === "asc" && "rotate-180")} aria-hidden="true" />
        )}
      </button>
    </TableHead>
  );
}
