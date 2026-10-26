"use client";

import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type ReactNodeViewProps,
} from "@tiptap/react";
import {
  ArrowUpRight,
  CalendarDays,
  Check,
  Database,
  Download,
  FileText,
  Loader2,
  Vote,
} from "@/components/icons";
import Link from "next/link";
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";

import { loadTaskChips, type TaskChipData } from "@/app/app/[orgSlug]/notes/embed-actions";
import { setTaskStatus } from "@/app/app/[orgSlug]/tasks/actions";
import { FILE_ICONS } from "@/components/notes/file-card";
import { DatePopover } from "@/components/ui/date-field";
import { UserAvatar } from "@/components/user-avatar";
import { familyOf, formatBytes } from "@/lib/files/types";
import { dayLabel, todayKey } from "@/lib/notes/dates";
import {
  Callout,
  CALLOUT_TONES,
  DateChip,
  FileAttachment,
  LinkCard,
  NoteLink,
  TaskChip,
  type CalloutTone,
} from "@/lib/notes/nodes";
import { cn } from "@/lib/utils";

/**
 * The editor's React views of the note's own blocks (src/lib/notes/nodes.ts):
 * the same nodes and attributes, drawn as live pieces. They read the page
 * they're on from NoteViewContext.
 */

export interface NoteViewContextValue {
  orgId: string;
  orgSlug: string;
  editable: boolean;
  /** Current titles and icons of the pages the viewer can see. */
  pages: Map<string, { title: string; icon: string | null }>;
}

export const NoteViewContext = createContext<NoteViewContextValue>({
  orgId: "",
  orgSlug: "",
  editable: false,
  pages: new Map(),
});

// ---- Task chips -------------------------------------------------------------

/** One batched read for every chip on the page, refreshed when one is checked. */
const taskStore = (() => {
  const data = new Map<string, TaskChipData | "missing">();
  const listeners = new Set<() => void>();
  let queue = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let orgId = "";
  let version = 0;
  const emit = () => {
    version++;
    for (const l of listeners) l();
  };
  async function flush() {
    timer = null;
    const ids = [...queue];
    queue = new Set();
    if (ids.length === 0) return;
    try {
      const { tasks } = await loadTaskChips(orgId, ids);
      const found = new Map(tasks.map((t) => [t.id, t]));
      for (const id of ids) data.set(id, found.get(id) ?? "missing");
    } catch {
      for (const id of ids) data.delete(id);
    }
    emit();
  }
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot: () => version,
    get: (id: string) => data.get(id),
    request(org: string, id: string) {
      orgId = org;
      if (data.has(id) || queue.has(id)) return;
      queue.add(id);
      timer ??= setTimeout(() => void flush(), 30);
    },
    set(task: TaskChipData) {
      data.set(task.id, task);
      emit();
    },
  };
})();

