"use client";

import { CircleCheck, Layers, Pencil, Plus, RotateCcw, Trash2 } from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { EmptyState } from "@/components/empty-state";
import { ItemMenu } from "@/components/item-menu";
import { PageHeader } from "@/components/page-header";
import { ProgressBar } from "@/components/tasks/task-type";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/ui/chip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { UserAvatar } from "@/components/user-avatar";
import { formatDueKey } from "@/lib/tasks/dates";
import { epicColor } from "@/lib/tasks/epic";
import { cn } from "@/lib/utils";
import type { OrgMemberOption } from "@/server/members";

import { createTask, deleteTask, restoreTask, setTaskStatus, updateTask } from "../actions";

export interface EpicCardRow {
  id: string;
  title: string;
  description: string | null;
  color: string | null;
  status: string;
  ownerId: string | null;
  owner: { id: string; name: string | null; image: string | null; avatar: unknown } | null;
  startDate: string | null;
  dueDate: string | null;
  /** Stories straight under it. */
  stories: number;
  /** Its stories and tasks, open and done. */
  open: number;
  done: number;
  overdue: number;
}

type Filter = "going" | "done" | "all";

const STATUS: Record<string, { label: string; color: string }> = {
  NOT_STARTED: { label: "Not started", color: "var(--muted-foreground)" },
  IN_PROGRESS: { label: "In progress", color: "var(--brand-accent)" },
  BLOCKED: { label: "Blocked", color: "var(--destructive)" },
  COMPLETED: { label: "Done", color: "var(--success)" },
};

function datesText(start: string | null, due: string | null, todayKey: string): string | null {
  if (start && due) return `${formatDueKey(start, todayKey)} → ${formatDueKey(due, todayKey)}`;
  if (due) return `Due ${formatDueKey(due, todayKey)}`;
  if (start) return `From ${formatDueKey(start, todayKey)}`;
  return null;
}

/**
 * The Epics page: the big outcomes, each a card. One click opens its work
 * (the List filtered to it); New epic, Edit and the ••• menu cover the
 * rest. Done epics fold under their own filter.
 */
