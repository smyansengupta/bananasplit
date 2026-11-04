import { addDaysToKey, effectiveTimezone, fromDateKey, localDateKey } from "@/lib/tasks/dates";
import type { TxClient } from "@/server/db/context";
import { toReviewForOwner } from "@/server/forms/forms";
import { taskFilterWhere } from "@/server/tasks/queries";

import type { RoleOwner } from "@/server/crm/owners";
import { crmInboxItems, crmReviewRow } from "@/server/crm/outreach/inbox";

import { idsOfKind, loadInboxState } from "./state";

/** How far ahead a task counts as needing you now (the Inbox's window). */
export const INBOX_TASK_DAYS = 7;

export interface SidebarCounts {
  /** Rows in the Inbox's Needs you. */
  inbox: number;
  /** Form responses waiting on this member's review. */
  forms: number;
  /** Reimbursement requests waiting on a treasurer. */
  finance: number;
  /** What `inbox` is made of, for Home's Today strip. */
  needsYou: { invites: number; tasks: number; requests: number; reviews: number; signals?: number; crm?: number };
}

/**
 * The small counts beside Inbox, Forms and Finance in the sidebar, the same
 * things the Inbox lists: unanswered invites still to come, open tasks of
 * yours due this week or overdue, each reimbursement request waiting (for
 * finance roles) and each of your forms with responses to review, less
 * what you snoozed. Cheap counts only; this runs on every page.
 */
export async function sidebarCounts(
  db: TxClient,
  input: {
    orgId: string;
    userId: string;
    org: { timezone: string };
    canReviewFinance: boolean;
    canReviewForms: boolean;
    /** The CRM is added: its follow-up queue rows and its Review row count too (the roles read before the transaction). */
    crm?: { orgSlug: string; roles: ReadonlyMap<string, RoleOwner> } | null;
    now?: Date;
  },
): Promise<SidebarCounts> {
  const now = input.now ?? new Date();
  const me = await db.user.findUnique({
    where: { id: input.userId },
    select: { timezone: true },
  });
  const tz = effectiveTimezone(me, input.org);
  const weekEnd = fromDateKey(addDaysToKey(localDateKey(now, tz), INBOX_TASK_DAYS));
  // Snoozed rows stay out of the count until they come back.
  const { snoozed, done } = await loadInboxState(db, input.orgId, input.userId, now);
  const keys = [...snoozed.keys()];
  const not = (kind: string) => {
    const ids = idsOfKind(keys, kind);
    return ids.length > 0 ? { id: { notIn: ids } } : {};
  };
  const snoozedForms = new Set(idsOfKind(keys, "review"));
  const [invites, tasks, finance, forms] = await Promise.all([
    db.eventAttendee.count({
      where: {
        organizationId: input.orgId,
        userId: input.userId,
        rsvp: "PENDING",
        event: { deletedAt: null, mergedIntoId: null, endsAt: { gt: now }, ...not("invite") },
      },
    }),
    db.task.count({
      where: {
        AND: [
          taskFilterWhere(input.orgId, { assigneeId: input.userId, status: "open" }),
          { dueDate: { lte: weekEnd } },
          not("task"),
        ],
      },
    }),
    input.canReviewFinance
      ? db.transaction.count({
          where: {
            organizationId: input.orgId,
            status: "SUBMITTED",
            voidedAt: null,
            ...not("request"),
          },
        })
      : Promise.resolve(0),
    input.canReviewForms
      ? toReviewForOwner(db, input.orgId, input.userId)
      : Promise.resolve([] as { id: string; count: number }[]),
  ]);
  // The CRM's signals waiting on this member, less what they snoozed or finished.
  const hidden = [...idsOfKind(keys, "signal"), ...idsOfKind(done, "signal")];
  const signals = await db.crmSuggestion.count({
    where: {
      organizationId: input.orgId,
      source: "SIGNAL",
      status: "PENDING",
      assigneeId: input.userId,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      ...(hidden.length > 0 ? { id: { notIn: hidden } } : {}),
    },
  });
  // The CRM's own rows: the follow-up queue (replies, steps, follow-ups,
  // new people) and one row for Review suggestions assigned to them.
  let crm = 0;
  if (input.crm) {
    const hide = (key: string) => snoozed.has(key) || done.has(key);
    const rows = await crmInboxItems(db, input.orgId, input.userId, input.crm.orgSlug, input.crm.roles, now).catch(() => []);
    crm += rows.filter((r) => !hide(r.key)).length;
    const review = await crmReviewRow(db, input.orgId, input.userId, input.crm.orgSlug);
    if (review && !hide(review.key)) crm += 1;
  }
  const formResponses = forms.reduce((n, f) => n + f.count, 0);
  const formsWaiting = forms.filter((f) => !snoozedForms.has(f.id)).length;
  return {
    inbox: invites + tasks + finance + formsWaiting + signals + crm,
    forms: formResponses,
    finance,
    needsYou: { invites, tasks, requests: finance, reviews: formsWaiting, signals, crm },
  };
}
