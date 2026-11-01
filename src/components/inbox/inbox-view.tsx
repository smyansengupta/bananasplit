"use client";

import {
  AlarmClock,
  AtSign,
  Bell,
  CalendarClock,
  CalendarDays,
  Check,
  ClipboardList,
  type IconComponent,
  Inbox,
  MessageSquare,
  ShieldAlert,
  UserPlus,
  Wallet,
} from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";

import { markNotificationRead } from "@/app/app/notifications-actions";
import { rsvpToEvent } from "@/app/app/[orgSlug]/calendar/actions";
import { approveExpense, rejectExpense } from "@/app/app/[orgSlug]/finance/transactions-actions";
import {
  setInboxItemDone,
  snoozeInboxItem,
  unsnoozeInboxItem,
} from "@/app/app/[orgSlug]/inbox/actions";
import { addTaskComment, setTaskStatus, updateTask } from "@/app/app/[orgSlug]/tasks/actions";
import { SidePeek } from "@/components/links/side-peek";
import { TASK_PANEL } from "@/components/tasks/layout-ui";
import { TaskCheck } from "@/components/tasks/task-check";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Segmented, segmentedItem, segmentedTrack } from "@/components/ui/segmented";
import { ExpandChip } from "@/components/ui/toolbar-chips";
import { Textarea } from "@/components/ui/textarea";
import { toast, undoable } from "@/components/ui/toaster";
import { UserAvatar, type UserAvatarUser } from "@/components/user-avatar";
import type { RSVPStatus, TaskStatus } from "@/generated/prisma/enums";
import {
  GROUP_LABEL,
  SNOOZE_CHOICES,
  SNOOZE_LABEL,
  type InboxGroup,
  type InboxKind,
  type SnoozeChoice,
} from "@/lib/inbox/items";
import type { LinkKind } from "@/lib/links";
import { addDaysToKey, mondayOfKey } from "@/lib/tasks/dates";
import { cn } from "@/lib/utils";

export type InboxView = "needs" | "updates" | "snoozed";

export type InboxCategory =
  "meeting" | "task" | "approval" | "form" | "mention" | "comment" | "assigned" | "alert" | "other";

/** One row of the Inbox, whatever it is. */
export interface InboxRow {
  /** "task:abc": what InboxItemState remembers it by. */
  key: string;
  kind: InboxKind;
  id: string;
  title: string;
  /** The second line: when and where, how much, or the update's words. */
  meta: string;
  group: InboxGroup;
  category: InboxCategory;
  href: string | null;
  /** What opens beside the list, when it can. */
  peek: { kind: LinkKind; id: string } | null;
  /** Who it's from (the host, the requester, whoever mentioned you). */
  actor?: UserAvatarUser | null;
  actorName?: string | null;
  urgent?: boolean;
  /** Updates: how long ago, and whether it's been read. */
  when?: string;
  unread?: boolean;
  /** A mention or comment you can answer in place. */
  replyTaskId?: string | null;
  /** Tasks: for Done's and Move's Undo. */
  task?: { status: TaskStatus; dueKey: string };
  /** Snoozed: when it comes back. */
  backAt?: string;
  /** The same update again: the other notifications this row stands for. */
  also?: string[];
}

/** Every key a row stands for (itself, and its repeats). */
function keysOf(row: InboxRow): string[] {
  return [row.key, ...(row.also ?? []).map((id) => `update:${id}`)];
}

const CATEGORY_LABEL: Record<InboxCategory, string> = {
  meeting: "Meetings",
  task: "Tasks",
  approval: "Approvals",
  form: "Forms",
  mention: "Mentions",
  comment: "Comments",
  assigned: "Assigned",
  alert: "Alerts",
  other: "Other",
};

const CATEGORY_ORDER: InboxCategory[] = [
  "mention",
  "comment",
  "assigned",
  "task",
  "meeting",
  "approval",
  "form",
  "alert",
  "other",
];

