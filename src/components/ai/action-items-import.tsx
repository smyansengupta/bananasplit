"use client";

import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  ListChecks,
  Loader2,
  Quote,
  Sparkles,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { createEvent } from "@/app/app/[orgSlug]/calendar/actions";
import { createTasksFromImport, type ImportedTaskResult } from "@/app/app/[orgSlug]/tasks/actions";
import { ConnectionPicker, useAiConnections } from "@/components/ai/connection-picker";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  addMinutesLocal,
  MAX_ACTION_TEXT,
  type ImportPriority,
  type ProposedItem,
} from "@/lib/ai/action-items";
import type { ImportRosterMember } from "@/lib/ai/types";
import { parseZonedDateTimeLocal } from "@/lib/calendar/dates";
import { cn } from "@/lib/utils";

/**
 * "Import with AI": paste action items or meeting notes, the club's
 * connected model proposes tasks (with owners, helpers, due dates and
 * priorities) and calendar events, and the member checks and edits every
 * row before anything is created. Creation goes through the ordinary task
 * and event actions, so it's exactly as if they'd typed each one.
 */

interface ReadResponse {
  items: ProposedItem[];
  notes: string[];
  members: ImportRosterMember[];
  readBy: string;
  canCreateEvents: boolean;
  rules: { requireOwner: boolean; requireDueDate: boolean };
  timezone: string;
}

interface Row extends ProposedItem {
  include: boolean;
}

interface Outcome {
  tasks: { key: string; title: string; result: ImportedTaskResult }[];
  events: { key: string; title: string; eventId?: string; error?: string }[];
}

const PLACEHOLDER = `- Sam: book the room for the fall social by Friday
- Riley and Alex draft the sponsor deck (urgent)
- Exec meeting Thursday 6pm in the student center
- Someone order T-shirts before 10/20`;

const selectClass = "border-input bg-background h-8 w-full rounded-md border px-2 text-sm";

const PRIORITY_LABEL: Record<ImportPriority, string> = { LOW: "Low", MEDIUM: "Medium", HIGH: "High" };

