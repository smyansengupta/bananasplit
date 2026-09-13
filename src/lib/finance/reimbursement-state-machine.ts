import { TransactionStatus } from "@/generated/prisma/enums";

export type ExpenseTransition =
  "SUBMIT" | "WITHDRAW" | "APPROVE" | "REJECT" | "REIMBURSE" | "MARK_NOT_APPLICABLE";

export interface TransitionContext {
  currentStatus: TransactionStatus;
  transition: ExpenseTransition;
  actorId: string;
  submitterId: string;
  /** OWNER or TREASURER, per requireFinanceAccess. */
  actorHasFinanceAccess: boolean;
}

export type TransitionResult = { status: TransactionStatus } | { error: string };

/**
 * The single, server-side source of truth for expense status transitions
 * (spec 5.4). Every mutation that changes a transaction's status must go
 * through this — no ad-hoc status writes elsewhere.
 *
 * Self-approval is blocked across the board (approve/reject/reimburse), not
 * just "approve": letting a treasurer sign off on their own expense at any
 * step defeats the same abuse case the spec calls out.
 */
export function nextExpenseStatus(ctx: TransitionContext): TransitionResult {
  const isSubmitter = ctx.actorId === ctx.submitterId;

  switch (ctx.transition) {
    case "SUBMIT":
      if (ctx.currentStatus !== TransactionStatus.DRAFT) {
        return { error: "Only a draft expense can be submitted." };
      }
      if (!isSubmitter) return { error: "Only the submitter can submit this expense." };
      return { status: TransactionStatus.SUBMITTED };

    case "WITHDRAW":
      if (ctx.currentStatus !== TransactionStatus.SUBMITTED) {
        return { error: "Only a submitted expense can be withdrawn." };
      }
      if (!isSubmitter) return { error: "Only the submitter can withdraw this expense." };
      return { status: TransactionStatus.DRAFT };

    case "MARK_NOT_APPLICABLE":
      if (ctx.currentStatus !== TransactionStatus.DRAFT) {
        return { error: "Only a draft expense can be marked not applicable." };
      }
      if (!isSubmitter && !ctx.actorHasFinanceAccess) {
        return { error: "You don't have permission to do that." };
      }
      return { status: TransactionStatus.NOT_APPLICABLE };

    case "APPROVE":
      if (ctx.currentStatus !== TransactionStatus.SUBMITTED) {
        return { error: "Only a submitted expense can be approved." };
      }
      if (!ctx.actorHasFinanceAccess) {
        return { error: "Only a treasurer or owner can approve expenses." };
      }
      if (isSubmitter) return { error: "You can't approve your own expense." };
      return { status: TransactionStatus.APPROVED };

    case "REJECT":
      if (
        ctx.currentStatus !== TransactionStatus.SUBMITTED &&
        ctx.currentStatus !== TransactionStatus.APPROVED
      ) {
        return { error: "Only a submitted or approved expense can be rejected." };
      }
      if (!ctx.actorHasFinanceAccess) {
        return { error: "Only a treasurer or owner can reject expenses." };
      }
      if (isSubmitter) return { error: "You can't reject your own expense." };
      return { status: TransactionStatus.REJECTED };

    case "REIMBURSE":
      if (ctx.currentStatus !== TransactionStatus.APPROVED) {
        return { error: "Only an approved expense can be marked reimbursed." };
      }
      if (!ctx.actorHasFinanceAccess) {
        return { error: "Only a treasurer or owner can mark expenses reimbursed." };
      }
      if (isSubmitter) return { error: "You can't reimburse your own expense." };
      return { status: TransactionStatus.REIMBURSED };

    default:
      return { error: "Unknown transition." };
  }
}
