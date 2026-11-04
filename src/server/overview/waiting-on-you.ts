import type { Role } from "@/generated/prisma/enums";
import { can } from "@/lib/auth/permissions";
import { crmTodayHref } from "@/lib/crm/href";
import { inboxKey } from "@/lib/inbox/items";
import { whenWord } from "@/lib/overview/format";
import { crmOpenFor } from "@/server/crm/outside-links";
import { followUpQueue } from "@/server/crm/outreach/queue";
import type { RoleOwner } from "@/server/crm/owners";
import { REVIEW_WHERE } from "@/server/crm/review";
import type { TxClient } from "@/server/db/context";
import { toReviewForOwner } from "@/server/forms/forms";
import { listOpenInvites, listRequestsToReview } from "@/server/inbox/lists";
import { loadInboxState } from "@/server/inbox/state";
import { userPublicSelect } from "@/server/members";

import { linkedTo } from "./item-links";
import { buildWaitingOnYou, type WaitingFacts, type WaitingOnYou } from "./waiting-on-you-text";

/**
 * Waiting on you (Overview): what the Inbox lists under Needs you, less
 * your own tasks (My tasks has those): reimbursement requests for finance
 * roles, your forms' responses to review, unanswered invites, and the
 * mentions you haven't read. What you snoozed or finished in the Inbox
 * stays out here too, and so do your own requests (no one approves their
 * own). The requests and invites are the Inbox's own queries
 * (src/server/inbox/lists.ts). Read as the member, one query at a time.
 */

const MENTION_DAYS = 30;
const DAY_MS = 86_400_000;

export interface WaitingInput {
  orgId: string;
  orgSlug: string;
  userId: string;
  role: Role;
  timeZone: string;
  orgTimeZone: string;
  now: Date;
  /** The CRM is added: its org chart roles, for whose follow-ups are whose. */
  crm?: { roles: ReadonlyMap<string, RoleOwner> } | null;
}

export async function loadWaitingOnYou(db: TxClient, input: WaitingInput): Promise<WaitingOnYou> {
  return buildWaitingOnYou(await loadWaitingFacts(db, input));
}

