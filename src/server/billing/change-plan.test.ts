import { beforeEach, describe, expect, it, vi } from "vitest";

const auditMock = vi.hoisted(() => vi.fn());
vi.mock("@/server/audit", () => ({ writeOrgAuditLog: auditMock }));

import { changeOrgPlan, type ChangePlanDb } from "./change-plan";

const NOW = new Date("2026-10-28T12:00:00Z");
const DAY = 86_400_000;

function fakeDb(org: Record<string, unknown>) {
  const update = vi.fn();
  const db = {
    organization: { findUniqueOrThrow: vi.fn(async () => org), update },
    $queryRaw: vi.fn(),
  } as unknown as ChangePlanDb;
  return { db, update };
}

describe("changeOrgPlan", () => {
  beforeEach(() => auditMock.mockReset());

  it("never cuts a running trial short: the pick waits for its end", async () => {
    const { db, update } = fakeDb({
      kind: "CLUB",
      plan: "TRIAL",
      trialEndsAt: new Date(NOW.getTime() + 5 * DAY),
      planAfterTrial: null,
    });
    const result = await changeOrgPlan(db, "org_1", "CLUB", "owner", NOW);
    expect(result).toEqual({ from: "TRIAL", to: "CLUB", changed: true, scheduled: true });
    expect(update).toHaveBeenCalledWith({
      where: { id: "org_1" },
      data: { planAfterTrial: "CLUB" },
    });
  });

  it("moves the plan at once after the trial has ended", async () => {
    const { db, update } = fakeDb({
      kind: "CLUB",
      plan: "TRIAL",
      trialEndsAt: new Date(NOW.getTime() - DAY),
      planAfterTrial: null,
    });
    const result = await changeOrgPlan(db, "org_1", "SOCIETY", "owner", NOW);
    expect(result.scheduled).toBe(false);
    expect(update).toHaveBeenCalledWith({ where: { id: "org_1" }, data: { plan: "SOCIETY" } });
  });
});