function TaskChipView({ node }: ReactNodeViewProps) {
  const { orgId, orgSlug } = useContext(NoteViewContext);
  const taskId = node.attrs.taskId as string | null;
  useSyncExternalStore(taskStore.subscribe, taskStore.snapshot, () => 0);
  const task = taskId ? taskStore.get(taskId) : "missing";
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (taskId) taskStore.request(orgId, taskId);
  }, [orgId, taskId]);

  const done = task && task !== "missing" && task.status === "COMPLETED";
  const title = task && task !== "missing" ? task.title : String(node.attrs.title);
  const today = todayKey();

  async function toggle() {
    if (!task || task === "missing" || busy) return;
    setBusy(true);
    const next = done ? "NOT_STARTED" : "COMPLETED";
    taskStore.set({ ...task, status: next });
    try {
      const result = (await setTaskStatus(orgId, task.id, next)) as { error?: string } | undefined;
      if (result?.error) taskStore.set(task);
    } catch {
      taskStore.set(task);
    } finally {
      setBusy(false);
    }
  }

  return (
    <NodeViewWrapper
      className="note-task-chip bg-card rounded-field my-1.5 flex items-center gap-3 border px-3 py-2.5 text-sm"
      contentEditable={false}
      data-drag-handle=""
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={Boolean(done)}
        aria-label={done ? `Mark “${title}” not done` : `Mark “${title}” done`}
        disabled={!task || task === "missing" || busy}
        onClick={() => void toggle()}
        className={cn(
          "grid size-[22px] shrink-0 place-items-center rounded-full border-[1.5px] transition-[background-color,border-color,transform] duration-200 ease-(--ease-spring) disabled:opacity-60",
          done
            ? "bg-block-goal border-block-goal text-block-goal-foreground scale-105"
            : "border-muted-foreground hover:border-foreground",
        )}
      >
        {done && <Check className="size-3.5" strokeWidth={2.6} aria-hidden="true" />}
      </button>
      <span className={cn("min-w-0 flex-1 truncate", done && "text-muted-foreground line-through")}>
        {title}
      </span>
      {task === undefined && (
        <Loader2 className="text-muted-foreground size-4 animate-spin" aria-label="Loading task" />
      )}
      {task === "missing" && (
        <span className="text-muted-foreground text-xs">Task not available</span>
      )}
      {task && task !== "missing" && task.dueDate && (
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1 text-xs",
            !done && task.dueDate <= today
              ? "text-tint-danger-foreground"
              : task.dueDate === todayKeyPlus(today, 1)
                ? "font-semibold"
                : "text-muted-foreground",
          )}
        >
          <CalendarDays className="size-3.5" aria-hidden="true" />
          {dayLabel(task.dueDate, today)}
        </span>
      )}
      {task && task !== "missing" && task.assignee && <UserAvatar user={task.assignee} size="xs" />}
      {task && task !== "missing" && (
        <Link
          href={`/app/${orgSlug}/tasks/${task.id}`}
          aria-label={`Open “${title}”`}
          className="text-muted-foreground hover:text-foreground hover:bg-muted grid size-7 shrink-0 place-items-center rounded-full"
        >
          <ArrowUpRight className="size-4" aria-hidden="true" />
        </Link>
      )}
    </NodeViewWrapper>
  );
}