export function EpicsView({
  org,
  viewerId,
  todayKey,
  members,
  colors,
  epics,
}: {
  org: { id: string; slug: string };
  viewerId: string;
  todayKey: string;
  members: OrgMemberOption[];
  /** Colours an epic can take: the club's chart slots, then a few brights. */
  colors: string[];
  epics: EpicCardRow[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<EpicCardRow | "new" | null>(null);
  const [filter, setFilter] = useState<Filter>("going");
  const [, startTransition] = useTransition();
  const going = epics.filter((e) => e.status !== "COMPLETED");
  const finished = epics.filter((e) => e.status === "COMPLETED");
  const shown = filter === "going" ? going : filter === "done" ? finished : epics;

  function run(
    action: () => Promise<{ error?: string }>,
    success: string,
    undo?: () => Promise<{ error?: string }>,
  ) {
    startTransition(async () => {
      const result = await action();
      if (result.error) {
        toast({ title: result.error, tone: "error" });
        return;
      }
      toast({
        title: success,
        tone: "success",
        ...(undo ? { action: { label: "Undo", run: async () => (await undo()).error } } : {}),
      });
      router.refresh();
    });
  }

  const summary =
    epics.length === 0
      ? "Big outcomes that span weeks. Their stories and tasks roll up into them."
      : [
          `${going.length} going`,
          finished.length > 0 && `${finished.length} done`,
          going.reduce((n, e) => n + e.overdue, 0) > 0 &&
            `${going.reduce((n, e) => n + e.overdue, 0)} overdue tasks`,
        ]
          .filter(Boolean)
          .join(" · ");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Epics"
        description={summary}
        actions={
          <Button variant="create" onClick={() => setEditing("new")}>
            <Plus className="size-4" aria-hidden="true" />
            New epic
          </Button>
        }
      />

      {epics.length > 0 && (
        <Segmented
          label="Which epics"
          value={filter}
          onSelect={(v) => setFilter(v as Filter)}
          options={[
            { value: "going", label: `In progress (${going.length})` },
            { value: "done", label: `Done (${finished.length})` },
            { value: "all", label: "All" },
          ]}
        />
      )}

      {epics.length === 0 ? (
        <div className="bg-card edge rounded-card">
          <EmptyState
            icon={Layers}
            title="No epics yet"
            description="An epic is a big outcome, like “Fall Showcase”. Give it a colour, an owner and dates, then add its stories and tasks."
            action={
              <Button variant="create" onClick={() => setEditing("new")}>
                New epic
              </Button>
            }
          />
        </div>
      ) : shown.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {filter === "done" ? "No epic is done yet." : "Every epic is done."}
        </p>
      ) : (
        <ul className="grid gap-4.5 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((e) => (
            <EpicCard
              key={e.id}
              epic={e}
              orgSlug={org.slug}
              todayKey={todayKey}
              onEdit={() => setEditing(e)}
              onToggleDone={() =>
                e.status === "COMPLETED"
                  ? run(() => setTaskStatus(org.id, e.id, "NOT_STARTED"), `Reopened: ${e.title}`)
                  : run(
                      () => setTaskStatus(org.id, e.id, "COMPLETED"),
                      `Done: ${e.title}`,
                      () => setTaskStatus(org.id, e.id, "NOT_STARTED"),
                    )
              }
              onDelete={() =>
                run(
                  () => deleteTask(org.id, e.id),
                  `Deleted: ${e.title}`,
                  () => restoreTask(org.id, e.id),
                )
              }
            />
          ))}
        </ul>
      )}

      {editing && (
        <EpicDialog
          orgId={org.id}
          epic={editing === "new" ? null : editing}
          viewerId={viewerId}
          members={members}
          colors={colors}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function EpicCard({
  epic,
  orgSlug,
  todayKey,
  onEdit,
  onToggleDone,
  onDelete,
}: {
  epic: EpicCardRow;
  orgSlug: string;
  todayKey: string;
  onEdit: () => void;
  onToggleDone: () => void;
  onDelete: () => void;
}) {
  const color = epicColor(epic);
  const total = epic.open + epic.done;
  const status = STATUS[epic.status] ?? STATUS.NOT_STARTED!;
  const dates = datesText(epic.startDate, epic.dueDate, todayKey);
  const late = epic.status !== "COMPLETED" && epic.dueDate !== null && epic.dueDate < todayKey;
  const href = `/app/${orgSlug}/tasks?view=list&scope=all&epic=${epic.id}`;

  return (
    <li className="group bg-card text-card-foreground edge rounded-card hover:shadow-e2 relative flex flex-col overflow-hidden transition-[transform,box-shadow] duration-200 ease-(--ease-ink) hover:-translate-y-0.5 motion-reduce:hover:translate-y-0">
      <span aria-hidden="true" className="h-1.5" style={{ background: color }} />
      <div className="flex flex-1 flex-col gap-4 p-5">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="rounded-tile grid size-10 flex-none place-items-center"
            style={{ background: `color-mix(in oklab, ${color} 22%, var(--card))` }}
          >
            <Layers className="size-5" style={{ color }} />
          </span>
          <div className="min-w-0 flex-1">
            <Link
              href={href}
              className="line-clamp-2 text-[17px] leading-snug font-semibold after:absolute after:inset-0 focus-visible:outline-none"
            >
              {epic.title}
            </Link>
            <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
              <StatusDot color={status.color}>{status.label}</StatusDot>
              {dates && <span className={cn(late && "text-tint-danger-foreground")}>{dates}</span>}
            </div>
          </div>
          <div className="relative z-10">
            <ItemMenu
              label={`Actions for ${epic.title}`}
              items={[
                { label: "Edit", icon: Pencil, onSelect: onEdit },
                epic.status === "COMPLETED"
                  ? { label: "Reopen", icon: RotateCcw, onSelect: onToggleDone }
                  : { label: "Mark done", icon: CircleCheck, onSelect: onToggleDone },
                {
                  label: "Delete",
                  icon: Trash2,
                  destructive: true,
                  separated: true,
                  onSelect: onDelete,
                },
              ]}
            />
          </div>
        </div>

        {epic.description && (
          <p className="text-muted-foreground line-clamp-2 text-sm">{epic.description}</p>
        )}

        <div className="mt-auto space-y-2.5">
          {total > 0 ? (
            <ProgressBar done={epic.done} total={total} color={color} className="w-full" />
          ) : (
            <p className="text-muted-foreground text-[13px]">Not broken down yet</p>
          )}
          <div className="flex items-center gap-2 text-[13px]">
            <span className="text-muted-foreground">
              {epic.stories > 0 && `${epic.stories} ${epic.stories === 1 ? "story" : "stories"} · `}
              {epic.open} open
            </span>
            {epic.overdue > 0 && <Badge variant="destructive">{epic.overdue} overdue</Badge>}
            <span className="flex-1" />
            {epic.owner ? (
              <span className="flex items-center gap-1.5" title={epic.owner.name ?? "Owner"}>
                <UserAvatar user={epic.owner} size="sm" />
              </span>
            ) : (
              <span className="text-muted-foreground">No owner</span>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

/** New epic or Edit: name, colour, owner, dates and a line about it. */
function EpicDialog({
  orgId,
  epic,
  viewerId,
  members,
  colors,
  onClose,
}: {
  orgId: string;
  epic: EpicCardRow | null;
  viewerId: string;
  members: OrgMemberOption[];
  colors: string[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(epic?.title ?? "");
  const [description, setDescription] = useState(epic?.description ?? "");
  const [color, setColor] = useState<string | null>(epic?.color ?? null);
  const [ownerId, setOwnerId] = useState<string | null>(epic ? epic.ownerId : viewerId);
  const [startDate, setStartDate] = useState(epic?.startDate ?? "");
  const [dueDate, setDueDate] = useState(epic?.dueDate ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const input = {
        title,
        description: description.trim() ? description : null,
        color,
        ownerId,
        startDate: startDate || null,
        dueDate: dueDate || null,
      };
      const result = epic
        ? await updateTask(orgId, epic.id, input)
        : await createTask(orgId, { ...input, type: "EPIC" });
      if (result.error) {
        setError(result.error);
        return;
      }
      toast({ title: epic ? `Saved: ${title}` : `Created: ${title}`, tone: "success" });
      router.refresh();
      onClose();
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={save} className="space-y-5">
          <DialogHeader>
            <DialogTitle>{epic ? "Edit epic" : "New epic"}</DialogTitle>
            <DialogDescription>
              Its stories and tasks show its colour, and its progress counts them.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <label htmlFor="epic-title" className="text-[13px] font-semibold">
              Name
            </label>
            <Input
              id="epic-title"
              value={title}
              autoFocus
              required
              maxLength={200}
              placeholder="Fall Showcase"
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <fieldset className="space-y-2">
            <legend className="text-[13px] font-semibold">Colour</legend>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                aria-label="Theme colour"
                aria-pressed={color === null}
                onClick={() => setColor(null)}
                className={cn(
                  "focus-glow hatch bg-muted size-7 rounded-full transition-transform active:scale-[0.94]",
                  color === null && "ring-foreground ring-offset-card ring-2 ring-offset-2",
                )}
              />
              {colors.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Colour ${c}`}
                  aria-pressed={color === c}
                  onClick={() => setColor(c)}
                  className={cn(
                    "focus-glow size-7 rounded-full transition-transform active:scale-[0.94]",
                    color === c && "ring-foreground ring-offset-card ring-2 ring-offset-2",
                  )}
                  style={{ background: c }}
                />
              ))}
            </div>
          </fieldset>

          <div className="space-y-2">
            <label htmlFor="epic-owner" className="text-[13px] font-semibold">
              Owner
            </label>
            <Select
              value={ownerId ?? "none"}
              onValueChange={(v) => setOwnerId(v === "none" ? null : v)}
            >
              <SelectTrigger id="epic-owner" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Nobody yet</SelectItem>
                {members.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name ?? "Member"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="epic-start" className="text-[13px] font-semibold">
                Start
              </label>
              <Input
                id="epic-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="epic-due" className="text-[13px] font-semibold">
                Due
              </label>
              <Input
                id="epic-due"
                type="date"
                value={dueDate}
                min={startDate || undefined}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="epic-description" className="text-[13px] font-semibold">
              About it <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <Textarea
              id="epic-description"
              value={description}
              rows={2}
              maxLength={2000}
              placeholder="What done looks like"
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || !title.trim()}>
              {isPending ? "Saving…" : epic ? "Save" : "Create epic"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
