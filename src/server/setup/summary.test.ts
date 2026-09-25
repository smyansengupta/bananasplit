// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The numbers the result screen leads with, and the "is a sync running"
 * question behind its spinner.
 */

vi.mock("@/server/databases/views", () => ({ listDatabases: vi.fn() }));
vi.mock("@/server/sync/status", () => ({ loadSyncStatus: vi.fn(async () => null) }));

import { listDatabases } from "@/server/databases/views";

import {
  countsSentence,
  loadDatabaseLinks,
  syncPending,
  totalRows,
  type DataCounts,
} from "./summary";

const counts = (over: Partial<DataCounts> = {}): DataCounts => ({
  checkIns: 0,
  signups: 0,
  sessions: 0,
  people: 0,
  ballots: 0,
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe("countsSentence", () => {
  it("reads like a sentence, with an Oxford-free list and correct plurals", () => {
    expect(countsSentence(counts({ checkIns: 1204, signups: 312, sessions: 14 }))).toBe(
      "1,204 check-ins, 312 signups and 14 sessions",
    );
    expect(countsSentence(counts({ checkIns: 1 }))).toBe("1 check-in");
    expect(countsSentence(counts({ checkIns: 2, sessions: 1 }))).toBe("2 check-ins and 1 session");
  });

  it("leaves out what is zero, and says so plainly when everything is", () => {
    expect(countsSentence(counts({ signups: 5 }))).toBe("5 signups");
    expect(countsSentence(counts())).toBe("Nothing yet");
  });

  it("people are counted but not listed: they are derived, not pulled", () => {
    expect(countsSentence(counts({ people: 90 }))).toBe("Nothing yet");
    expect(totalRows(counts({ people: 90 }))).toBe(90);
  });
});

describe("syncPending", () => {
  function db(count: number) {
    const job = { count: vi.fn(async () => count) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { job } as any;
  }

  it("asks only about jobs that are due now", async () => {
    const now = new Date("2026-09-24T18:00:00Z");
    const client = db(0);
    await syncPending(client, "org_A", now);
    expect(client.job.count).toHaveBeenCalledWith({
      where: {
        organizationId: "org_A",
        kind: "source-sync",
        status: { in: ["PENDING", "RUNNING"] },
        runAt: { lte: now },
      },
    });
  });

  /**
   * Regression: every run schedules the next hour's backstop before it
   * finishes, so a PENDING source-sync with a future runAt is the normal
   * resting state. Counting those left the result screen saying "pulling
   * your data in" forever.
   */
  it("a future-dated backstop is not a sync in progress", async () => {
    expect(await syncPending(db(0), "org_A")).toBe(false);
    expect(await syncPending(db(1), "org_A")).toBe(true);
  });
});

describe("loadDatabaseLinks", () => {
  it("uses the org's own database keys, so a renamed database still links", async () => {
    vi.mocked(listDatabases).mockResolvedValue([
      { kind: "ATTENDANCE", key: "check-ins" },
      { kind: "SESSIONS", key: "sessions" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const links = await loadDatabaseLinks({} as any, "org_A", "ADMIN", "neu-chess");
    expect(links.attendance).toBe("/app/neu-chess/databases/check-ins");
    expect(links.sessions).toBe("/app/neu-chess/databases/sessions");
  });

  it("is null for a database this viewer may not open, so no link goes nowhere", async () => {
    // listDatabases already applies the viewer's visibility; Signups is
    // owners-and-admins by default and simply is not in a member's list.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(listDatabases).mockResolvedValue([{ kind: "SESSIONS", key: "sessions" }] as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const links = await loadDatabaseLinks({} as any, "org_A", "MEMBER", "neu-chess");
    expect(links.signups).toBeNull();
    expect(links.attendance).toBeNull();
    expect(links.sessions).toBe("/app/neu-chess/databases/sessions");
  });
});
