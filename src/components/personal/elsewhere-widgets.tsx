"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";

import { rsvpToEvent } from "@/app/app/[orgSlug]/calendar/actions";
import { setTaskStatus, takeTask } from "@/app/app/[orgSlug]/tasks/actions";
import { markNotificationRead } from "@/app/app/notifications-actions";
import { AmbientButton } from "@/components/ambient/ambient-button";
import { Bell, Check, UserPlus, X } from "@/components/icons";
import { TaskCheck } from "@/components/overview/task-check";
import { toast } from "@/components/ui/toaster";
import { UserAvatar } from "@/components/user-avatar";
import { formatEventWhen } from "@/lib/calendar/format";
import { formatCents } from "@/lib/finance/money";
import { dayWordOfKey } from "@/lib/overview/format";
import { ago } from "@/lib/relative-time";
import { runAction } from "@/lib/run-action";
import { daysBetweenKeys } from "@/lib/tasks/dates";
import { cn } from "@/lib/utils";
import type {
  ApprovalsItem,
  DueTask,
  GrabTask,
  InviteItem,
  ReimbursementItem,
  UpdateItem,
  WaitingForm,
  WaitingPoll,
} from "@/server/personal/home";

/**
 * Personal Home's widgets about your organizations (data from
 * loadPersonalHome, src/server/personal/home.ts): their tasks that are
 * yours, what's up for grabs, what's waiting on your answer, what's unread
 * in their Inboxes, and your reimbursements. Every row says which
 * organization it's from and opens there; its button does the job in place
 * with that organization's own action, and a row that's done leaves.
 */

function errorOf(result: unknown): string | null {
  if (result && typeof result === "object") {
    const r = result as { ok?: boolean; error?: unknown };
    if (typeof r.error === "string" && r.error) return r.error;
    if (r.ok === false) return "That didn't go through. Try again.";
  }
  return null;
}

/** Rows that leave once done, and come back if the action fails. */
function useLeaving() {
  const router = useRouter();
  const [, start] = useTransition();
  const [gone, setGone] = useState<Set<string>>(new Set());
  const act = (key: string, run: () => Promise<unknown>, done: string) => {
    setGone((s) => new Set(s).add(key));
    start(async () => {
      const result = await runAction(async () => ({ value: await run() }));
      const error = result ? errorOf(result.value) : "";
      if (error !== null) {
        setGone((s) => {
          const next = new Set(s);
          next.delete(key);
          return next;
        });
        if (error) toast({ title: error, tone: "error" });
        return;
      }
      toast({ title: done });
      router.refresh();
    });
  };
  return { gone, act };
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-muted-foreground py-2 text-[14px]">{children}</p>;
}

/** A row: its title links where it lives, with a second line and an optional action. */
function Row({
  lead,
  href,
  title,
  sub,
  action,
  onOpen,
}: {
  lead?: ReactNode;
  href: string;
  title: string;
  sub: ReactNode;
  action?: ReactNode;
  onOpen?: () => void;
}) {
  return (
    <li className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
      {lead}
      <span className="min-w-0 flex-1">
        <Link
          href={href}
          onClick={onOpen}
          className="block truncate text-[14.5px] leading-snug font-medium hover:underline"
        >
          {title}
        </Link>
        <span className="text-muted-foreground block truncate text-[13px]">{sub}</span>
      </span>
      {action}
    </li>
  );
}

const LIST = "divide-border divide-y";

function dueWord(dueKey: string, todayKey: string): { text: string; late: boolean } {
  const days = daysBetweenKeys(dueKey, todayKey);
  if (days > 0) return { text: days === 1 ? "1 day late" : `${days} days late`, late: true };
  return {
    text: `due ${dayWordOfKey(dueKey, todayKey).replace(/^(Today|Tomorrow)$/, (w) => w.toLowerCase())}`,
    late: false,
  };
}

// ---------------------------------------------------------------- tasks

