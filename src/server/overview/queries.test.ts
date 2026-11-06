// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/db/context", () => ({ withSystemOrgTx: vi.fn() }));
vi.mock("@/server/reports/visibility", () => ({ queryDatabaseVisibility: vi.fn() }));
vi.mock("@/server/links/links", async (actual) => ({
  // The real reader of link rows; every far end resolves for this viewer,
  // named after its id (the sync is a meeting, t2 is done).
  ...(await actual<typeof import("@/server/links/links")>()),
  resolveRefs: vi.fn(
    async (_db: unknown, _org: string, slug: string, refs: { kind: string; id: string }[]) =>
      new Map(
        refs.map((r) => [
          `${r.kind}:${r.id}`,
          {
            ...r,
            title: r.id,
            href: `/app/${slug}/${r.kind}/${r.id}`,
            detail: r.kind,
            chip: r.kind === "event" ? "meeting" : r.kind,
            done: r.id === "t2",
          },
        ]),
      ),
  ),
}));

const { loadLinkedChips, refOfHref } = await import("./queries");

describe("Home's links", () => {
  it("chips what a task is linked to either way round, never money, meetings as meetings", async () => {
    const db = {
      itemLink: {
        findMany: vi.fn(async () => [
          { id: "l1", fromKind: "task", fromId: "t1", toKind: "event", toId: "e_sync" },
          { id: "l2", fromKind: "transaction", fromId: "tx1", toKind: "task", toId: "t1" },
          { id: "l3", fromKind: "budget", fromId: "b1", toKind: "task", toId: "t1" },
          { id: "l4", fromKind: "note", fromId: "n1", toKind: "task", toId: "t1" },
          { id: "l5", fromKind: "task", fromId: "t1", toKind: "task", toId: "t2" },
          // A kind the app doesn't know never becomes a chip.
          { id: "l6", fromKind: "widget", fromId: "w1", toKind: "task", toId: "t1" },
        ]),
      },
    };
    const chips = await loadLinkedChips(
      db as never,
      "org",
      "cbc",
      [{ kind: "task", id: "t1" }],
      "UTC",
    );
    expect(chips.get("task:t1")?.map((c) => [c.kind, c.label, c.done ?? null])).toEqual([
      ["meeting", "e_sync", null],
      ["note", "n1", null],
      ["task", "t2", true],
    ]);
  });

  it("knows which thing a page is, calendar events included", () => {
    expect(refOfHref("/app/cbc/calendar/e_1")).toEqual({ kind: "event", id: "e_1" });
    expect(refOfHref("/app/cbc/forms/f_1?tab=responses")).toEqual({ kind: "form", id: "f_1" });
    expect(refOfHref("/app/cbc/calendar/polls")).toBeNull();
    expect(refOfHref("/app/cbc/tasks")).toBeNull();
  });
});
