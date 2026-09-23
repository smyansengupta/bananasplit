import { TaskStatus } from "@/generated/prisma/enums";

/**
 * Status transitions. Every path that changes a status (the dialog, the
 * board drag, bulk status, subtask toggles) computes completedAt, blockedAt
 * and blockedReason here, so they never drift:
 *
 * - into COMPLETED: completedAt = now (kept if it was already completed);
 * - into BLOCKED: a reason is required; blockedAt = now (kept if it was
 *   already blocked, while the reason may change);
 * - anything else clears completedAt, blockedAt and blockedReason.
 *
 * Pure and client-safe (the board uses it for its optimistic update).
 */

export const STATUS_ORDER: readonly TaskStatus[] = [
  TaskStatus.NOT_STARTED,
  TaskStatus.IN_PROGRESS,
  TaskStatus.BLOCKED,
  TaskStatus.COMPLETED,
];

export const OPEN_STATUSES: readonly TaskStatus[] = [
  TaskStatus.NOT_STARTED,
  TaskStatus.IN_PROGRESS,
  TaskStatus.BLOCKED,
];

export const MAX_BLOCKED_REASON = 500;

export interface StatusFields {
  status: TaskStatus;
  completedAt: Date | null;
  blockedAt: Date | null;
  blockedReason: string | null;
}

export class BlockedReasonRequiredError extends Error {
  constructor() {
    super("Say what the task is blocked on.");
    this.name = "BlockedReasonRequiredError";
  }
}

export function statusTransitionData(
  prev: StatusFields,
  next: TaskStatus,
  options: { blockedReason?: string | null; now?: Date } = {},
): StatusFields {
  const now = options.now ?? new Date();
  if (next === TaskStatus.COMPLETED) {
    return {
      status: next,
      completedAt: prev.status === TaskStatus.COMPLETED ? (prev.completedAt ?? now) : now,
      blockedAt: null,
      blockedReason: null,
    };
  }
  if (next === TaskStatus.BLOCKED) {
    const given = options.blockedReason?.trim();
    const reason =
      given || (prev.status === TaskStatus.BLOCKED ? prev.blockedReason?.trim() : undefined);
    if (!reason) throw new BlockedReasonRequiredError();
    return {
      status: next,
      completedAt: null,
      blockedAt: prev.status === TaskStatus.BLOCKED ? (prev.blockedAt ?? now) : now,
      blockedReason: reason.slice(0, MAX_BLOCKED_REASON),
    };
  }
  return { status: next, completedAt: null, blockedAt: null, blockedReason: null };
}

export function isOpenStatus(status: TaskStatus | string): boolean {
  return status !== TaskStatus.COMPLETED;
}