/** Your open tasks in your organizations, due soonest. A tick finishes it there. */
export function OrgTasks({ tasks, todayKey }: { tasks: DueTask[]; todayKey: string }) {
  const { gone, act } = useLeaving();
  const rows = tasks.filter((t) => !gone.has(t.id));
  if (rows.length === 0) return <Empty>Nothing due in your organizations this week.</Empty>;
  return (
    <ul className={LIST}>
      {rows.map((t) => {
        const due = dueWord(t.dueKey, todayKey);
        return (
          <Row
            key={t.id}
            lead={
              <TaskCheck
                checked={false}
                label={`Done: ${t.title}`}
                onCheck={() =>
                  act(t.id, () => setTaskStatus(t.space.id, t.id, "COMPLETED"), "Done")
                }
              />
            }
            href={t.href}
            title={t.title}
            sub={
              <>
                {t.space.name},{" "}
                <span className={cn(due.late && "text-tint-danger-foreground font-medium")}>
                  {due.text}
                </span>
              </>
            }
          />
        );
      })}
    </ul>
  );
}

/** Open tasks nobody owns in your organizations. Take it makes it yours there. */
export function UpForGrabs({ tasks, todayKey }: { tasks: GrabTask[]; todayKey: string }) {
  const { gone, act } = useLeaving();
  const rows = tasks.filter((t) => !gone.has(t.id));
  if (rows.length === 0) return <Empty>Nothing up for grabs.</Empty>;
  return (
    <ul className={LIST}>
      {rows.map((t, i) => (
        <Row
          key={t.id}
          href={t.href}
          title={t.title}
          sub={
            t.dueKey
              ? `${t.space.name}, ${dueWord(t.dueKey, todayKey).text}`
              : `${t.space.name}, no due date`
          }
          action={
            <AmbientButton
              action={{
                key: "take",
                label: "Take it",
                icon: UserPlus,
                tone: i === 0 ? "solid" : "outline",
                reason: "Nobody owns it yet",
                ariaLabel: `Take ${t.title}`,
                run: async () => {
                  act(t.id, () => takeTask(t.space.id, t.id), "It's yours");
                },
              }}
            />
          }
        />
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- answers

/**
 * What your organizations asked you and you haven't answered: events you're
 * invited to (Going or Can't go, right here), then polls and forms (each
 * opens to answer), soonest first.
 */
export function WaitingOnYourAnswer({
  invites,
  polls,
  forms,
  viewerZone,
  now,
}: {
  invites: InviteItem[];
  polls: WaitingPoll[];
  forms: WaitingForm[];
  viewerZone: string;
  now: Date;
}) {
  const { gone, act } = useLeaving();
  const shown = invites.filter((e) => !gone.has(e.id));
  if (shown.length + polls.length + forms.length === 0) {
    return <Empty>Nothing is waiting on your answer.</Empty>;
  }
  const closes = (at: Date | null) =>
    at
      ? `closes ${formatEventWhen({ startsAt: at, endsAt: at, allDay: false }, { viewer: viewerZone, org: viewerZone }, now).replace(/^(Today|Tomorrow)/, (w) => w.toLowerCase())}`
      : null;
  return (
    <ul className={LIST}>
      {shown.map((e) => (
        <li
          key={e.id}
          className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5 first:pt-0 last:pb-0"
        >
          <span className="min-w-0 flex-1 basis-48">
            <Link
              href={e.href}
              className="block truncate text-[14.5px] leading-snug font-medium hover:underline"
            >
              {e.title}
            </Link>
            <span className="text-muted-foreground block truncate text-[13px]">
              {e.space.name},{" "}
              {formatEventWhen(e, { viewer: viewerZone, org: e.space.timeZone }, now)}
            </span>
          </span>
          <span className="flex gap-1.5">
            <AmbientButton
              action={{
                key: "going",
                label: "Going",
                icon: Check,
                tone: "solid",
                reason: "You haven't answered",
                ariaLabel: `Going to ${e.title}`,
                run: async () => {
                  act(e.id, () => rsvpToEvent(e.space.id, e.id, "YES"), "You're going");
                },
              }}
            />
            <AmbientButton
              action={{
                key: "cant-go",
                label: "Can't go",
                icon: X,
                reason: "You haven't answered",
                ariaLabel: `Can't go to ${e.title}`,
                run: async () => {
                  act(e.id, () => rsvpToEvent(e.space.id, e.id, "NO"), "Answered");
                },
              }}
            />
          </span>
        </li>
      ))}
      {polls.map((p) => (
        <Row
          key={p.id}
          href={p.href}
          title={p.title}
          sub={[
            p.space.name,
            p.kind === "availability" ? "when you're free" : "a poll",
            closes(p.closesAt),
          ]
            .filter(Boolean)
            .join(", ")}
          action={
            <AmbientButton
              action={{
                key: "answer",
                label: "Answer",
                href: p.href,
                reason: "You haven't answered",
              }}
            />
          }
        />
      ))}
      {forms.map((f) => (
        <Row
          key={f.id}
          href={f.href}
          title={f.title}
          sub={[f.space.name, "a form", closes(f.closesAt)].filter(Boolean).join(", ")}
          action={
            <AmbientButton
              action={{
                key: "answer",
                label: "Answer",
                href: f.href,
                reason: "You haven't answered",
              }}
            />
          }
        />
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- inbox

/** What's unread in your organizations' Inboxes. Opening one marks it read. */
export function OrgInbox({ updates, now }: { updates: UpdateItem[]; now: Date }) {
  if (updates.length === 0) return <Empty>You&apos;re caught up in every organization.</Empty>;
  return (
    <ul className={LIST}>
      {updates.map((n) => (
        <Row
          key={n.id}
          lead={
            n.actor ? (
              <UserAvatar user={n.actor} size="sm" className="size-7" />
            ) : (
              <span
                aria-hidden="true"
                className="bg-muted text-muted-foreground grid size-7 shrink-0 place-items-center rounded-full [&_svg]:size-3.5"
              >
                <Bell />
              </span>
            )
          }
          href={n.href}
          title={n.title}
          sub={[n.space.name, ago(n.createdAt, now), n.body].filter(Boolean).join(", ")}
          onOpen={() => void markNotificationRead(n.id).catch(() => {})}
        />
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- money

/**
 * Reimbursements: the requests waiting on you to approve (finance roles),
 * then yours that aren't paid yet, in every organization.
 */
export function Reimbursements({
  mine,
  approvals,
  now,
}: {
  mine: ReimbursementItem[];
  approvals: ApprovalsItem[];
  now: Date;
}) {
  if (mine.length + approvals.length === 0) return <Empty>No reimbursements in flight.</Empty>;
  const waiting = mine.reduce((n, r) => n + r.amountCents, 0);
  return (
    <div className="space-y-3">
      {mine.length > 0 && (
        <p className="flex items-baseline gap-2">
          <span className="numeral text-[28px] leading-none">{formatCents(waiting)}</span>
          <span className="text-muted-foreground text-[13px]">on its way back to you</span>
        </p>
      )}
      <ul className={LIST}>
        {approvals.map((a) => (
          <Row
            key={a.space.id}
            href={a.href}
            title={`${a.count} to approve in ${a.space.name}`}
            sub={`Oldest: ${a.oldest.by ?? "someone"}, ${formatCents(a.oldest.amountCents)}, ${ago(a.oldest.createdAt, now)}`}
            action={
              <AmbientButton
                action={{
                  key: "review",
                  label: "Review",
                  href: a.href,
                  tone: "solid",
                  reason: "Waiting on you to approve",
                }}
              />
            }
          />
        ))}
        {mine.map((r) => (
          <Row
            key={r.id}
            href={r.href}
            title={`${r.description}, ${formatCents(r.amountCents)}`}
            sub={`${r.space.name}, asked ${ago(r.createdAt, now)}`}
            action={
              <span
                className={cn(
                  "shrink-0 rounded-full px-2.5 py-0.5 text-[12px] font-semibold",
                  r.status === "APPROVED"
                    ? "bg-tint-success text-tint-success-foreground"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {r.status === "APPROVED" ? "Approved" : "Waiting"}
              </span>
            }
          />
        ))}
      </ul>
    </div>
  );
}