/** Each kind's icon and tint, so a glance tells them apart. */
const LOOK: Record<InboxCategory, { icon: IconComponent; tint: string }> = {
  meeting: { icon: CalendarDays, tint: "bg-tint-info text-tint-info-foreground" },
  task: { icon: Check, tint: "bg-tint-accent text-tint-accent-foreground" },
  approval: { icon: Wallet, tint: "bg-tint-success text-tint-success-foreground" },
  form: { icon: ClipboardList, tint: "bg-tint-accent text-tint-accent-foreground" },
  mention: { icon: AtSign, tint: "bg-tint-accent text-tint-accent-foreground" },
  comment: { icon: MessageSquare, tint: "bg-tint-info text-tint-info-foreground" },
  assigned: { icon: UserPlus, tint: "bg-tint-success text-tint-success-foreground" },
  alert: { icon: ShieldAlert, tint: "bg-tint-danger text-tint-danger-foreground" },
  other: { icon: Bell, tint: "bg-muted text-muted-foreground" },
};

/** One row, drawn like a row of the Tasks List. */
const ROW =
  "group/row hover:bg-muted/60 rounded-field relative flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-3 transition-colors duration-150 sm:flex-nowrap sm:gap-3.5 has-[[data-main]:focus-visible]:outline-foreground has-[[data-main]:focus-visible]:outline-2 has-[[data-main]:focus-visible]:-outline-offset-2 [li+&]:before:bg-border [li+&]:before:absolute [li+&]:before:inset-x-3 [li+&]:before:top-0 [li+&]:before:h-px";

/** Quiet buttons that show on hover or focus on a desktop and always on touch. */
const QUIET =
  "md:opacity-0 md:group-hover/row:opacity-100 md:group-focus-within/row:opacity-100 md:group-data-[active=true]/row:opacity-100";

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return (
    el.isContentEditable ||
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT" ||
    Boolean(el.closest("[role=dialog],[role=menu]"))
  );
}

/** One of the Inbox's views (Needs you, Updates, Snoozed), a link with its count. */
export interface InboxViewLink {
  value: InboxView;
  label: string;
  /** What's waiting there, as the option's badge. */
  count: number;
  href: string;
}

/**
 * The Inbox list: one bar as on Tasks (the view, then icons that filter by
 * kind and say what they are on hover), the rows in their groups, every
 * row's action on the row, and the keyboard (j and k move, Enter opens
 * beside, o opens the page, e finishes, s snoozes until tomorrow).
 */
