import { Inbox } from "@/components/icons";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { InboxView, type InboxRow, type InboxView as View } from "@/components/inbox/inbox-view";
import { ClearRead, MarkAllRead } from "@/components/inbox/inbox-actions";
import { listWhen } from "@/components/meetings/meeting-card";
import { PageHeader } from "@/components/page-header";
import { can } from "@/lib/auth/permissions";
import { groupForDay, groupForPast, inboxKey, type InboxGroup } from "@/lib/inbox/items";
import { sectionLabel } from "@/lib/nav/sidebar";
import { ago } from "@/lib/relative-time";
import {
  addDaysToKey,
  dueDateKey,
  effectiveTimezone,
  fromDateKey,
  localDateKey,
} from "@/lib/tasks/dates";
import type { NotificationType } from "@/generated/prisma/enums";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { toReviewForOwner } from "@/server/forms/forms";
import { loadInboxState } from "@/server/inbox/state";
import { getMyOpenTasks } from "@/server/tasks/queries";

/** How far ahead a task counts as needing you now. */
const TASK_DAYS = 7;
const TASKS_LIMIT = 40;
const UPDATES_LIMIT = 80;

/**
 * Inbox: everything waiting on you in this space, with the thing to do right
 * on each row, so most of it is dealt with without leaving the page.
 *
 * - Needs you: invites to answer (Going, Maybe, Can't go), your tasks due
 *   this week or overdue (Done, or move the date), reimbursement requests
 *   (Approve or Decline, for treasurers) and form responses to review,
 *   grouped Overdue, Today, This week, To review.
 * - Updates: what happened (mentions, comments, assignments, meetings),
 *   newest first in Today, This week, Earlier; Reply to a mention or comment
 *   in place, Done takes one out of the list.
 * - Snoozed: what you put off, each with when it comes back.
 *
 * A row opens beside the list (the side peek); the chips above filter by
 * kind; j and k move, Enter opens, e finishes, s snoozes until tomorrow.
 */
