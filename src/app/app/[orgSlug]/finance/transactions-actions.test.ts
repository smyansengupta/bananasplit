import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock }));

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    membership: { findUnique: vi.fn() },
    budgetPeriod: { findFirst: vi.fn() },
    budgetCategory: { findFirst: vi.fn() },
    transaction: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    financeAuditLog: { create: vi.fn() },
    user: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/email", () => ({ sendReimbursementStatusEmail: vi.fn() }));

const { Role } = await import("@/generated/prisma/enums");
const { createTransaction, voidTransaction } = await import("./transactions-actions");

const member = { id: "member_1", email: "member@example.edu", name: "Member" };

beforeEach(() => {
  vi.clearAllMocks();
  requireUserMock.mockResolvedValue(member);
  prismaMock.$transaction.mockImplementation(async (arg: unknown) => {
    if (typeof arg === "function") {
      return arg({
        transaction: prismaMock.transaction,
        financeAuditLog: prismaMock.financeAuditLog,
      });
    }
    return Promise.all(arg as Promise<unknown>[]);
  });
});

const validExpenseInput = {
  budgetPeriodId: "period_1",
  direction: "OUT",
  kind: "EXPENSE",
  amountCents: 1500,
  description: "Pizza for meeting",
  occurredAt: "2026-01-05T00:00:00.000Z",
};

describe("createTransaction — amounts (spec 5.1 / 5.3)", () => {
  beforeEach(() => {
    prismaMock.membership.findUnique.mockResolvedValue({ role: Role.MEMBER });
    prismaMock.budgetPeriod.findFirst.mockResolvedValue({ id: "period_1" });
    prismaMock.transaction.create.mockResolvedValue({ id: "txn_1" });
  });

  it("rejects a zero amount", async () => {
    const result = await createTransaction("org_1", { ...validExpenseInput, amountCents: 0 });
    expect(result.error).toBeTruthy();
    expect(prismaMock.transaction.create).not.toHaveBeenCalled();
  });

  it("rejects a negative amount", async () => {
    const result = await createTransaction("org_1", { ...validExpenseInput, amountCents: -500 });
    expect(result.error).toBeTruthy();
    expect(prismaMock.transaction.create).not.toHaveBeenCalled();
  });

  it("allows any member to submit an EXPENSE", async () => {
    const result = await createTransaction("org_1", validExpenseInput);
    expect(result.error).toBeUndefined();
    expect(prismaMock.transaction.create).toHaveBeenCalledOnce();
  });

  it("rejects a non-expense transaction from a plain member", async () => {
    const result = await createTransaction("org_1", {
      ...validExpenseInput,
      direction: "IN",
      kind: "OTHER_INCOME",
    });
    expect(result.error).toMatch(/treasurer or owner/i);
    expect(prismaMock.transaction.create).not.toHaveBeenCalled();
  });

  it("returns not-found for a budget period belonging to another org", async () => {
    prismaMock.budgetPeriod.findFirst.mockResolvedValue(null);
    const result = await createTransaction("org_1", validExpenseInput);
    expect(result.error).toMatch(/not found/i);
  });
});

describe("voidTransaction — spec 5.3", () => {
  it("requires a reason", async () => {
    prismaMock.membership.findUnique.mockResolvedValue({ role: Role.TREASURER });
    const result = await voidTransaction("org_1", "txn_1", "");
    expect(result.error).toMatch(/reason/i);
    expect(prismaMock.transaction.update).not.toHaveBeenCalled();
  });

  it("returns not-found for a transaction in another org", async () => {
    prismaMock.membership.findUnique.mockResolvedValue({ role: Role.TREASURER });
    prismaMock.transaction.findFirst.mockResolvedValue(null);
    const result = await voidTransaction("org_1", "txn_from_other_org", "duplicate entry");
    expect(result.error).toMatch(/not found/i);
  });

  it("blocks a reconciled transaction from being voided until unlocked", async () => {
    prismaMock.membership.findUnique.mockResolvedValue({ role: Role.TREASURER });
    prismaMock.transaction.findFirst.mockResolvedValue({
      id: "txn_1",
      reconciledAt: new Date(),
      voidedAt: null,
    });
    const result = await voidTransaction("org_1", "txn_1", "duplicate entry");
    expect(result.error).toMatch(/reconciled/i);
    expect(prismaMock.transaction.update).not.toHaveBeenCalled();
  });

  it("marks the transaction voided with the given reason, never deleting it", async () => {
    prismaMock.membership.findUnique.mockResolvedValue({ role: Role.TREASURER });
    prismaMock.transaction.findFirst.mockResolvedValue({
      id: "txn_1",
      reconciledAt: null,
      voidedAt: null,
    });
    prismaMock.transaction.update.mockResolvedValue({ id: "txn_1", voidedAt: new Date() });

    const result = await voidTransaction("org_1", "txn_1", "Duplicate entry");

    expect(result.error).toBeUndefined();
    expect(prismaMock.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ voidReason: "Duplicate entry" }),
      }),
    );
  });
});
