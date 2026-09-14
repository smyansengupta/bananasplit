"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { ChevronDown, ChevronRight, Columns3 } from "lucide-react";

import type { OrgMemberOption } from "@/components/tasks/assignee-picker";
import type { LabelOption } from "@/components/tasks/label-picker";
import { STATUS_LABELS } from "@/components/tasks/status-select";
import { formatDueDate, isOverdue } from "@/components/tasks/utils";
import { TaskDetailDialog } from "@/components/tasks/task-detail-dialog";
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
import { TaskStatus } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";

import { bulkAssign, bulkDelete, bulkUpdateStatus } from "../actions";
import type { TaskWithRelations } from "../queries";

// Plain client-side pagination rather than virtualization: this table has no
// windowing library, and a page-at-a-time render keeps the DOM small without
// one. Revisit if a real org's task count outgrows this (spec 6.4).
const PAGE_SIZE = 100;

type SortKey = "title" | "dueDate" | "priority" | "status";
const PRIORITY_RANK: Record<string, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };
const COLUMN_KEYS = ["project", "assignees", "labels", "priority", "dueDate"] as const;
type ColumnKey = (typeof COLUMN_KEYS)[number];
const COLUMN_LABELS: Record<ColumnKey, string> = {
  project: "Project",
  assignees: "Assignees",
  labels: "Labels",
  priority: "Priority",
  dueDate: "Due date",
};

