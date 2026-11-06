import { describe, expect, it } from "vitest";

import {
  approvedNotPaid,
  askLabel,
  invoiceLate,
  isHot,
  lateReason,
  moveMoneyPlan,
  needsReceipt,
  receiptReason,
  reminderMailto,
  unpaidReason,
} from "./finance";

const NOW = new Date("2026-11-04T15:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

const expense = {
  kind: "EXPENSE",
  direction: "OUT",
  status: "REIMBURSED",
  voidedAt: null,
  reconciledAt: null,
  occurredAt: daysAgo(3),
  approvedAt: daysAgo(2),
  submittedById: "alex",
  receipts: 0,
};

describe("Ask for receipt", () => {
  it("shows on someone else's paid expense with no receipt", () => {
    expect(needsReceipt(expense, "me", NOW)).toBe(true);
    expect(needsReceipt({ ...expense, receipts: 1 }, "me", NOW)).toBe(false);
    expect(needsReceipt(expense, "alex", NOW)).toBe(false);
    // Asked lately: it waits three days before offering to ask again.
    const asked = (days: number) => new Date(NOW.getTime() - days * 86_400_000);
    expect(needsReceipt({ ...expense, receiptAskedAt: asked(1) }, "me", NOW)).toBe(false);
    expect(needsReceipt({ ...expense, receiptAskedAt: asked(4) }, "me", NOW)).toBe(true);
    expect(needsReceipt({ ...expense, status: "DRAFT" }, "me", NOW)).toBe(false);
    expect(needsReceipt({ ...expense, occurredAt: NOW }, "me", NOW)).toBe(false);
    expect(needsReceipt({ ...expense, direction: "IN" }, "me", NOW)).toBe(false);
  });

  it("says why and asks by name", () => {
    expect(receiptReason(expense, NOW)).toBe("Paid 3 days ago, no receipt");
    expect(askLabel("Alex Green")).toBe("Ask Alex for it");
    expect(askLabel(null)).toBe("Ask for receipt");
  });
});

describe("Mark paid", () => {
  it("is for approved requests from someone else", () => {
    const approved = { ...expense, status: "APPROVED" };
    expect(approvedNotPaid(approved, "me")).toBe(true);
    expect(approvedNotPaid(approved, "alex")).toBe(false);
    expect(approvedNotPaid({ ...approved, reconciledAt: NOW }, "me")).toBe(false);
    expect(approvedNotPaid(expense, "me")).toBe(false);
    expect(unpaidReason(approved, NOW)).toBe("Approved 2 days ago, not paid");
  });
});

describe("Move money", () => {
  const food = { id: "f", name: "Food", allocatedCents: 50_000, spentCents: 47_000 };
  const travel = { id: "t", name: "Travel", allocatedCents: 100_000, spentCents: 20_000 };
  const swag = { id: "s", name: "Swag", allocatedCents: 30_000, spentCents: 25_000 };

  it("is for a line past 90%", () => {
    expect(isHot(food)).toBe(true);
    expect(isHot(travel)).toBe(false);
    expect(isHot({ ...food, allocatedCents: 0 })).toBe(false);
  });

  it("moves enough from the line with the most left", () => {
    const plan = moveMoneyPlan(food, [food, travel, swag]);
    // 470 / 0.8 = 587.50, so $87.50 more, rounded up to $90.
    expect(plan).toMatchObject({ fromId: "t", cents: 9_000, label: "Move $90 from Travel" });
    expect(plan?.reason).toBe("94% spent, Travel has $800 left");
  });

  it("never takes more than half of what the giver has left", () => {
    const tight = { ...travel, allocatedCents: 30_000, spentCents: 20_000 };
    expect(moveMoneyPlan(food, [food, { ...tight, spentCents: 0 }])?.cents).toBe(9_000);
    expect(
      moveMoneyPlan(food, [food, { ...tight, allocatedCents: 1_000, spentCents: 0 }]),
    ).toBeNull();
    expect(moveMoneyPlan(food, [food, swag])).toBeNull();
  });
});

describe("Sponsor reminders", () => {
  it("is for an invoice past its date", () => {
    expect(invoiceLate({ status: "INVOICED", expectedOn: daysAgo(13) }, NOW)).toBe(13);
    expect(invoiceLate({ status: "COMMITTED", expectedOn: daysAgo(13) }, NOW)).toBeNull();
    expect(invoiceLate({ status: "INVOICED", expectedOn: null }, NOW)).toBeNull();
    expect(invoiceLate({ status: "INVOICED", expectedOn: daysAgo(-2) }, NOW)).toBeNull();
  });

  it("writes the reminder", () => {
    expect(lateReason("2026-10-22T00:00:00Z", 13)).toBe("Due Oct 22, 13 days late");
    const href = reminderMailto({
      to: "pat@acme.example",
      contactName: "Pat Lee",
      orgName: "Robotics",
      amountCents: 50_000,
      expectedOn: "2026-10-22T00:00:00Z",
    });
    expect(href.startsWith("mailto:pat@acme.example?subject=Robotics%20sponsorship")).toBe(true);
    expect(decodeURIComponent(href)).toContain("Hi Pat,");
    expect(decodeURIComponent(href)).toContain("$500, which was due October 22");
  });
});