export default async function InboxPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/inbox">) {
  const { orgSlug } = await params;
  const sp = await searchParams;
  const asked: View =
    sp.view === "updates" ? "updates" : sp.view === "snoozed" ? "snoozed" : "needs";
  const ctx = await getOrgContextBySlug(orgSlug);
  const { organization: org, user } = ctx;
  const base = `/app/${orgSlug}`;
  const canReview = can(ctx, "finance.manage");
  const now = new Date();

  const data = await withOrgTx(org.id, async ({ db }) => {
    const me = await db.user.findUnique({ where: { id: user.id }, select: { timezone: true } });
    const tz = effectiveTimezone(me, org);
    const todayKey = localDateKey(now, tz);
    const [state, invites, open, toReview, notifications, forms, nextEvent] = await Promise.all([
      loadInboxState(db, org.id, user.id, now),
      db.eventAttendee.findMany({
        where: {
          organizationId: org.id,
          userId: user.id,
          rsvp: "PENDING",
          event: { deletedAt: null, mergedIntoId: null, endsAt: { gt: now } },
        },
        select: {
          event: {
            select: {
              id: true,
              title: true,
              startsAt: true,
              endsAt: true,
              allDay: true,
              location: true,
              createdBy: { select: { name: true, image: true, avatar: true } },
              host: { select: { name: true, image: true, avatar: true } },
            },
          },
        },
        orderBy: { event: { startsAt: "asc" } },
        take: 30,
      }),
      getMyOpenTasks(db, org.id, user.id, { limit: TASKS_LIMIT, today: fromDateKey(todayKey) }),
      // Each reimbursement request waiting on a treasurer, oldest first.
      canReview
        ? db.transaction.findMany({
            where: { organizationId: org.id, status: "SUBMITTED", voidedAt: null },
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              description: true,
              amountCents: true,
              occurredAt: true,
              submittedBy: { select: { name: true, image: true, avatar: true } },
            },
            take: 30,
          })
        : Promise.resolve([]),
      db.notification.findMany({
        where: { organizationId: org.id, userId: user.id },
        orderBy: { createdAt: "desc" },
        take: UPDATES_LIMIT,
        include: { actor: { select: { name: true, image: true, avatar: true } } },
      }),
      // Forms this person made whose responses wait on a review.
      can(ctx, "databases.write")
        ? toReviewForOwner(db, org.id, user.id)
        : Promise.resolve([] as { id: string; title: string; count: number }[]),
      // For the empty state: what's next, so caught up still points somewhere.
      db.event.findFirst({
        where: {
          organizationId: org.id,
          deletedAt: null,
          mergedIntoId: null,
          startsAt: { gt: now },
        },
        orderBy: { startsAt: "asc" },
        select: { id: true, title: true, startsAt: true, endsAt: true, allDay: true },
      }),
    ]);
    return {
      tz,
      todayKey,
      state,
      invites,
      tasks: open.tasks,
      toReview,
      notifications,
      forms,
      nextEvent,
    };
  });

  const { tz, todayKey, state } = data;
  const weekEnd = addDaysToKey(todayKey, TASK_DAYS);

  const needs: InboxRow[] = [
    ...data.invites.map(({ event: e }): InboxRow => ({
      key: inboxKey("invite", e.id),
      kind: "invite",
      id: e.id,
      title: e.title,
      meta: [listWhen(e.startsAt, e.endsAt, tz, e.allDay), e.location?.trim() || null]
        .filter(Boolean)
        .join(", "),
      group: groupForDay(localDateKey(e.startsAt, tz), todayKey),
      category: "meeting",
      href: `${base}/meetings/${e.id}`,
      peek: { kind: "event", id: e.id },
      actor: e.host ?? e.createdBy,
    })),
    ...data.tasks
      .filter((t) => t.dueDate && dueDateKey(t.dueDate) <= weekEnd)
      .map((t): InboxRow => {
        const key = dueDateKey(t.dueDate!);
        const overdue = key < todayKey;
        return {
          key: inboxKey("task", t.id),
          kind: "task",
          id: t.id,
          title: t.title,
          meta: overdue
            ? `Overdue, ${SHORT.format(fromDateKey(key))}`
            : key === todayKey
              ? "Due today"
              : `Due ${WEEKDAY.format(fromDateKey(key))}`,
          urgent: overdue || key === todayKey,
          group: groupForDay(key, todayKey),
          category: "task",
          href: `${base}/tasks/${t.id}`,
          peek: { kind: "task", id: t.id },
          task: { status: t.status, dueKey: key },
        };
      }),
    ...data.toReview.map((t): InboxRow => ({
      key: inboxKey("request", t.id),
      kind: "request",
      id: t.id,
      title: t.description,
      meta: [MONEY.format(t.amountCents / 100), SHORT.format(t.occurredAt)].join(", "),
      group: "review",
      category: "approval",
      href: `${base}/finance/transactions?open=${t.id}`,
      peek: { kind: "transaction", id: t.id },
      actor: t.submittedBy,
      actorName: t.submittedBy?.name ?? null,
    })),
    ...data.forms.map((f): InboxRow => ({
      key: inboxKey("review", f.id),
      kind: "review",
      id: f.id,
      title: f.title,
      meta: f.count === 1 ? "1 response to review" : `${f.count} responses to review`,
      group: "review",
      category: "form",
      href: `${base}/forms/${f.id}?tab=responses&view=review`,
      peek: { kind: "form", id: f.id },
    })),
  ];

  const updates: InboxRow[] = data.notifications.map((n): InboxRow => {
    const category = CATEGORY[n.type] ?? "other";
    return {
      key: inboxKey("update", n.id),
      kind: "update",
      id: n.id,
      title: n.title,
      meta: n.body ?? "",
      group: groupForPast(n.createdAt, now, tz),
      category,
      href: n.linkUrl,
      peek: n.taskId ? { kind: "task", id: n.taskId } : null,
      actor: n.actor,
      when: ago(n.createdAt, now),
      unread: n.readAt === null,
      replyTaskId: n.taskId && (category === "mention" || category === "comment") ? n.taskId : null,
    };
  });

  const snoozedAt = (r: InboxRow) => state.snoozed.get(r.key);
  const live = (r: InboxRow) => !snoozedAt(r) && !state.done.has(r.key);
  const needsNow = needs.filter(live).sort(byGroup);
  const updatesNow = collapseRepeats(updates.filter(live));
  const isSnoozed = (r: InboxRow) => Boolean(snoozedAt(r)) && !state.done.has(r.key);
  const snoozed = [...needs.filter(isSnoozed), ...collapseRepeats(updates.filter(isSnoozed))]
    .map((r) => ({ ...r, backAt: backLabel(snoozedAt(r)!, now, tz) }))
    .sort((a, b) => snoozedAt(a)!.getTime() - snoozedAt(b)!.getTime());
  const unread = updatesNow.filter((u) => u.unread).length;
  const read = updatesNow.length - unread;
  // Snoozed only shows while something is snoozed.
  const view: View = asked === "snoozed" && snoozed.length === 0 ? "needs" : asked;
  const rows = view === "needs" ? needsNow : view === "updates" ? updatesNow : snoozed;

  const next = data.nextEvent;
  const caughtUp = (
    <EmptyState
      icon={Inbox}
      title={view === "updates" ? "No updates" : "You're all caught up"}
      description={
        next ? (
          <>
            Next up:{" "}
            <Link
              href={`${base}/meetings/${next.id}`}
              className="text-foreground font-medium underline underline-offset-4"
            >
              {next.title}
            </Link>
            , {listWhen(next.startsAt, next.endsAt, tz, next.allDay)}
          </>
        ) : undefined
      }
    />
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={sectionLabel(ctx.settings?.sidebar, "inbox")}
        actions={
          view === "updates" && (unread > 0 || read > 0) ? (
            <div className="flex flex-wrap gap-2">
              {read > 0 && <ClearRead orgId={org.id} />}
              {unread > 0 && <MarkAllRead />}
            </div>
          ) : null
        }
      />

      <InboxView
        key={view}
        orgId={org.id}
        orgSlug={orgSlug}
        view={view}
        views={[
          {
            value: "needs",
            label: needsNow.length > 0 ? `Needs you ${needsNow.length}` : "Needs you",
            href: `${base}/inbox`,
          },
          {
            value: "updates",
            label: unread > 0 ? `Updates ${unread}` : "Updates",
            href: `${base}/inbox?view=updates`,
          },
          ...(snoozed.length > 0
            ? [
                {
                  value: "snoozed" as const,
                  label: `Snoozed ${snoozed.length}`,
                  href: `${base}/inbox?view=snoozed`,
                },
              ]
            : []),
        ]}
        rows={rows}
        empty={caughtUp}
      />
    </div>
  );
}

