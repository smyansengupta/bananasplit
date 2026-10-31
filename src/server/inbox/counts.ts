import { addDaysToKey, effectiveTimezone, fromDateKey, localDateKey } from "@/lib/tasks/dates";
import type { TxClient } from "@/server/db/context";
import { toReviewForOwner } from "@/server/forms/forms";
import { taskFilterWhere } from "@/server/tasks/queries";

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
  const { snoozed } = await loadInboxState(db, input.orgId, input.userId, now);
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
  const formResponses = forms.reduce((n, f) => n + f.count, 0);
  const formsWaiting = forms.filter((f) => !snoozedForms.has(f.id)).length;
  return {
    inbox: invites + tasks + finance + formsWaiting,
    forms: formResponses,
    finance,
  };
}
