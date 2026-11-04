import { describe, expect, it, vi } from "vitest";

import type { OrgContext } from "@/server/db/context";

vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));

const { DatabaseEditError, closePoll } = await import("./admin");

/**
 * closePoll on a fake transaction: it closes an open poll now, and refuses
 * one that's already closed (which would move its closing time later) or
 * hasn't opened yet (it would close before it opens).
 */

const NOW = new Date("2026-11-02T18:00:00Z");
const hours = (h: number) => new Date(NOW.getTime() + h * 3_600_000);

function ctxWith(def: { opensAt: Date | null; closesAt: Date | null }) {
  const db = {
    databaseDefinition: { findFirst: vi.fn(async () => ({ allowEdits: true })) },
    ballotDefinition: {
      findFirst: vi.fn(async (args: { select: Record<string, boolean> }) =>
        args.select.slug ? { id: "bd_1", slug: "theme" } : def,
      ),
      update: vi.fn(async () => ({})),
    },
    $queryRaw: vi.fn(async (..._args: unknown[]) => [{ id: "audit" }]),
    $executeRaw: vi.fn(async () => 1),
  };
  const ctx = {
    db,
    organizationId: "org_1",
    userId: "u_1",
    role: "ADMIN",
  } as unknown as OrgContext;
  return { ctx, db };
}

describe("closePoll", () => {
  it("closes an open poll now", async () => {
    vi.useFakeTimers({ now: NOW });
    const { ctx, db } = ctxWith({ opensAt: hours(-24), closesAt: hours(24) });
    await closePoll(ctx, "bd_1");
    expect(db.ballotDefinition.update).toHaveBeenCalledWith({
      where: { id: "bd_1" },
      data: { closesAt: NOW },
    });
    vi.useRealTimers();
  });

  it("refuses one that's already closed, so its closing time never moves later", async () => {
    const { ctx, db } = ctxWith({ opensAt: null, closesAt: hours(-2) });
    await expect(closePoll(ctx, "bd_1")).rejects.toThrow("This poll is already closed.");
    expect(db.ballotDefinition.update).not.toHaveBeenCalled();
  });

  it("refuses one that hasn't opened yet", async () => {
    const { ctx, db } = ctxWith({ opensAt: hours(48), closesAt: null });
    await expect(closePoll(ctx, "bd_1")).rejects.toBeInstanceOf(DatabaseEditError);
    expect(db.ballotDefinition.update).not.toHaveBeenCalled();
  });
});