export async function loadWaitingFacts(db: TxClient, input: WaitingInput): Promise<WaitingFacts> {
  const { orgId: organizationId, userId, now } = input;
  const base = `/app/${input.orgSlug}`;
  const seesMoney = can({ role: input.role }, "finance.manage");
  const state = await loadInboxState(db, organizationId, userId, now);
  const live = (key: string) => !state.snoozed.has(key) && !state.done.has(key);

  // Reimbursements, with what they pay for and their category's room.
  const requests = seesMoney
    ? (await listRequestsToReview(db, organizationId, { notSubmittedBy: userId })).filter((r) =>
        live(inboxKey("request", r.id)),
      )
    : [];
  const receipts = requests.length
    ? await db.receipt.groupBy({
        by: ["transactionId"],
        where: { organizationId, transactionId: { in: requests.map((r) => r.id) } },
        _count: { _all: true },
      })
    : [];
  // A request's task: its own taskId, else a task linked to it.
  const linkedTasks = await linkedTo(
    db,
    organizationId,
    "transaction",
    requests.filter((r) => !r.taskId).map((r) => r.id),
    "task",
  );
  const taskOf = (r: (typeof requests)[number]) => r.taskId ?? linkedTasks.get(r.id)?.[0] ?? null;
  const categoryIds = [...new Set(requests.flatMap((r) => (r.categoryId ? [r.categoryId] : [])))];
  const categories = categoryIds.length
    ? await db.budgetCategory.findMany({
        where: { organizationId, id: { in: categoryIds } },
        select: {
          id: true,
          name: true,
          allocatedCents: true,
          budgetPeriodId: true,
          budgetPeriod: { select: { label: true } },
        },
      })
    : [];
  // Spent as Finance counts it: money out that isn't a draft or declined.
  const spent = categoryIds.length
    ? await db.transaction.groupBy({
        by: ["categoryId"],
        where: {
          organizationId,
          categoryId: { in: categoryIds },
          direction: "OUT",
          voidedAt: null,
          status: { notIn: ["DRAFT", "REJECTED"] },
        },
        _sum: { amountCents: true },
      })
    : [];

  // Forms of yours with responses to review.
  const reviews = can({ role: input.role }, "databases.write")
    ? (await toReviewForOwner(db, organizationId, userId)).filter((f) =>
        live(inboxKey("review", f.id)),
      )
    : [];
  const formEvents = await linkedTo(
    db,
    organizationId,
    "form",
    reviews.map((f) => f.id),
    "event",
  );

  // Mentions you haven't read.
  const mentions = (
    await db.notification.findMany({
      where: {
        organizationId,
        userId,
        type: "TASK_MENTIONED",
        readAt: null,
        createdAt: { gt: new Date(now.getTime() - MENTION_DAYS * DAY_MS) },
      },
      select: {
        id: true,
        title: true,
        body: true,
        linkUrl: true,
        taskId: true,
        actor: { select: userPublicSelect },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    })
  ).filter((n) => live(inboxKey("update", n.id)));

  const invites = (await listOpenInvites(db, organizationId, userId, now)).filter((i) =>
    live(inboxKey("invite", i.event.id)),
  );

  const taskIds = [
    ...new Set([
      ...requests.flatMap((r) => {
        const t = taskOf(r);
        return t ? [t] : [];
      }),
      ...mentions.flatMap((m) => (m.taskId ? [m.taskId] : [])),
    ]),
  ];
  const tasks = taskIds.length
    ? await db.task.findMany({
        where: { organizationId, deletedAt: null, id: { in: taskIds } },
        select: { id: true, title: true, status: true },
      })
    : [];
  const taskEvents = await linkedTo(
    db,
    organizationId,
    "task",
    mentions.flatMap((m) => (m.taskId ? [m.taskId] : [])),
    "event",
  );
  const eventIds = [
    ...new Set([
      ...requests.flatMap((r) => (r.eventId ? [r.eventId] : [])),
      ...[...formEvents.values()].flat(),
      ...[...taskEvents.values()].flat(),
    ]),
  ];
  const events = eventIds.length
    ? await db.event.findMany({
        where: { organizationId, deletedAt: null, id: { in: eventIds } },
        select: { id: true, title: true },
      })
    : [];

  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const eventById = new Map(events.map((e) => [e.id, e]));
  const firstEvent = (ids: string[] | undefined) =>
    (ids ?? []).map((id) => eventById.get(id)).find(Boolean) ?? null;

  const crm = input.crm ? await crmWaiting(db, input, input.crm.roles, live) : null;

  return {
    base,
    now,
    seesMoney,
    requests: requests.map((r) => {
      const category = categories.find((c) => c.id === r.categoryId);
      const t = taskOf(r);
      return {
        id: r.id,
        description: r.description,
        amountCents: r.amountCents,
        createdAt: r.createdAt,
        submitter: r.submittedBy,
        receipts: receipts.find((x) => x.transactionId === r.id)?._count._all ?? 0,
        task: t ? (taskById.get(t) ?? null) : null,
        event: r.eventId ? (eventById.get(r.eventId) ?? null) : null,
        category: category
          ? {
              id: category.id,
              name: category.name,
              periodId: category.budgetPeriodId,
              periodLabel: category.budgetPeriod.label,
              allocatedCents: category.allocatedCents,
              spentCents: spent.find((s) => s.categoryId === category.id)?._sum.amountCents ?? 0,
            }
          : null,
      };
    }),
    reviews: reviews.map((f) => ({
      id: f.id,
      title: f.title,
      count: f.count,
      event: firstEvent(formEvents.get(f.id)),
    })),
    mentions: mentions.map((m) => ({
      id: m.id,
      title: m.title,
      excerpt: m.body ? (m.body.length > 120 ? `${m.body.slice(0, 117)}...` : m.body) : null,
      href: m.linkUrl,
      actor: m.actor,
      task: m.taskId ? (taskById.get(m.taskId) ?? null) : null,
      event: m.taskId ? firstEvent(taskEvents.get(m.taskId)) : null,
    })),
    invites: invites.map(({ event: e }) => ({
      id: e.id,
      title: e.title,
      when: whenWord(e.startsAt, e.allDay, { viewer: input.timeZone, org: input.orgTimeZone }, now),
      host: e.host ?? e.createdBy ?? null,
    })),
    crm,
  };
}

/**
 * The CRM's part, as the Inbox counts it (src/server/crm/outreach/inbox.ts):
 * the member's own people who replied and wait for an answer (each row
 * snoozed or done in the Inbox stays out), and the suggestions assigned
 * to them (the Inbox's one "crm:review" row). Null when the CRM isn't
 * there for them or is still being set up.
 */
async function crmWaiting(
  db: TxClient,
  input: WaitingInput,
  roles: ReadonlyMap<string, RoleOwner>,
  live: (key: string) => boolean,
): Promise<WaitingFacts["crm"]> {
  const actor = { db, organizationId: input.orgId, userId: input.userId, role: input.role };
  if (!(await crmOpenFor(actor))) return null;
  const settings = await db.crmSettings.findUnique({
    where: { organizationId: input.orgId },
    select: { setupDoneAt: true },
  });
  if (!settings?.setupDoneAt) return null;
  const queue = await followUpQueue(db, input.orgId, input.userId, roles, {
    mine: true,
    limit: 40,
    now: input.now,
  });
  const replies = queue.filter((i) => i.reasons.some((r) => r.kind === "reply") && live(i.key)).length;
  const approve = live("crm:review")
    ? await db.crmSuggestion.count({
        where: { organizationId: input.orgId, ...REVIEW_WHERE, status: "PENDING", assigneeId: input.userId },
      })
    : 0;
  if (!replies && !approve) return null;
  return {
    replies,
    repliesHref: crmTodayHref(input.orgSlug, "replies"),
    approve,
    approveHref: crmTodayHref(input.orgSlug, "approve"),
  };
}