export function InboxView({
  orgId,
  orgSlug,
  view,
  views,
  rows,
  empty,
}: {
  orgId: string;
  orgSlug: string;
  view: InboxView;
  views: InboxViewLink[];
  rows: InboxRow[];
  /** Shown when there's nothing here, or the last row is dealt with. */
  empty: React.ReactNode;
}) {
  const router = useRouter();
  const [, start] = useTransition();
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [readNow, setReadNow] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<InboxCategory | "all">("all");
  const [active, setActive] = useState(-1);
  const [replyFor, setReplyFor] = useState<string | null>(null);
  const [peek, setPeek] = useState<InboxRow | null>(null);
  const rowEls = useRef<(HTMLButtonElement | null)[]>([]);

  const hide = useCallback((key: string) => setGone((s) => new Set(s).add(key)), []);
  const show = useCallback(
    (key: string) =>
      setGone((s) => {
        const next = new Set(s);
        next.delete(key);
        return next;
      }),
    [],
  );

  const present = rows.filter((r) => !gone.has(r.key));
  const counts = useMemo(() => {
    const m = new Map<InboxCategory, number>();
    for (const r of present) m.set(r.category, (m.get(r.category) ?? 0) + 1);
    return m;
  }, [present]);
  const categories = CATEGORY_ORDER.filter((c) => counts.has(c));
  const current = filter !== "all" && !counts.has(filter) ? "all" : filter;
  const shown = present.filter((r) => current === "all" || r.category === current);

  const markRead = useCallback(
    (row: InboxRow) => {
      if (row.kind !== "update" || !row.unread || readNow.has(row.key)) return;
      setReadNow((s) => new Set(s).add(row.key));
      void Promise.all([row.id, ...(row.also ?? [])].map((id) => markNotificationRead(id))).then(
        () => router.refresh(),
      );
    },
    [readNow, router],
  );

  // ---- actions ---------------------------------------------------------

  const snooze = useCallback(
    (row: InboxRow, choice: SnoozeChoice) => {
      hide(row.key);
      start(async () => {
        const result = await snoozeInboxItem(orgId, keysOf(row), choice);
        if ("ok" in result && !result.ok) {
          show(row.key);
          toast({ title: result.error, tone: "error" });
          return;
        }
        toast({
          title: `Snoozed until ${SNOOZE_LABEL[choice].toLowerCase()}`,
          action: {
            label: "Undo",
            run: async () => {
              const back = await unsnoozeInboxItem(orgId, keysOf(row));
              if ("ok" in back && !back.ok) return back.error;
              show(row.key);
              router.refresh();
            },
          },
        });
        router.refresh();
      });
    },
    [hide, orgId, router, show],
  );

  const bringBack = useCallback(
    (row: InboxRow) => {
      hide(row.key);
      start(async () => {
        const result = await unsnoozeInboxItem(orgId, keysOf(row));
        if ("ok" in result && !result.ok) {
          show(row.key);
          toast({ title: result.error, tone: "error" });
          return;
        }
        toast({ title: "Back in your Inbox" });
        router.refresh();
      });
    },
    [hide, orgId, router, show],
  );

  const finishUpdate = useCallback(
    (row: InboxRow) => {
      hide(row.key);
      start(async () => {
        const ok = await undoable({
          title: "Done",
          run: async () => {
            const r = await setInboxItemDone(orgId, keysOf(row), true);
            return "ok" in r && !r.ok ? r.error : null;
          },
          undo: async () => {
            const back = await setInboxItemDone(orgId, keysOf(row), false);
            if ("ok" in back && !back.ok) return back.error;
            show(row.key);
            router.refresh();
          },
        });
        if (!ok) show(row.key);
        else router.refresh();
      });
    },
    [hide, orgId, router, show],
  );

  const finishTask = useCallback(
    (row: InboxRow) => {
      if (!row.task) return;
      const before = row.task.status;
      hide(row.key);
      start(async () => {
        const ok = await undoable({
          title: "Done",
          run: async () => (await setTaskStatus(orgId, row.id, "COMPLETED")).error ?? null,
          undo: async () => {
            const back = await setTaskStatus(orgId, row.id, before);
            if (back.error) return back.error;
            show(row.key);
            router.refresh();
          },
        });
        if (!ok) show(row.key);
        else router.refresh();
      });
    },
    [hide, orgId, router, show],
  );

  const moveTask = useCallback(
    (row: InboxRow, dueKey: string, label: string) => {
      if (!row.task) return;
      const before = row.task.dueKey;
      start(async () => {
        const ok = await undoable({
          title: `Due ${label.toLowerCase()}`,
          run: async () => (await updateTask(orgId, row.id, { dueDate: dueKey })).error ?? null,
          undo: async () => {
            const back = await updateTask(orgId, row.id, { dueDate: before });
            if (back.error) return back.error;
            router.refresh();
          },
        });
        if (ok) router.refresh();
      });
    },
    [orgId, router],
  );

  const answer = useCallback(
    (row: InboxRow, rsvp: RSVPStatus) => {
      hide(row.key);
      start(async () => {
        const result = await rsvpToEvent(orgId, row.id, rsvp);
        if (result.error) {
          show(row.key);
          toast({ title: result.error, tone: "error" });
          return;
        }
        toast({
          title: rsvp === "YES" ? "Going" : rsvp === "MAYBE" ? "Maybe" : "Not going",
          action: {
            label: "Undo",
            run: async () => {
              const back = await rsvpToEvent(orgId, row.id, "PENDING");
              if (back.error) return back.error;
              show(row.key);
              router.refresh();
            },
          },
        });
        router.refresh();
      });
    },
    [hide, orgId, router, show],
  );

  const approve = useCallback(
    (row: InboxRow) => {
      hide(row.key);
      start(async () => {
        const result = await approveExpense(orgId, row.id);
        if (result && "error" in result && result.error) {
          show(row.key);
          toast({ title: result.error, tone: "error" });
          return;
        }
        toast({
          title: "Approved",
          action: row.href ? { label: "Open", run: () => router.push(row.href!) } : undefined,
        });
        router.refresh();
      });
    },
    [hide, orgId, router, show],
  );

  const decline = useCallback(
    (row: InboxRow, reason: string) => {
      hide(row.key);
      start(async () => {
        const result = await rejectExpense(orgId, row.id, reason);
        if (result && "error" in result && result.error) {
          show(row.key);
          toast({ title: result.error, tone: "error" });
          return;
        }
        toast({ title: "Declined" });
        router.refresh();
      });
    },
    [hide, orgId, router, show],
  );

  const open = useCallback(
    (row: InboxRow) => {
      markRead(row);
      if (row.peek) setPeek(row);
      else if (row.href) router.push(row.href);
    },
    [markRead, router],
  );

  /** e: the row's own Done (a task, an update). */
  const finish = useCallback(
    (row: InboxRow) => {
      if (row.kind === "task") finishTask(row);
      else if (row.kind === "update") finishUpdate(row);
    },
    [finishTask, finishUpdate],
  );

  // ---- keyboard --------------------------------------------------------

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || peek) return;
      const move = (to: number) => {
        e.preventDefault();
        const next = Math.max(0, Math.min(shown.length - 1, to));
        setActive(next);
        rowEls.current[next]?.focus();
      };
      const row = active >= 0 ? shown[active] : undefined;
      switch (e.key) {
        case "j":
        case "ArrowDown":
          if (e.key === "ArrowDown" && active < 0) return;
          move(active + 1);
          break;
        case "k":
        case "ArrowUp":
          if (e.key === "ArrowUp" && active < 0) return;
          move(active - 1);
          break;
        case "o":
          if (row?.href) {
            e.preventDefault();
            markRead(row);
            router.push(row.href);
          }
          break;
        case "e":
        case "d":
          if (row && view !== "snoozed") {
            e.preventDefault();
            finish(row);
          }
          break;
        case "s":
          if (row && view !== "snoozed") {
            e.preventDefault();
            snooze(row, "tomorrow");
          }
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, finish, markRead, peek, router, shown, snooze, view]);

  const bar = (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented
        label="Inbox"
        value={view}
        options={views.map((v) => ({
          value: v.value,
          label: v.label,
          count: v.count,
          href: v.href,
        }))}
        className="shrink-0"
      />
      {categories.length > 1 && (
        <div className="flex shrink-0 items-center gap-1" role="group" aria-label="Show">
          <ExpandChip
            icon={Inbox}
            label={`All (${present.length})`}
            active={current === "all"}
            onClick={() => setFilter("all")}
          />
          {categories.map((c) => (
            <ExpandChip
              key={c}
              icon={LOOK[c].icon}
              label={`${CATEGORY_LABEL[c]} (${counts.get(c) ?? 0})`}
              active={current === c}
              onClick={() => setFilter(current === c ? "all" : c)}
            />
          ))}
        </div>
      )}
    </div>
  );

  if (present.length === 0)
    return (
      <div className="space-y-6">
        {bar}
        {empty}
      </div>
    );

  // Snoozed is one list by when things come back; the others are grouped.
  const groups: { group: InboxGroup | null; rows: InboxRow[] }[] = [];
  for (const row of shown) {
    const group = view === "snoozed" ? null : row.group;
    const last = groups[groups.length - 1];
    if (last && last.group === group) last.rows.push(row);
    else groups.push({ group, rows: [row] });
  }
  let index = -1;

  return (
    <div className="space-y-6">
      {bar}

      {groups.map(({ group, rows: groupRows }) => (
        <section key={group ?? "all"} aria-label={group ? GROUP_LABEL[group] : "Snoozed"}>
          {group && (
            <h2
              className={cn(
                "mb-2 flex items-baseline gap-2 px-1 text-[15px] font-semibold",
                group === "overdue" && "text-tint-danger-foreground",
              )}
            >
              {GROUP_LABEL[group]}
              <span className="text-muted-foreground text-[13px] font-medium tabular-nums">
                {groupRows.length}
              </span>
            </h2>
          )}
          <ul className={TASK_PANEL}>
            {groupRows.map((row) => {
              index += 1;
              const i = index;
              return (
                <Row
                  key={row.key}
                  row={row}
                  view={view}
                  active={i === active}
                  unread={row.unread === true && !readNow.has(row.key)}
                  replying={replyFor === row.key}
                  mainRef={(el) => {
                    rowEls.current[i] = el;
                  }}
                  onFocus={() => setActive(i)}
                  onOpen={() => open(row)}
                  onSnooze={(choice) => snooze(row, choice)}
                  onBringBack={() => bringBack(row)}
                  onFinish={() => finish(row)}
                  onMove={(key, label) => moveTask(row, key, label)}
                  onAnswer={(rsvp) => answer(row, rsvp)}
                  onApprove={() => approve(row)}
                  onDecline={(reason) => decline(row, reason)}
                  onReply={() => setReplyFor(replyFor === row.key ? null : row.key)}
                  reply={
                    replyFor === row.key && row.replyTaskId ? (
                      <ReplyBox
                        onCancel={() => setReplyFor(null)}
                        onSend={async (body) => {
                          const result = await addTaskComment(orgId, row.replyTaskId!, body);
                          if (result.error) {
                            toast({ title: result.error, tone: "error" });
                            return false;
                          }
                          setReplyFor(null);
                          markRead(row);
                          toast({
                            title: "Replied",
                            action: row.href
                              ? { label: "Open", run: () => router.push(row.href!) }
                              : undefined,
                          });
                          return true;
                        }}
                      />
                    ) : null
                  }
                />
              );
            })}
          </ul>
        </section>
      ))}

      <SidePeek
        orgId={orgId}
        orgSlug={orgSlug}
        target={
          peek?.peek
            ? {
                kind: peek.peek.kind,
                id: peek.peek.id,
                title: peek.title,
                detail: peek.meta,
                href: peek.href ?? `/app/${orgSlug}/inbox`,
              }
            : null
        }
        onClose={() => setPeek(null)}
      />
    </div>
  );
}

