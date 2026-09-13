import { describe, expect, it } from "vitest";

import { TransactionStatus } from "@/generated/prisma/enums";
import { nextExpenseStatus } from "./reimbursement-state-machine";

const submitter = "user_submitter";
const treasurer = "user_treasurer";

describe("nextExpenseStatus — illegal transitions rejected (spec 5.4)", () => {
  it("rejects DRAFT -> REIMBURSED", () => {
    const result = nextExpenseStatus({
      currentStatus: TransactionStatus.DRAFT,
      transition: "REIMBURSE",
      actorId: treasurer,
      submitterId: submitter,
      actorHasFinanceAccess: true,
    });
    expect(result).toHaveProperty("error");
  });

  it("rejects REIMBURSED -> anything (withdraw attempted)", () => {
    const result = nextExpenseStatus({
      currentStatus: TransactionStatus.REIMBURSED,
      transition: "WITHDRAW",
      actorId: submitter,
      submitterId: submitter,
      actorHasFinanceAccess: false,
    });
    expect(result).toHaveProperty("error");
  });

  it("rejects REIMBURSED -> REJECTED", () => {
    const result = nextExpenseStatus({
      currentStatus: TransactionStatus.REIMBURSED,
      transition: "REJECT",
      actorId: treasurer,
      submitterId: submitter,
      actorHasFinanceAccess: true,
    });
    expect(result).toHaveProperty("error");
  });
});

describe("nextExpenseStatus — a member cannot approve their own expense (spec 5.4)", () => {
  it("rejects self-approval even when the submitter holds finance access", () => {
    const result = nextExpenseStatus({
      currentStatus: TransactionStatus.SUBMITTED,
      transition: "APPROVE",
      actorId: treasurer,
      submitterId: treasurer,
      actorHasFinanceAccess: true,
    });
    expect(result).toEqual({ error: "You can't approve your own expense." });
  });

  it("rejects self-reimbursement for the same reason", () => {
    const result = nextExpenseStatus({
      currentStatus: TransactionStatus.APPROVED,
      transition: "REIMBURSE",
      actorId: treasurer,
      submitterId: treasurer,
      actorHasFinanceAccess: true,
    });
    expect(result).toEqual({ error: "You can't reimburse your own expense." });
  });

  it("allows a different treasurer/owner to approve it", () => {
    const result = nextExpenseStatus({
      currentStatus: TransactionStatus.SUBMITTED,
      transition: "APPROVE",
      actorId: "user_owner",
      submitterId: treasurer,
      actorHasFinanceAccess: true,
    });
    expect(result).toEqual({ status: TransactionStatus.APPROVED });
  });

  it("rejects approval from a member without finance access, even if not the submitter", () => {
    const result = nextExpenseStatus({
      currentStatus: TransactionStatus.SUBMITTED,
      transition: "APPROVE",
      actorId: "user_random_member",
      submitterId: submitter,
      actorHasFinanceAccess: false,
    });
    expect(result).toEqual({ error: "Only a treasurer or owner can approve expenses." });
  });
});

describe("nextExpenseStatus — legal happy path", () => {
  it("walks DRAFT -> SUBMITTED -> APPROVED -> REIMBURSED", () => {
    let status: TransactionStatus = TransactionStatus.DRAFT;

    let result = nextExpenseStatus({
      currentStatus: status,
      transition: "SUBMIT",
      actorId: submitter,
      submitterId: submitter,
      actorHasFinanceAccess: false,
    });
    expect(result).toEqual({ status: TransactionStatus.SUBMITTED });
    status = (result as { status: TransactionStatus }).status;

    result = nextExpenseStatus({
      currentStatus: status,
      transition: "APPROVE",
      actorId: treasurer,
      submitterId: submitter,
      actorHasFinanceAccess: true,
    });
    expect(result).toEqual({ status: TransactionStatus.APPROVED });
    status = (result as { status: TransactionStatus }).status;

    result = nextExpenseStatus({
      currentStatus: status,
      transition: "REIMBURSE",
      actorId: treasurer,
      submitterId: submitter,
      actorHasFinanceAccess: true,
    });
    expect(result).toEqual({ status: TransactionStatus.REIMBURSED });
  });

  it("allows the submitter to withdraw a submitted expense back to draft", () => {
    const result = nextExpenseStatus({
      currentStatus: TransactionStatus.SUBMITTED,
      transition: "WITHDRAW",
      actorId: submitter,
      submitterId: submitter,
      actorHasFinanceAccess: false,
    });
    expect(result).toEqual({ status: TransactionStatus.DRAFT });
  });
});
