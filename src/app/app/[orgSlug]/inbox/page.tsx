import { Inbox } from "@/components/icons";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PageTabs } from "@/components/ui/page-tabs";
import { can } from "@/lib/auth/permissions";
import { listWhen } from "@/components/meetings/meeting-card";
import { sectionLabel } from "@/lib/nav/sidebar";
import { ago } from "@/lib/relative-time";
import {
  addDaysToKey,
  dueDateKey,
  effectiveTimezone,
  fromDateKey,
  localDateKey,
} from "@/lib/tasks/dates";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { getMyOpenTasks } from "@/server/tasks/queries";

import { InboxNeeds, InboxUpdates, MarkAllRead, type NeedRow, type UpdateRow } from "./inbox-list";

/** How far ahead a task counts as needing you now. */
const TASK_DAYS = 7;
const TASKS_LIMIT = 40;
const UPDATES_LIMIT = 60;

/**
 * Inbox: everything waiting on you in this space, in one place, with the
 * thing to do right on each row.
 *
 * - Needs you: meetings you were invited to and haven't answered (Going,
 *   Maybe, Can't go), your open tasks due this week or overdue (a Done
 *   circle), and, for treasurers, reimbursement requests to review.
 * - Updates: what happened (mentions, assignments, comments), newest first;
 *   opening one marks it read.
 *
 * It replaces the bell's popover as the place to read notifications; the
 * bell in the top bar opens this page.
 */
export default async function InboxPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/inbox">) {
  const { orgSlug } = await params;
  const sp = await searchParams;
  const view = sp.view === "updates" ? "updates" : "needs";
  const ctx = await getOrgContextBySlug(orgSlug);
  const { organization: org, user } = ctx;
  const base = `/app/${orgSlug}`;
  const canReview = can(ctx, "finance.manage");
  const now = new Date();

  const data = await withOrgTx(org.id, async ({ db }) => {
    const me = await db.user.findUnique({ where: { id: user.id }, select: { timezone: true } });
    const tz = effectiveTimezone(me, org);
    const todayKey = localDateKey(now, tz);
    const invites = await db.eventAttendee.findMany({
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
          },
        },
      },
      orderBy: { event: { startsAt: "asc" } },
      take: 30,
    });
    const { tasks } = await getMyOpenTasks(db, org.id, user.id, {
      limit: TASKS_LIMIT,
      today: fromDateKey(todayKey),
    });
    const toReview = canReview
      ? await db.transaction.count({
          where: { organizationId: org.id, status: "SUBMITTED", voidedAt: null },
        })
      : 0;
    const notifications = await db.notification.findMany({
      where: { organizationId: org.id, userId: user.id },
      orderBy: { createdAt: "desc" },
      take: UPDATES_LIMIT,
    });
    return { tz, todayKey, invites, tasks, toReview, notifications };
  });

  const weekEnd = addDaysToKey(data.todayKey, TASK_DAYS);
  const needs: NeedRow[] = [
    ...data.invites.map(({ event: e }): NeedRow => ({
      kind: "invite",
      id: e.id,
      title: e.title,
      meta: [listWhen(e.startsAt, e.endsAt, data.tz, e.allDay), e.location?.trim() || null]
        .filter(Boolean)
        .join(", "),
      href: `${base}/meetings/${e.id}`,
    })),
    ...data.tasks
      .filter((t) => t.dueDate && dueDateKey(t.dueDate) <= weekEnd)
      .map((t): NeedRow => {
        const key = dueDateKey(t.dueDate!);
        const overdue = key < data.todayKey;
        return {
          kind: "task",
          id: t.id,
          title: t.title,
          meta: overdue ? "Overdue" : key === data.todayKey ? "Due today" : `Due ${dayName(key)}`,
          urgent: overdue || key === data.todayKey,
          href: `${base}/tasks/${t.id}`,
          status: t.status,
        };
      }),
    ...(data.toReview > 0
      ? [
          {
            kind: "review" as const,
            id: "reimbursements",
            title:
              data.toReview === 1
                ? "1 reimbursement to review"
                : `${data.toReview} reimbursements to review`,
            meta: "Finance",
            href: `${base}/finance/transactions?status=SUBMITTED`,
          },
        ]
      : []),
  ];
  const updates: UpdateRow[] = data.notifications.map((n) => ({
    id: n.id,
    title: n.title,
    body: n.body,
    href: n.linkUrl,
    when: ago(n.createdAt, now),
    unread: n.readAt === null,
  }));
  const unread = updates.filter((u) => u.unread).length;

  return (
    <div className="space-y-7.5">
      <PageHeader
        title={sectionLabel(ctx.settings?.sidebar, "inbox")}
        actions={view === "updates" && unread > 0 ? <MarkAllRead /> : null}
        tabs={
          <PageTabs
            label="Inbox"
            tabs={[
              {
                href: `${base}/inbox`,
                label: needs.length > 0 ? `Needs you ${needs.length}` : "Needs you",
                active: view === "needs",
              },
              {
                href: `${base}/inbox?view=updates`,
                label: unread > 0 ? `Updates ${unread}` : "Updates",
                active: view === "updates",
              },
            ]}
          />
        }
      />

      {view === "needs" ? (
        needs.length === 0 ? (
          <EmptyState icon={Inbox} title="Nothing waiting on you" />
        ) : (
          <InboxNeeds orgId={org.id} rows={needs} />
        )
      ) : updates.length === 0 ? (
        <EmptyState icon={Inbox} title="No updates yet" />
      ) : (
        <InboxUpdates rows={updates} />
      )}
    </div>
  );
}

const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" });

/** "Friday" for a day key in the coming week. */
function dayName(key: string): string {
  return WEEKDAY.format(new Date(`${key}T12:00:00Z`));
}