function Row({
  row,
  view,
  active,
  unread,
  replying,
  reply,
  mainRef,
  onFocus,
  onOpen,
  onSnooze,
  onBringBack,
  onFinish,
  onMove,
  onAnswer,
  onApprove,
  onDecline,
  onReply,
}: {
  row: InboxRow;
  view: InboxView;
  active: boolean;
  unread: boolean;
  replying: boolean;
  reply: React.ReactNode;
  mainRef: (el: HTMLButtonElement | null) => void;
  onFocus: () => void;
  onOpen: () => void;
  onSnooze: (choice: SnoozeChoice) => void;
  onBringBack: () => void;
  onFinish: () => void;
  onMove: (dueKey: string, label: string) => void;
  onAnswer: (rsvp: RSVPStatus) => void;
  onApprove: () => void;
  onDecline: (reason: string) => void;
  onReply: () => void;
}) {
  const snoozed = view === "snoozed";
  const look = LOOK[row.category];
  const second = snoozed ? [row.backAt, row.meta].filter(Boolean).join(", ") : row.meta;

  return (
    <li data-active={active} className={cn(ROW, active && "bg-muted/60")}>
      {/* Lead: the task's circle, or who it's from with what it is. */}
      {row.kind === "task" && !snoozed ? (
        <TaskCheck done={false} onToggle={onFinish} label={`Complete ${row.title}`} />
      ) : (
        <Lead row={row} icon={look.icon} tint={look.tint} unread={unread} />
      )}

      <button
        ref={mainRef}
        type="button"
        onClick={onOpen}
        onFocus={onFocus}
        data-main=""
        className="min-w-0 flex-1 basis-[calc(100%-3rem)] text-left outline-none sm:basis-auto"
      >
        <span
          className={cn(
            "block text-[15px] leading-snug break-words",
            unread ? "font-semibold" : "font-medium",
          )}
        >
          {row.title}
          {row.also && row.also.length > 0 && (
            <span className="bg-muted text-muted-foreground ml-2 rounded-full px-1.5 align-[1px] font-mono text-[11px] font-medium tabular-nums">
              {row.also.length + 1}
              <span className="sr-only"> times</span>
            </span>
          )}
        </span>
        {(second || row.actorName) && (
          <span
            className={cn(
              "mt-1 line-clamp-2 block text-[13px] break-words",
              row.urgent && !snoozed
                ? "text-tint-danger-foreground font-medium"
                : "text-muted-foreground",
            )}
          >
            {[row.actorName, second].filter(Boolean).join(", ")}
          </span>
        )}
      </button>

      <div className="flex shrink-0 items-center gap-1.5 max-sm:ml-[34px]">
        {row.when && !snoozed && (
          <span className="text-muted-foreground mr-1 text-[12px] whitespace-nowrap">
            {row.when}
            {unread && <span className="sr-only"> (unread)</span>}
          </span>
        )}

        {snoozed ? (
          <Button variant="outline" size="sm" onClick={onBringBack}>
            Bring back
          </Button>
        ) : (
          <>
            {row.kind === "invite" && (
              <span
                className={cn(segmentedTrack, "h-9")}
                role="group"
                aria-label={`Answer ${row.title}`}
              >
                {(
                  [
                    ["YES", "Going"],
                    ["MAYBE", "Maybe"],
                    ["NO", "Can't go"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => onAnswer(value)}
                    className={cn(segmentedItem(false), "h-7")}
                  >
                    {label}
                  </button>
                ))}
              </span>
            )}
            {row.kind === "task" && row.task && <MoveMenu row={row} onMove={onMove} />}
            {row.kind === "request" && (
              <>
                <DeclineButton title={row.title} onDecline={onDecline} />
                <Button size="sm" onClick={onApprove}>
                  Approve
                </Button>
              </>
            )}
            {row.kind === "review" && row.href && (
              <Button variant="outline" size="sm" asChild>
                <Link href={row.href}>Review</Link>
              </Button>
            )}
            {row.replyTaskId && (
              <Button
                variant={replying ? "secondary" : "outline"}
                size="sm"
                aria-expanded={replying}
                onClick={onReply}
              >
                Reply
              </Button>
            )}
            {row.kind === "update" && (
              <Button
                variant="ghost"
                size="icon-sm"
                className={QUIET}
                onClick={onFinish}
                title="Done (e)"
                aria-label={`Done with ${row.title}`}
              >
                <Check className="size-4" aria-hidden="true" />
              </Button>
            )}
            <SnoozeMenu title={row.title} onSnooze={onSnooze} />
          </>
        )}
      </div>

      {reply && <div className="basis-full pl-[34px] sm:pl-[38px]">{reply}</div>}
    </li>
  );
}

