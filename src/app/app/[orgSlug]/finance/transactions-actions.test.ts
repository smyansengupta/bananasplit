import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Transaction actions against a fake withOrgAction that hands the handler a
 * mocked transaction client and the caller's role, like the real wrapper
 * after set_context. The database side (policies 6.10, transaction_guard,
 * app.write_finance_audit) is covered by finance.db.test.ts and the RLS
 * suites.
 */

const { state, db, enqueueJobMock } = vi.hoisted(() => ({
  state: { userId: "member_1", role: "MEMBER" as string },
  enqueueJobMock: vi.fn(),
  db: {
    budgetPeriod: { findFirst: vi.fn() },
    budgetCategory: { findFirst: vi.fn() },
    event: { findFirst: vi.fn() },
    task: { findFirst: vi.fn() },
    transaction: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));

vi.mock("@/server/db/context", () => ({
  withOrgAction:
    (handler: (ctx: unknown, ...args: unknown[]) => Promise<unknown>) =>
    async (organizationId: string, ...args: unknown[]) =>
      handler(
        {
          kind: "action",
          db: db,
          user: { id: state.userId, email: `${state.userId}@example.edu`, name: null },
          userId: state.userId,
          organizationId,
          role: state.role,
          afterCommit: () => undefined,
        },
        ...args,
      ),
}));
vi.mock("@/server/jobs/enqueue", () => ({ enqueueJob: enqueueJobMock }));

const { Role } = await import("@/generated/prisma/enums");
const { ForbiddenError } = await import("@/lib/auth/errors");
const {
  approveExpense,
  createTransaction,
  reimburseExpense,
  submitExpense,
  updateTransaction,
  voidTransaction,
} = await import("./transactions-actions");

function actAs(userId: string, role: string) {
  state.userId = userId;
  state.role = role;
}

beforeEach(() => {
  vi.clearAllMocks();
  actAs("member_1", Role.MEMBER);
  db.$queryRaw.mockResolvedValue([{ id: "audit_1" }]);
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
    state.role = Role.MEMBER;
    db.budgetPeriod.findFirst.mockResolvedValue({ id: "period_1" });
    db.transaction.create.mockResolvedValue({ id: "txn_1" });
  });

  it("rejects a zero amount", async () => {
    const result = await createTransaction("org_1", { ...validExpenseInput, amountCents: 0 });
    expect(result.error).toBeTruthy();
    expect(db.transaction.create).not.toHaveBeenCalled();
  });

  it("rejects a negative amount", async () => {
    const result = await createTransaction("org_1", { ...validExpenseInput, amountCents: -500 });
    expect(result.error).toBeTruthy();
    expect(db.transaction.create).not.toHaveBeenCalled();
  });

  it("allows any member to submit an EXPENSE", async () => {
    const result = await createTransaction("org_1", validExpenseInput);
    expect(result.error).toBeUndefined();
    expect(db.transaction.create).toHaveBeenCalledOnce();
  });

  it("rejects a non-expense transaction from a plain member", async () => {
    const result = await createTransaction("org_1", {
      ...validExpenseInput,
      direction: "IN",
      kind: "OTHER_INCOME",
    });
    expect(result.error).toMatch(/treasurer or owner/i);
    expect(db.transaction.create).not.toHaveBeenCalled();
  });

  it("returns not-found for a budget period belonging to another org", async () => {
    db.budgetPeriod.findFirst.mockResolvedValue(null);
    const result = await createTransaction("org_1", validExpenseInput);
    expect(result.error).toMatch(/not found/i);
  });
});

describe("voidTransaction — spec 5.3", () => {
  it("requires a reason", async () => {
    state.role = Role.TREASURER;
    const result = await voidTransaction("org_1", "txn_1", "");
    expect(result.error).toMatch(/reason/i);
    expect(db.transaction.update).not.toHaveBeenCalled();
  });

  it("returns not-found for a transaction in another org", async () => {
    state.role = Role.TREASURER;
    db.transaction.findFirst.mockResolvedValue(null);
    const result = await voidTransaction("org_1", "txn_from_other_org", "duplicate entry");
    expect(result.error).toMatch(/not found/i);
  });

  it("blocks a reconciled transaction from being voided until unlocked", async () => {
    state.role = Role.TREASURER;
    db.transaction.findFirst.mockResolvedValue({
      id: "txn_1",
      reconciledAt: new Date(),
      voidedAt: null,
    });
    const result = await voidTransaction("org_1", "txn_1", "duplicate entry");
    expect(result.error).toMatch(/reconciled/i);
    expect(db.transaction.update).not.toHaveBeenCalled();
  });

  it("marks the transaction voided with the given reason, never deleting it", async () => {
    state.role = Role.TREASURER;
    db.transaction.findFirst.mockResolvedValue({
      id: "txn_1",
      reconciledAt: null,
      voidedAt: null,
    });
    db.transaction.update.mockResolvedValue({ id: "txn_1", voidedAt: new Date() });

    const result = await voidTransaction("org_1", "txn_1", "Duplicate entry");

    expect(result.error).toBeUndefined();
    expect(db.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ voidReason: "Duplicate entry" }),
      }),
    );
  });
});