export function TaskTable({
  orgId,
  tasks,
  members,
  labels,
  projects,
}: {
  orgId: string;
  tasks: TaskWithRelations[];
  members: OrgMemberOption[];
  labels: LabelOption[];
  projects: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [visibleColumns, setVisibleColumns] = useState<Record<ColumnKey, boolean>>({
    project: true,
    assignees: true,
    labels: true,
    priority: true,
    dueDate: true,
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  // Store only the id and derive the task from the live `tasks` prop — a
  // captured snapshot wouldn't reflect edits (e.g. toggling a subtask) made
  // while the dialog stays open across a router.refresh().
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const editingTask = editingTaskId ? (tasks.find((t) => t.id === editingTaskId) ?? null) : null;

  const sortedTasks = useMemo(() => {
    if (!sortKey) return tasks;
    const factor = sortDir === "asc" ? 1 : -1;
    return [...tasks].sort((a, b) => {
      if (sortKey === "title") return factor * a.title.localeCompare(b.title);
      if (sortKey === "priority")
        return factor * (PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
      if (sortKey === "status") return factor * a.status.localeCompare(b.status);
      const aTime = a.dueDate?.getTime() ?? Infinity;
      const bTime = b.dueDate?.getTime() ?? Infinity;
      return factor * (aTime - bTime);
    });
  }, [tasks, sortKey, sortDir]);

  const pagedTasks = useMemo(
    () => sortedTasks.slice(0, visibleCount),
    [sortedTasks, visibleCount],
  );

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function toggleSelected(taskId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) =>
      prev.size === pagedTasks.length ? new Set() : new Set(pagedTasks.map((t) => t.id)),
    );
  }

  function runBulk(action: () => Promise<unknown>) {
    startTransition(async () => {
      await action();
      setSelected(new Set());
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <>
              <span className="text-muted-foreground text-sm">{selected.size} selected</span>
              <Select
                onValueChange={(status) =>
                  runBulk(() => bulkUpdateStatus(orgId, [...selected], status as TaskStatus))
                }
              >
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
              <Select
                onValueChange={(userId) => runBulk(() => bulkAssign(orgId, [...selected], userId))}
              >
                <SelectTrigger className="h-8 w-40">
                  <SelectValue placeholder="Assign to" />
                </SelectTrigger>
                <SelectContent>
                  {members.map((m) => (
                    <SelectItem key={m.userId} value={m.userId}>
                      {m.name ?? m.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => runBulk(() => bulkDelete(orgId, [...selected]))}
              >
                Delete
              </Button>
            </>
          )}
        </div>
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
                checked={visibleColumns[key]}
                onCheckedChange={(checked) =>
                  setVisibleColumns((prev) => ({ ...prev, [key]: checked }))
                }
              >
                {COLUMN_LABELS[key]}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={selected.size > 0 && selected.size === pagedTasks.length}
                  onCheckedChange={toggleAll}
                  aria-label="Select all tasks"
                />
              </TableHead>
              <SortableHead
                label="Title"
                sortKey="title"
                activeKey={sortKey}
                dir={sortDir}
                onClick={toggleSort}
              />
              <SortableHead
                label="Status"
                sortKey="status"
                activeKey={sortKey}
                dir={sortDir}
                onClick={toggleSort}
              />
              {visibleColumns.priority && (
                <SortableHead
                  label="Priority"
                  sortKey="priority"
                  activeKey={sortKey}
                  dir={sortDir}
                  onClick={toggleSort}
                />
              )}
              {visibleColumns.dueDate && (
                <SortableHead
                  label="Due"
                  sortKey="dueDate"
                  activeKey={sortKey}
                  dir={sortDir}
                  onClick={toggleSort}
                />
              )}
              {visibleColumns.assignees && <TableHead>Assignees</TableHead>}
              {visibleColumns.labels && <TableHead>Labels</TableHead>}
              {visibleColumns.project && <TableHead>Project</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {pagedTasks.map((task) => (
              <TaskTableRows
                key={task.id}
                task={task}
                depth={0}
                selected={selected}
                expanded={expanded}
                visibleColumns={visibleColumns}
                onToggleSelected={toggleSelected}
                onToggleExpanded={(id) =>
                  setExpanded((prev) => {
                    const next = new Set(prev);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    return next;
                  })
                }
                onOpen={(task) => {
                  setEditingTaskId(task.id);
                  setDialogOpen(true);
                }}
              />
            ))}
          </TableBody>
        </Table>
      </div>

      {sortedTasks.length > pagedTasks.length && (
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground text-sm">
            Showing {pagedTasks.length} of {sortedTasks.length} tasks
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
          >
            Show more
          </Button>
        </div>
      )}

      <TaskDetailDialog
        orgId={orgId}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        task={editingTask}
        members={members}
        labels={labels}
        projects={projects}
      />
    </div>
  );
}

function SortableHead({
  label,
  sortKey,
  activeKey,
  dir,
  onClick,
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey | null;
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
        {activeKey === sortKey &&
          (dir === "asc" ? <ChevronUpIcon /> : <ChevronDown className="size-3" />)}
      </button>
    </TableHead>
  );
}

function ChevronUpIcon() {
  return <ChevronDown className="size-3 rotate-180" aria-hidden="true" />;
}

function TaskTableRows({
  task,
  depth,
  selected,
  expanded,
  visibleColumns,
  onToggleSelected,
  onToggleExpanded,
  onOpen,
}: {
  task: TaskWithRelations;
  depth: number;
  selected: Set<string>;
  expanded: Set<string>;
  visibleColumns: Record<ColumnKey, boolean>;
  onToggleSelected: (id: string) => void;
  onToggleExpanded: (id: string) => void;
  onOpen: (task: TaskWithRelations) => void;
}) {
  const hasSubtasks = task.subtasks.length > 0;
  const isExpanded = expanded.has(task.id);
  const overdue = isOverdue(task.dueDate, task.status);
  const completedSubtasks = task.subtasks.filter((s) => s.status === TaskStatus.COMPLETED).length;

  return (
    <>
      <TableRow className="cursor-pointer" onClick={() => onOpen(task)}>
        <TableCell onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={selected.has(task.id)}
            onCheckedChange={() => onToggleSelected(task.id)}
          />
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-1" style={{ paddingLeft: depth * 16 }}>
            {hasSubtasks ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleExpanded(task.id);
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
              depth === 0 && <span className="w-4" />
            )}
            <span>{task.title}</span>
            {hasSubtasks && (
              <span className="text-muted-foreground text-xs">
                ({completedSubtasks}/{task.subtasks.length})
              </span>
            )}
          </div>
        </TableCell>
        <TableCell>{STATUS_LABELS[task.status]}</TableCell>
        {visibleColumns.priority && <TableCell>{task.priority}</TableCell>}
        {visibleColumns.dueDate && (
          <TableCell className={cn(overdue && "text-destructive font-medium")}>
            {task.dueDate ? formatDueDate(task.dueDate) : "—"}
          </TableCell>
        )}
        {visibleColumns.assignees && (
          <TableCell>
            {task.assignees.map((a) => a.user.name ?? a.user.email).join(", ") || "—"}
          </TableCell>
        )}
        {visibleColumns.labels && (
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
        {visibleColumns.project && <TableCell>{task.project?.name ?? "—"}</TableCell>}
      </TableRow>
      {isExpanded &&
        task.subtasks.map((s) => (
          <TableRow key={s.id} className="bg-muted/30">
            <TableCell />
            <TableCell colSpan={6}>
              <div className="flex items-center gap-2" style={{ paddingLeft: (depth + 1) * 16 }}>
                <span
                  className={
                    s.status === TaskStatus.COMPLETED ? "text-muted-foreground line-through" : ""
                  }
                >
                  {s.title}
                </span>
              </div>
            </TableCell>
          </TableRow>
        ))}
    </>
  );
}
