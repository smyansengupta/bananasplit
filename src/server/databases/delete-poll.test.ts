import { describe, expect, it, vi } from "vitest";

import { NotFoundError } from "@/lib/auth/errors";
import type { TxClient } from "@/server/db/context";

vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));

const { DatabaseEditError, deletePoll } = await import("./admin");

/**
 * deletePoll on a fake service transaction: the poll's ballots go (linked by
 * id or only by slug, website ones too) before the definition, all within
 * the organization, audited and marked as a data change.
 */

function fakeDb(def: { id: string; slug: string; title: string } | null, deleted = 1) {
  return {
    ballotDefinition: {
      findFirst: vi.fn(async () => def),
      deleteMany: vi.fn(async () => ({ count: deleted })),
    },
    ballot: { deleteMany: vi.fn(async () => ({ count: 7 })) },
    $queryRaw: vi.fn(async (..._args: unknown[]) => [{ id: "audit" }]),
    $executeRaw: vi.fn(async () => 1),
  };
}

const poll = { id: "bd_1", slug: "hackathon-theme", title: "Hackathon theme and tracks" };

describe("deletePoll", () => {
  it("deletes the poll's ballots and then the poll, within the organization", async () => {
    const db = fakeDb(poll);
    const out = await deletePoll(db as unknown as TxClient, "org_1", "bd_1");
    expect(out).toEqual({ title: poll.title, ballots: 7 });
    expect(db.ballotDefinition.findFirst).toHaveBeenCalledWith({
      where: { id: "bd_1", organizationId: "org_1" },
      select: { id: true, slug: true, title: true },
    });
    expect(db.ballot.deleteMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org_1",
        OR: [{ ballotDefinitionId: "bd_1" }, { pollSlug: "hackathon-theme" }],
      },
    });
    expect(db.ballotDefinition.deleteMany).toHaveBeenCalledWith({
      where: { id: "bd_1", organizationId: "org_1" },
    });
    expect(db.ballot.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(
      db.ballotDefinition.deleteMany.mock.invocationCallOrder[0],
    );
    const audit = db.$queryRaw.mock.calls[0];
    expect(audit[2]).toBe("ballot_definition.deleted");
    expect(db.$executeRaw).toHaveBeenCalled(); // reports data version bumped
  });

  it("treats another organization's poll, or a gone one, as missing", async () => {
    const db = fakeDb(null);
    await expect(deletePoll(db as unknown as TxClient, "org_1", "bd_x")).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(db.ballot.deleteMany).not.toHaveBeenCalled();
  });

  it("says so when the poll could not be deleted", async () => {
    const db = fakeDb(poll, 0);
    await expect(deletePoll(db as unknown as TxClient, "org_1", "bd_1")).rejects.toBeInstanceOf(
      DatabaseEditError,
    );
  });
});