/**
 * Scoped lookups: each mock returns a row only when the query carries this
 * org's id, like the real database would for a foreign id. A lookup without
 * organizationId fails the test outright.
 */
function orgScopedFindFirst(ownIds: Set<string>) {
  return async ({ where }: { where: { id: string; organizationId?: string } }) => {
    if (!where.organizationId) {
      throw new Error("cross-org lookup: query is missing an organizationId filter");
    }
    return where.organizationId === "org_1" && ownIds.has(where.id) ? { id: where.id } : null;
  };
}

describe("transaction links and categories stay inside the org (0A Fix 2)", () => {
  beforeEach(() => {
    db.budgetPeriod.findFirst.mockResolvedValue({ id: "period_1" });
    db.transaction.create.mockResolvedValue({ id: "txn_new" });
    db.event.findFirst.mockImplementation(orgScopedFindFirst(new Set(["event_1"])));
    db.task.findFirst.mockImplementation(orgScopedFindFirst(new Set(["task_1"])));
    db.budgetCategory.findFirst.mockImplementation(
      async ({ where }: { where: { id: string; organizationId?: string; budgetPeriodId: string } }) => {
        if (!where.organizationId) throw new Error("category lookup is missing organizationId");
        return where.id === "cat_1" && where.budgetPeriodId === "period_1" ? { id: "cat_1" } : null;
      },
    );
  });

  describe("createTransaction", () => {
    beforeEach(() => {
      state.role = Role.MEMBER;
    });

    it("rejects an eventId from another org", async () => {
      const result = await createTransaction("org_1", { ...validExpenseInput, eventId: "event_x" });
      expect(result.error).toMatch(/event doesn't exist/i);
      expect(db.transaction.create).not.toHaveBeenCalled();
    });

    it("rejects a taskId from another org", async () => {
      const result = await createTransaction("org_1", { ...validExpenseInput, taskId: "task_x" });
      expect(result.error).toMatch(/task doesn't exist/i);
      expect(db.transaction.create).not.toHaveBeenCalled();
    });

    it("accepts this org's event and task", async () => {
      const result = await createTransaction("org_1", {
        ...validExpenseInput,
        eventId: "event_1",
        taskId: "task_1",
        categoryId: "cat_1",
      });
      expect(result.error).toBeUndefined();
      expect(db.transaction.create).toHaveBeenCalledOnce();
    });
  });

  describe("updateTransaction", () => {
    const ownDraft = {
      id: "txn_1",
      organizationId: "org_1",
      budgetPeriodId: "period_1",
      submittedById: "treasurer_1",
      status: "NOT_APPLICABLE",
      reconciledAt: null,
    };

    beforeEach(() => {
      actAs("treasurer_1", Role.TREASURER);
      db.transaction.findFirst.mockResolvedValue(ownDraft);
      db.transaction.update.mockResolvedValue(ownDraft);
    });

    it("ignores a client budgetPeriodId: a foreign period cannot vouch for a foreign category", async () => {
      // The exploit: a foreign period plus a category of that foreign period.
      // The category must be checked against the row's own period instead.
      const result = await updateTransaction("org_1", "txn_1", {
        budgetPeriodId: "foreign_period",
        categoryId: "foreign_cat",
      });

      expect(result.error).toMatch(/category doesn't belong/i);
      expect(db.budgetCategory.findFirst).toHaveBeenCalledWith({
        where: { id: "foreign_cat", budgetPeriodId: "period_1", organizationId: "org_1" },
        select: { id: true },
      });
      expect(db.transaction.update).not.toHaveBeenCalled();
    });

    it("never writes budgetPeriodId", async () => {
      const result = await updateTransaction("org_1", "txn_1", {
        budgetPeriodId: "other_period",
        description: "Renamed",
      });
      expect(result.error).toBeUndefined();
      const call = db.transaction.update.mock.calls[0]?.[0] as {
        data: Record<string, unknown>;
      };
      expect(call.data).not.toHaveProperty("budgetPeriodId");
    });

    it("rejects an eventId from another org", async () => {
      const result = await updateTransaction("org_1", "txn_1", { eventId: "event_x" });
      expect(result.error).toMatch(/event doesn't exist/i);
      expect(db.transaction.update).not.toHaveBeenCalled();
    });

    it("rejects a taskId from another org", async () => {
      const result = await updateTransaction("org_1", "txn_1", { taskId: "task_x" });
      expect(result.error).toMatch(/task doesn't exist/i);
      expect(db.transaction.update).not.toHaveBeenCalled();
    });

    it("accepts this org's category, event and task", async () => {
      const result = await updateTransaction("org_1", "txn_1", {
        categoryId: "cat_1",
        eventId: "event_1",
        taskId: "task_1",
      });
      expect(result.error).toBeUndefined();
      expect(db.transaction.update).toHaveBeenCalledOnce();
    });
  });
});

describe("finance-only actions and the expense workflow (0C wrappers)", () => {
  const submitted = {
    id: "txn_1",
    organizationId: "org_1",
    kind: "EXPENSE",
    status: "SUBMITTED",
    submittedById: "member_1",
    reconciledAt: null,
    voidedAt: null,
  };

  it("voidTransaction throws ForbiddenError for a MEMBER before touching the row", async () => {
    await expect(voidTransaction("org_1", "txn_1", "duplicate")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(db.transaction.findFirst).not.toHaveBeenCalled();
  });

  it("writes the audit row through app.write_finance_audit in the same client", async () => {
    actAs("treasurer_1", Role.TREASURER);
    db.transaction.findFirst.mockResolvedValue({ ...submitted, reconciledAt: null });
    db.transaction.update.mockResolvedValue({ ...submitted, voidedAt: new Date() });

    await voidTransaction("org_1", "txn_1", "Duplicate entry");

    const [strings, ...values] = db.$queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    expect(strings.join("?")).toMatch(/app\.write_finance_audit/);
    expect(values.slice(0, 4)).toEqual(["org_1", "VOID", "txn_1", null]);
  });

  it("a TREASURER approves another member's expense and the email goes to the outbox", async () => {
    actAs("treasurer_1", Role.TREASURER);
    db.transaction.findFirst.mockResolvedValue(submitted);
    db.transaction.update.mockResolvedValue({ ...submitted, status: "APPROVED" });

    const result = await approveExpense("org_1", "txn_1");

    expect(result).toEqual({ transactionId: "txn_1" });
    expect(db.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "APPROVED", approvedById: "treasurer_1" }),
      }),
    );
    expect(enqueueJobMock).toHaveBeenCalledWith(db, {
      orgId: "org_1",
      kind: "reimbursement-email",
      key: "txn_1:APPROVED",
      payload: { transactionId: "txn_1", status: "APPROVED" },
    });
  });

  it("nobody approves or reimburses their own expense (separation of duties)", async () => {
    actAs("member_1", Role.TREASURER);
    db.transaction.findFirst.mockResolvedValue(submitted);
    expect((await approveExpense("org_1", "txn_1")).error).toMatch(/your own expense/);

    db.transaction.findFirst.mockResolvedValue({ ...submitted, status: "APPROVED" });
    expect((await reimburseExpense("org_1", "txn_1", "Venmo")).error).toMatch(/your own expense/);

    expect(db.transaction.update).not.toHaveBeenCalled();
    expect(enqueueJobMock).not.toHaveBeenCalled();
  });

  it("a MEMBER cannot approve, but can submit their own draft (no email)", async () => {
    db.transaction.findFirst.mockResolvedValue({ ...submitted, submittedById: "someone_else" });
    expect((await approveExpense("org_1", "txn_1")).error).toMatch(/treasurer or owner/);

    db.transaction.findFirst.mockResolvedValue({ ...submitted, status: "DRAFT" });
    db.transaction.update.mockResolvedValue({ ...submitted, status: "SUBMITTED" });
    expect(await submitExpense("org_1", "txn_1")).toEqual({ transactionId: "txn_1" });
    expect(enqueueJobMock).not.toHaveBeenCalled();
  });
});