function todayKeyPlus(key: string, days: number) {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---- Dates, page links ---------------------------------------------------------

function DateChipView({ node, updateAttributes, selected }: ReactNodeViewProps) {
  const { editable } = useContext(NoteViewContext);
  const date = node.attrs.date as string | null;
  return (
    <NodeViewWrapper
      as="span"
      className={cn("note-inline-chip", selected && "is-selected")}
      contentEditable={false}
    >
      <CalendarDays className="size-3.5" aria-hidden="true" />
      {editable ? (
        <DateNodeButton date={date} onPick={(next) => updateAttributes({ date: next })} />
      ) : (
        <time dateTime={date ?? undefined}>{dayLabel(date)}</time>
      )}
    </NodeViewWrapper>
  );
}

function NoteLinkView({ node, selected }: ReactNodeViewProps) {
  const { orgSlug, pages } = useContext(NoteViewContext);
  const noteId = node.attrs.noteId as string | null;
  const page = noteId ? pages.get(noteId) : undefined;
  const title = page?.title || String(node.attrs.title || "Untitled");
  return (
    <NodeViewWrapper as="span" contentEditable={false}>
      <Link
        href={`/app/${orgSlug}/notes/${noteId ?? ""}`}
        className={cn("note-inline-chip note-page-link", selected && "is-selected")}
        title={page ? undefined : "You may not be able to open this page"}
      >
        {page?.icon ? (
          <span aria-hidden="true">{page.icon}</span>
        ) : (
          <FileText className="size-3.5" aria-hidden="true" />
        )}
        <span>{title}</span>
      </Link>
    </NodeViewWrapper>
  );
}

// ---- Cards ------------------------------------------------------------------------

function LinkCardView({ node, selected }: ReactNodeViewProps) {
  const { orgSlug } = useContext(NoteViewContext);
  const kind = node.attrs.kind === "poll" ? "poll" : "database";
  const Icon = kind === "poll" ? Vote : Database;
  return (
    <NodeViewWrapper
      contentEditable={false}
      data-drag-handle=""
      className={cn("my-2", selected && "ring-ring rounded-tile ring-2")}
    >
      <Link
        href={`/app/${orgSlug}/${String(node.attrs.path).replace(/^\/+/, "")}`}
        className="bg-card edge rounded-tile hover:shadow-e2 flex items-center gap-3 px-4 py-3 no-underline transition-shadow"
      >
        <span className="bg-tint-info text-tint-info-foreground grid size-9 shrink-0 place-items-center rounded-full">
          <Icon className="size-[18px]" aria-hidden="true" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-foreground truncate text-sm font-semibold">
            {String(node.attrs.title) || (kind === "poll" ? "Poll" : "Database")}
          </span>
          <span className="text-muted-foreground text-xs">
            {kind === "poll" ? "Poll · open to vote" : "Database view · open the table"}
          </span>
        </span>
        <ArrowUpRight className="text-muted-foreground size-4" aria-hidden="true" />
      </Link>
    </NodeViewWrapper>
  );
}

function FileAttachmentView({ node, selected }: ReactNodeViewProps) {
  const { orgId, orgSlug } = useContext(NoteViewContext);
  const fileId = node.attrs.fileId as string | null;
  const family = familyOf(String(node.attrs.contentType ?? ""));
  const Icon = FILE_ICONS[family];
  const size = Number(node.attrs.sizeBytes) || 0;
  return (
    <NodeViewWrapper
      contentEditable={false}
      data-drag-handle=""
      className={cn("my-2", selected && "ring-ring rounded-tile ring-2")}
    >
      <div className="bg-card edge rounded-tile flex items-center gap-3 px-4 py-3">
        <span className="bg-muted text-muted-foreground grid size-9 shrink-0 place-items-center rounded-full">
          <Icon className="size-[18px]" aria-hidden="true" />
        </span>
        <Link
          href={fileId ? `/app/${orgSlug}/notes/files/${fileId}` : "#"}
          className="flex min-w-0 flex-1 flex-col no-underline"
        >
          <span className="text-foreground truncate text-sm font-semibold">
            {String(node.attrs.name)}
          </span>
          {size > 0 && <span className="text-muted-foreground text-xs">{formatBytes(size)}</span>}
        </Link>
        {fileId && (
          <a
            href={`/api/orgs/${encodeURIComponent(orgId)}/files/${encodeURIComponent(fileId)}?download=1`}
            aria-label={`Download ${String(node.attrs.name)}`}
            className="text-muted-foreground hover:text-foreground hover:bg-muted grid size-8 place-items-center rounded-full"
          >
            <Download className="size-4" aria-hidden="true" />
          </a>
        )}
      </div>
    </NodeViewWrapper>
  );
}

// ---- Callouts -------------------------------------------------------------------

const TONE_EMOJI: Record<CalloutTone, string> = {
  info: "💡",
  success: "✅",
  warning: "⚠️",
  danger: "🚨",
};

function CalloutView({ node, updateAttributes }: ReactNodeViewProps) {
  const { editable } = useContext(NoteViewContext);
  const tone = (CALLOUT_TONES as readonly string[]).includes(node.attrs.tone)
    ? (node.attrs.tone as CalloutTone)
    : "info";
  const next = CALLOUT_TONES[(CALLOUT_TONES.indexOf(tone) + 1) % CALLOUT_TONES.length]!;
  return (
    <NodeViewWrapper className="note-callout" data-tone={tone}>
      <button
        type="button"
        contentEditable={false}
        disabled={!editable}
        onClick={() => updateAttributes({ tone: next, emoji: TONE_EMOJI[next] })}
        aria-label="Change the callout's colour"
        className="note-callout-emoji"
      >
        {String(node.attrs.emoji || TONE_EMOJI[tone])}
      </button>
      <NodeViewContent className="note-callout-body" />
    </NodeViewWrapper>
  );
}

/** The schema nodes with their views, by name (noteSchemaExtensions' `override`). */
export function nodeViewOverrides() {
  return {
    taskChip: TaskChip.extend({ addNodeView: () => ReactNodeViewRenderer(TaskChipView) }),
    dateChip: DateChip.extend({ addNodeView: () => ReactNodeViewRenderer(DateChipView) }),
    noteLink: NoteLink.extend({ addNodeView: () => ReactNodeViewRenderer(NoteLinkView) }),
    linkCard: LinkCard.extend({ addNodeView: () => ReactNodeViewRenderer(LinkCardView) }),
    fileAttachment: FileAttachment.extend({
      addNodeView: () => ReactNodeViewRenderer(FileAttachmentView),
    }),
    callout: Callout.extend({ addNodeView: () => ReactNodeViewRenderer(CalloutView) }),
  };
}

/**
 * A date written into a note: the date itself is the button, and it opens
 * the themed calendar. It used to be an invisible native date input laid
 * over the text, which meant the operating system's own picker.
 */
function DateNodeButton({ date, onPick }: { date: string | null; onPick: (date: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <DatePopover value={date ?? ""} onPick={onPick} open={open} onOpenChange={setOpen}>
      <button type="button" aria-label="Change the date" className="cursor-pointer">
        {dayLabel(date)}
      </button>
    </DatePopover>
  );
}