/** The row's face: the person it's from, badged with what it is, or the kind's icon. */
function Lead({
  row,
  icon: Icon,
  tint,
  unread,
}: {
  row: InboxRow;
  icon: IconComponent;
  tint: string;
  unread: boolean;
}) {
  return (
    <span className="relative grid size-6 shrink-0 place-items-center">
      {row.actor && row.kind !== "review" ? (
        <>
          <UserAvatar user={row.actor} size="sm" />
          <span
            className={cn(
              "ring-card absolute -right-1 -bottom-1 grid size-3.5 place-items-center rounded-full ring-2",
              tint,
            )}
            aria-hidden="true"
          >
            <Icon className="size-2.5" strokeWidth={2.5} />
          </span>
        </>
      ) : (
        <span className={cn("grid size-[22px] place-items-center rounded-full", tint)}>
          <Icon className="size-3.5" aria-hidden="true" />
        </span>
      )}
      {unread && (
        <span
          aria-hidden="true"
          className="bg-brand-accent ring-card absolute -top-0.5 -left-0.5 size-2 rounded-full ring-2"
        />
      )}
    </span>
  );
}

function SnoozeMenu({
  title,
  onSnooze,
}: {
  title: string;
  onSnooze: (choice: SnoozeChoice) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className={cn(QUIET, "data-[state=open]:opacity-100")}
          title="Snooze (s for tomorrow)"
          aria-label={`Snooze ${title}`}
        >
          <AlarmClock className="size-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {SNOOZE_CHOICES.map((c) => (
          <DropdownMenuItem key={c} onSelect={() => onSnooze(c)}>
            {SNOOZE_LABEL[c]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A task's date, moved without opening it: Tomorrow, Friday, Next week. */
function MoveMenu({
  row,
  onMove,
}: {
  row: InboxRow;
  onMove: (dueKey: string, label: string) => void;
}) {
  const today = todayKey();
  const friday = addDaysToKey(mondayOfKey(today), 4);
  const choices = [
    { key: addDaysToKey(today, 1), label: "Tomorrow" },
    ...(friday > addDaysToKey(today, 1) ? [{ key: friday, label: "Friday" }] : []),
    { key: addDaysToKey(mondayOfKey(today), 7), label: "Next week" },
  ].filter((c) => c.key !== row.task?.dueKey);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className={cn(QUIET, "data-[state=open]:opacity-100")}
          title="Move the date"
          aria-label={`Move the date of ${row.title}`}
        >
          <CalendarClock className="size-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {choices.map((c) => (
          <DropdownMenuItem key={c.label} onSelect={() => onMove(c.key, c.label)}>
            {c.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Decline asks why in a small box, since the requester sees the reason. */
function DeclineButton({ title, onDecline }: { title: string; onDecline: (r: string) => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" aria-label={`Decline ${title}`}>
          Decline
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <form
          className="space-y-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!reason.trim()) return;
            setOpen(false);
            onDecline(reason.trim());
          }}
        >
          <Input
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why, for the requester"
            aria-label="Reason"
          />
          <Button type="submit" size="sm" className="w-full" disabled={!reason.trim()}>
            Decline
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

function ReplyBox({
  onSend,
  onCancel,
}: {
  onSend: (body: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();
  const send = () => {
    const text = body.trim();
    if (!text || pending) return;
    start(async () => {
      if (await onSend(text)) setBody("");
    });
  };
  return (
    <div className="space-y-2">
      <Textarea
        autoFocus
        rows={2}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            send();
          }
          if (e.key === "Escape") onCancel();
        }}
        placeholder="Reply"
        aria-label="Reply"
      />
      <div className="flex gap-2">
        <Button size="sm" onClick={send} disabled={!body.trim() || pending}>
          Send
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** Today's key in the viewer's own clock (the Move menu's choices). */
function todayKey(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