const CATEGORY: Partial<Record<NotificationType, InboxRow["category"]>> = {
  TASK_MENTIONED: "mention",
  TASK_COMMENTED: "comment",
  TASK_ASSIGNED: "assigned",
  TASK_FLAGGED: "assigned",
  TASK_DUE_SOON: "task",
  TASK_DUE_REMINDER: "task",
  TASK_DUE_TODAY: "task",
  TASK_OVERDUE: "task",
  TASK_DIGEST: "task",
  WEEKLY_UPDATE_REMINDER: "task",
  EVENT_INVITE: "meeting",
  EVENT_UPDATED: "meeting",
  EVENT_CANCELLED: "meeting",
  SECURITY_ALERT: "alert",
  INTEGRATION_ERROR: "alert",
};

/**
 * The same update over and over (a hook added and removed, a test run) is
 * one row with how many times, in its group: the newest stands for the rest,
 * and Done, Snooze and read apply to all of them.
 */
function collapseRepeats(rows: InboxRow[]): InboxRow[] {
  const out: InboxRow[] = [];
  const seen = new Map<string, InboxRow>();
  for (const row of rows) {
    if (row.replyTaskId) {
      out.push(row);
      continue;
    }
    const id = `${row.group}|${row.category}|${row.title}|${row.meta}|${row.href ?? ""}`;
    const first = seen.get(id);
    if (!first) {
      const copy = { ...row, also: [] as string[] };
      seen.set(id, copy);
      out.push(copy);
    } else {
      first.also!.push(row.id);
      first.unread = first.unread || row.unread;
    }
  }
  return out;
}

const GROUP_ORDER: InboxGroup[] = ["overdue", "today", "week", "later", "review", "earlier"];
function byGroup(a: InboxRow, b: InboxRow): number {
  return GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group);
}

const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" });
const SHORT = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const MONEY = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** "Back at 5 PM", "Back tomorrow, 8 AM", "Back Mon, Nov 9, 8 AM". */
function backLabel(at: Date, now: Date, tz: string): string {
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: at.getUTCMinutes() === 0 ? undefined : "2-digit",
    timeZone: tz,
  }).format(at);
  const key = localDateKey(at, tz);
  const today = localDateKey(now, tz);
  if (key === today) return `Back at ${time}`;
  if (key === addDaysToKey(today, 1)) return `Back tomorrow, ${time}`;
  const day = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: tz,
  }).format(at);
  return `Back ${day}, ${time}`;
}
