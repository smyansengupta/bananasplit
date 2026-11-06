import type { TxClient } from "@/server/db/context";
import { userPublicSelect } from "@/server/members";

/**
 * The Inbox's Needs you lists that Home's Waiting on you shows too, in one
 * definition so both read the same rows: reimbursement requests waiting on
 * a treasurer, and invites the member hasn't answered. What's snoozed or
 * done is filtered by the caller, against loadInboxState.
 */

/** How many of each list the Inbox reads. */
export const INBOX_LIST_LIMIT = 30;

/**
 * Reimbursement requests waiting on a treasurer, oldest first. notSubmittedBy
 * leaves out one member's own requests, which they can't approve themselves.
 */
export function listRequestsToReview(
  db: TxClient,
  organizationId: string,
  opts: { notSubmittedBy?: string } = {},
) {
  return db.transaction.findMany({
    where: {
      organizationId,
      status: "SUBMITTED",
      voidedAt: null,
      ...(opts.notSubmittedBy ? { submittedById: { not: opts.notSubmittedBy } } : {}),
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      description: true,
      amountCents: true,
      occurredAt: true,
      createdAt: true,
      taskId: true,
      eventId: true,
      categoryId: true,
      submittedBy: { select: userPublicSelect },
      _count: { select: { receipts: true } },
    },
    take: INBOX_LIST_LIMIT,
  });
}

export type RequestToReview = Awaited<ReturnType<typeof listRequestsToReview>>[number];

/** Invites the member hasn't answered, still to come, soonest first. */
export function listOpenInvites(db: TxClient, organizationId: string, userId: string, now: Date) {
  return db.eventAttendee.findMany({
    where: {
      organizationId,
      userId,
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
          host: { select: userPublicSelect },
          createdBy: { select: userPublicSelect },
        },
      },
    },
    orderBy: { event: { startsAt: "asc" } },
    take: INBOX_LIST_LIMIT,
  });
}

export type OpenInvite = Awaited<ReturnType<typeof listOpenInvites>>[number];