export function ActionItemsImport({
  orgId,
  orgSlug,
  open,
  onOpenChange,
  initialText = "",
  sourceLabel,
}: {
  orgId: string;
  orgSlug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Prefilled text (a note's contents). */
  initialText?: string;
  /** "this note": shown in the description when prefilled. */
  sourceLabel?: string;
}) {
  const router = useRouter();
  const ai = useAiConnections(orgId, open);
  const [phase, setPhase] = useState<"input" | "review" | "creating" | "done">("input");
  const [text, setText] = useState(initialText);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [read, setRead] = useState<ReadResponse | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [confirming, setConfirming] = useState(false);

  function reset(keepText = false) {
    setPhase("input");
    setError(null);
    setRead(null);
    setRows([]);
    setOutcome(null);
    if (!keepText) setText(initialText);
  }

  async function readText() {
    setError(null);
    setReading(true);
    try {
      const res = await fetch(`/api/orgs/${encodeURIComponent(orgId)}/ai/action-items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, connection: ai.selected?.id }),
      });
      const body = (await res.json().catch(() => ({}))) as Partial<ReadResponse> & { error?: string };
      if (!res.ok || !body.items) {
        setError(body.error ?? "That didn't work. Try again.");
        return;
      }
      if (body.items.length === 0) {
        setError("No action items found in that. Try a list with one task per line.");
        return;
      }
      setRead(body as ReadResponse);
      setRows(
        body.items.map((item) => ({
          ...item,
          // Without the right to add events, those become tasks on their day.
          kind: item.kind === "event" && !body.canCreateEvents ? "task" : item.kind,
          include: true,
        })),
      );
      setPhase("review");
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setReading(false);
    }
  }

  const memberName = useMemo(() => new Map((read?.members ?? []).map((m) => [m.id, m.name])), [read]);
  const patch = (key: string, change: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...change } : r)));

  function problem(r: Row): string | null {
    if (!r.title.trim()) return "Give it a title.";
    if (r.kind === "task") {
      if (read?.rules.requireOwner && !r.ownerId) return "Your club requires an owner on every task.";
      if (read?.rules.requireDueDate && !r.dueDate) return "Your club requires a due date on every task.";
    } else if (!r.startsAt) {
      return "Pick when it starts.";
    }
    return null;
  }

  const kept = rows.filter((r) => r.include);
  const keptTasks = kept.filter((r) => r.kind === "task");
  const keptEvents = kept.filter((r) => r.kind === "event");
  const blocking = kept.find((r) => problem(r));

  function taskInput(r: Row) {
    return {
      title: r.title.trim(),
      description: r.description,
      priority: r.priority,
      dueDate: r.dueDate,
      ownerId: r.ownerId,
      assigneeIds: r.helperIds,
    };
  }

  async function addTasks(list: Row[], confirmFlagged: boolean) {
    if (list.length === 0) return [];
    const { results } = await createTasksFromImport(
      orgId,
      list.map((r) => ({ key: r.key, input: taskInput(r) })),
      { confirmFlagged },
    );
    return results.map((result) => ({
      key: result.key,
      title: list.find((r) => r.key === result.key)?.title ?? "",
      result,
    }));
  }

  async function create() {
    if (!read || blocking) return;
    setPhase("creating");
    setError(null);
    try {
      const tasks = await addTasks(keptTasks, false);
      const events: Outcome["events"] = [];
      for (const r of keptEvents) {
        const startsAt = r.startsAt!;
        const endsAt = r.endsAt ?? (r.allDay ? startsAt : addMinutesLocal(startsAt, 60));
        const start = r.allDay ? startsAt.slice(0, 10) : parseZonedDateTimeLocal(startsAt, read.timezone)?.toISOString();
        const end = r.allDay ? endsAt.slice(0, 10) : parseZonedDateTimeLocal(endsAt, read.timezone)?.toISOString();
        if (!start || !end) {
          events.push({ key: r.key, title: r.title, error: "Its time couldn't be read." });
          continue;
        }
        const result = await createEvent(orgId, {
          title: r.title.trim(),
          description: r.description,
          allDay: r.allDay,
          startsAt: start,
          endsAt: end,
          location: r.location,
          attendeeIds: [...new Set([r.ownerId, ...r.helperIds].filter((id): id is string => Boolean(id)))],
        });
        events.push({ key: r.key, title: r.title, eventId: result.eventId, error: result.error });
      }
      setOutcome({ tasks, events });
      setPhase("done");
      router.refresh();
    } catch {
      setError("Something went wrong partway. Check Tasks and the calendar before trying again.");
      setPhase("review");
    }
  }

  async function confirmFlagged() {
    if (!outcome) return;
    const waiting = outcome.tasks.filter((t) => t.result.confirm).map((t) => rows.find((r) => r.key === t.key)!);
    setConfirming(true);
    try {
      const again = await addTasks(waiting, true);
      setOutcome({
        ...outcome,
        tasks: outcome.tasks.map((t) => again.find((a) => a.key === t.key) ?? t),
      });
      router.refresh();
    } finally {
      setConfirming(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (phase === "creating") return;
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent className="flex max-h-[90vh] flex-col gap-4 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="text-primary size-5" aria-hidden="true" />
            {phase === "done" ? "Imported" : "Import action items with AI"}
          </DialogTitle>
          <DialogDescription>
            {phase === "input"
              ? sourceLabel
                ? `The AI reads ${sourceLabel}, suggests owners, due dates and calendar events, and you check every row before anything is added.`
                : "Paste a to-do list or meeting notes. The AI suggests owners, due dates and calendar events, and you check every row before anything is added."
              : phase === "done"
                ? "Here's what was added."
                : `Read by ${read?.readBy}. Uncheck anything you don't want, and fix what it got wrong.`}
          </DialogDescription>
        </DialogHeader>

        {phase === "input" && (
          <div className="min-h-0 space-y-3 overflow-y-auto">
            <div className="space-y-1">
              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={PLACEHOLDER}
                rows={11}
                maxLength={MAX_ACTION_TEXT}
                aria-label="Action items"
                className="font-mono text-[13px] leading-relaxed"
              />
              <p className="text-muted-foreground text-right text-xs tabular-nums">
                {text.length.toLocaleString()} / {MAX_ACTION_TEXT.toLocaleString()}
              </p>
            </div>
            <ConnectionPicker
              orgSlug={orgSlug}
              list={ai.list}
              failed={ai.failed}
              selected={ai.selected}
              onChoose={ai.setChoice}
              what={sourceLabel ?? "your list"}
              sendsRoster
            />
            {error && (
              <p role="alert" className="text-destructive flex items-start gap-1.5 text-sm">
                <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                {error}
              </p>
            )}
          </div>
        )}

        {(phase === "review" || phase === "creating") && read && (
          <div className="min-h-0 space-y-3 overflow-y-auto pe-1">
            {read.notes.length > 0 && (
              <div className="border-warning/40 bg-warning/10 rounded-lg border p-3 text-sm">
                <p className="font-medium">Worth a look</p>
                <ul className="text-muted-foreground mt-1 list-disc space-y-0.5 ps-5 text-xs">
                  {read.notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={kept.length === rows.length ? true : kept.length === 0 ? false : "indeterminate"}
                  onCheckedChange={(v) => setRows((rs) => rs.map((r) => ({ ...r, include: v === true })))}
                  aria-label="Keep all"
                />
                {kept.length} of {rows.length} selected
              </label>
              <span className="text-muted-foreground text-xs">Event times are in {read.timezone.replace(/_/g, " ")}.</span>
            </div>
            <ul className="space-y-2.5">
              {rows.map((r) => (
                <ItemRow
                  key={r.key}
                  row={r}
                  members={read.members}
                  canCreateEvents={read.canCreateEvents}
                  problem={r.include ? problem(r) : null}
                  onChange={(change) => patch(r.key, change)}
                />
              ))}
            </ul>
            {error && (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            )}
          </div>
        )}

        {phase === "done" && outcome && (
          <Summary
            outcome={outcome}
            orgSlug={orgSlug}
            memberName={memberName}
            confirming={confirming}
            onConfirm={() => void confirmFlagged()}
          />
        )}

        <DialogFooter className="gap-2">
          {phase === "input" && (
            <>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => void readText()}
                disabled={reading || !text.trim() || !ai.selected}
              >
                {reading ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Sparkles className="size-4" aria-hidden="true" />
                )}
                {reading ? "Reading…" : "Read with AI"}
              </Button>
            </>
          )}
          {(phase === "review" || phase === "creating") && (
            <>
              <Button type="button" variant="ghost" disabled={phase === "creating"} onClick={() => reset(true)}>
                <ArrowLeft className="size-4" aria-hidden="true" />
                Back
              </Button>
              <Button type="button" onClick={() => void create()} disabled={phase === "creating" || kept.length === 0 || Boolean(blocking)}>
                {phase === "creating" && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                {addLabel(keptTasks.length, keptEvents.length)}
              </Button>
            </>
          )}
          {phase === "done" && (
            <>
              <Button type="button" variant="ghost" onClick={() => reset()}>
                Import more
              </Button>
              <Button type="button" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function addLabel(tasks: number, events: number): string {
  const parts = [
    tasks > 0 ? `${tasks} task${tasks === 1 ? "" : "s"}` : null,
    events > 0 ? `${events} event${events === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  return parts.length ? `Add ${parts.join(" and ")}` : "Add";
}

function ItemRow({
  row,
  members,
  canCreateEvents,
  problem,
  onChange,
}: {
  row: Row;
  members: ImportRosterMember[];
  canCreateEvents: boolean;
  problem: string | null;
  onChange: (change: Partial<Row>) => void;
}) {
  const helpers = members.filter((m) => row.helperIds.includes(m.id));
  const addable = members.filter((m) => m.id !== row.ownerId && !row.helperIds.includes(m.id));
  const isEvent = row.kind === "event";
  return (
    <li
      className={cn(
        "bg-card space-y-2.5 rounded-xl border p-3 transition-opacity",
        !row.include && "opacity-55",
        problem && "border-destructive/50",
      )}
    >
      <div className="flex items-center gap-2">
        <Checkbox
          checked={row.include}
          onCheckedChange={(v) => onChange({ include: v === true })}
          aria-label={`Keep “${row.title}”`}
        />
        <div className="bg-muted flex shrink-0 rounded-md p-0.5 text-xs" role="group" aria-label="Task or event">
          {(["task", "event"] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={row.kind === k}
              disabled={k === "event" && !canCreateEvents}
              title={k === "event" && !canCreateEvents ? "Only owners and admins add calendar events" : undefined}
              onClick={() => {
                if (k === row.kind) return;
                if (k === "event") {
                  const day = row.dueDate ?? new Date().toISOString().slice(0, 10);
                  onChange({ kind: "event", startsAt: `${day}T18:00`, endsAt: `${day}T19:00`, allDay: false });
                } else {
                  onChange({ kind: "task", dueDate: row.startsAt?.slice(0, 10) ?? row.dueDate });
                }
              }}
              className={cn(
                "inline-flex items-center gap-1 rounded px-2 py-1 font-medium disabled:opacity-40",
                row.kind === k ? "bg-background shadow-xs" : "text-muted-foreground",
              )}
            >
              {k === "task" ? <ListChecks className="size-3.5" aria-hidden="true" /> : <CalendarDays className="size-3.5" aria-hidden="true" />}
              {k === "task" ? "Task" : "Event"}
            </button>
          ))}
        </div>
        <Input
          value={row.title}
          onChange={(e) => onChange({ title: e.target.value })}
          maxLength={200}
          aria-label="Title"
          className="h-8 min-w-0 flex-1 font-medium"
        />
      </div>

      <div className={cn("grid gap-2", isEvent ? "sm:grid-cols-2" : "sm:grid-cols-[1fr_1fr_9.5rem_7rem]")}>
        <label className="space-y-1">
          <span className="text-muted-foreground text-xs">{isEvent ? "Host" : "Owner"}</span>
          <select
            className={selectClass}
            value={row.ownerId ?? ""}
            onChange={(e) =>
              onChange({
                ownerId: e.target.value || null,
                helperIds: row.helperIds.filter((id) => id !== e.target.value),
              })
            }
          >
            <option value="">{isEvent ? "Nobody in particular" : "No owner"}</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.title ? ` · ${m.title}` : ""}
              </option>
            ))}
          </select>
        </label>
        <div className="space-y-1">
          <span className="text-muted-foreground text-xs">{isEvent ? "Also invited" : "Helping"}</span>
          <div className="flex min-h-8 flex-wrap items-center gap-1">
            {helpers.map((m) => (
              <span key={m.id} className="bg-muted inline-flex items-center gap-1 rounded-full py-0.5 ps-2 pe-1 text-xs">
                {m.name}
                <button
                  type="button"
                  aria-label={`Remove ${m.name}`}
                  onClick={() => onChange({ helperIds: row.helperIds.filter((id) => id !== m.id) })}
                  className="hover:bg-background rounded-full p-0.5"
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              </span>
            ))}
            {addable.length > 0 && (
              <select
                className="border-input bg-background h-7 max-w-36 rounded-md border px-1.5 text-xs"
                value=""
                aria-label="Add someone"
                onChange={(e) => e.target.value && onChange({ helperIds: [...row.helperIds, e.target.value] })}
              >
                <option value="">+ Add</option>
                {addable.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
        {!isEvent && (
          <>
            <label className="space-y-1">
              <span className="text-muted-foreground text-xs">Due</span>
              <Input
                type="date"
                value={row.dueDate ?? ""}
                onChange={(e) => onChange({ dueDate: e.target.value || null })}
                className="h-8"
              />
            </label>
            <label className="space-y-1">
              <span className="text-muted-foreground text-xs">Priority</span>
              <select
                className={selectClass}
                value={row.priority}
                onChange={(e) => onChange({ priority: e.target.value as ImportPriority })}
              >
                {(Object.keys(PRIORITY_LABEL) as ImportPriority[]).map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABEL[p]}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </div>

      {isEvent && (
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto_1fr] sm:items-end">
          <label className="space-y-1">
            <span className="text-muted-foreground text-xs">Starts</span>
            <Input
              type={row.allDay ? "date" : "datetime-local"}
              value={row.allDay ? (row.startsAt ?? "").slice(0, 10) : (row.startsAt ?? "")}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return onChange({ startsAt: null });
                const startsAt = row.allDay ? `${v}T00:00` : v;
                const endsAt =
                  row.endsAt && row.endsAt > startsAt ? row.endsAt : row.allDay ? startsAt : addMinutesLocal(startsAt, 60);
                onChange({ startsAt, endsAt, dueDate: startsAt.slice(0, 10) });
              }}
              className="h-8"
            />
          </label>
          <label className="space-y-1">
            <span className="text-muted-foreground text-xs">Ends</span>
            <Input
              type={row.allDay ? "date" : "datetime-local"}
              value={row.allDay ? (row.endsAt ?? "").slice(0, 10) : (row.endsAt ?? "")}
              onChange={(e) => {
                const v = e.target.value;
                onChange({ endsAt: v ? (row.allDay ? `${v}T00:00` : v) : null });
              }}
              className="h-8"
            />
          </label>
          <label className="flex h-8 items-center gap-1.5 text-xs">
            <Checkbox
              checked={row.allDay}
              onCheckedChange={(v) => {
                const allDay = v === true;
                const day = (row.startsAt ?? "").slice(0, 10) || new Date().toISOString().slice(0, 10);
                onChange(
                  allDay
                    ? { allDay, startsAt: `${day}T00:00`, endsAt: `${(row.endsAt ?? row.startsAt ?? "").slice(0, 10) || day}T00:00` }
                    : { allDay, startsAt: `${day}T18:00`, endsAt: `${day}T19:00` },
                );
              }}
            />
            All day
          </label>
          <label className="space-y-1">
            <span className="text-muted-foreground text-xs">Where</span>
            <Input
              value={row.location ?? ""}
              onChange={(e) => onChange({ location: e.target.value || null })}
              maxLength={300}
              placeholder="Optional"
              className="h-8"
            />
          </label>
        </div>
      )}

      {row.description && (
        <p className="text-muted-foreground line-clamp-2 text-xs" title={row.description}>
          {row.description}
        </p>
      )}
      <p className="text-muted-foreground flex items-start gap-1.5 text-xs">
        <Quote className="mt-px size-3 shrink-0 opacity-60" aria-hidden="true" />
        <span className="line-clamp-2 italic">{row.sourceText}</span>
      </p>
      {problem && (
        <p className="text-destructive flex items-center gap-1.5 text-xs">
          <CircleAlert className="size-3.5" aria-hidden="true" />
          {problem}
        </p>
      )}
    </li>
  );
}

function Summary({
  outcome,
  orgSlug,
  memberName,
  confirming,
  onConfirm,
}: {
  outcome: Outcome;
  orgSlug: string;
  memberName: Map<string, string>;
  confirming: boolean;
  onConfirm: () => void;
}) {
  const madeTasks = outcome.tasks.filter((t) => t.result.taskId);
  const madeEvents = outcome.events.filter((e) => e.eventId);
  const flagged = outcome.tasks.filter((t) => t.result.confirm);
  const failed = [
    ...outcome.tasks.filter((t) => t.result.error).map((t) => ({ title: t.title, error: t.result.error! })),
    ...outcome.events.filter((e) => e.error).map((e) => ({ title: e.title, error: e.error! })),
  ];
  const flaggedNames = [
    ...new Set(flagged.flatMap((t) => t.result.confirm!.flagged.map((f) => f.name ?? memberName.get(f.userId) ?? "a member"))),
  ];
  return (
    <div className="min-h-0 space-y-3 overflow-y-auto">
      <div className="flex items-start gap-3 rounded-xl border p-4">
        <CheckCircle2 className="text-success mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <div className="space-y-1 text-sm">
          <p className="font-medium">{addedLabel(madeTasks.length, madeEvents.length)}</p>
          <p className="text-muted-foreground text-xs">
            Owners and helpers were notified like any assignment; tasks with a due date show on everyone&apos;s week
            and the Tasks calendar.
          </p>
          <div className="flex flex-wrap gap-3 pt-1 text-xs">
            {madeTasks.length > 0 && (
              <Link href={`/app/${orgSlug}/tasks`} className="text-primary underline underline-offset-2">
                Open Tasks
              </Link>
            )}
            {madeEvents.length > 0 && (
              <Link href={`/app/${orgSlug}/calendar`} className="text-primary underline underline-offset-2">
                Open the calendar
              </Link>
            )}
          </div>
        </div>
      </div>
      {flagged.length > 0 && (
        <div className="border-warning/40 bg-warning/10 space-y-2 rounded-xl border p-4 text-sm">
          <p className="font-medium">
            {flagged.length} task{flagged.length === 1 ? "" : "s"} assign{flagged.length === 1 ? "s" : ""} work above
            your level ({flaggedNames.join(", ")}).
          </p>
          <p className="text-muted-foreground text-xs">Nothing was added for {flagged.length === 1 ? "it" : "them"} yet.</p>
          <Button size="sm" onClick={onConfirm} disabled={confirming}>
            {confirming && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            Assign anyway
          </Button>
        </div>
      )}
      {failed.length > 0 && (
        <div className="border-destructive/30 space-y-1 rounded-xl border p-4 text-sm">
          <p className="font-medium">Not added</p>
          <ul className="space-y-1 text-xs">
            {failed.map((f, i) => (
              <li key={i}>
                <span className="font-medium">{f.title}</span>: <span className="text-muted-foreground">{f.error}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function addedLabel(tasks: number, events: number): string {
  if (tasks === 0 && events === 0) return "Nothing was added yet.";
  const parts = [
    tasks > 0 ? `${tasks} task${tasks === 1 ? "" : "s"}` : null,
    events > 0 ? `${events} event${events === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  return `Added ${parts.join(" and ")}.`;
}
