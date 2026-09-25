// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Setup progress is DERIVED, not stored: these pin the derivation, because
 * every claim the flow makes ("connected", "1 of 4", "needs attention")
 * rests on it. The two stored choices — skipped steps and "done for now" —
 * are asserted on what they write.
 */

vi.mock("@/server/audit", () => ({ writeOrgAuditLog: vi.fn(async () => undefined) }));

import { writeOrgAuditLog } from "@/server/audit";

import {
  clearSkipForProvider,
  loadSetupState,
  needsAttention,
  setSetupCompleted,
  skipStep,
  unskipStep,
} from "./progress";

type Row = {
  provider: string;
  status: string;
  secretFingerprint: string | null;
  secretLast4?: string | null;
  lastVerifiedAt?: Date | null;
  lastError?: string | null;
  config?: unknown;
  connectedBy?: { name: string | null } | null;
};

function makeDb(
  rows: Row[],
  settings: { setupSkipped?: string[]; setupCompletedAt?: Date | null } | null,
) {
  type UpdateArgs = {
    data: { setupSkipped?: string[]; setupCompletedAt?: Date | null; updatedById?: string };
  };
  const update = vi.fn(async (_args: UpdateArgs) => undefined);
  const db = {
    orgIntegration: { findMany: vi.fn(async () => rows) },
    orgSettings: {
      findUnique: vi.fn(async () =>
        settings === null
          ? null
          : {
              setupSkipped: settings.setupSkipped ?? [],
              setupCompletedAt: settings.setupCompletedAt ?? null,
            },
      ),
      update,
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { db: db as any, update };
}

const connectedSupabase: Row = {
  provider: "SUPABASE_SOURCE",
  status: "CONNECTED",
  secretFingerprint: "fp",
  secretLast4: "3f2a",
  lastVerifiedAt: new Date("2026-09-24T18:00:00Z"),
  config: { projectRef: "abcdefghijklmnopqrst", roleName: "cbc_suite_reader" },
  connectedBy: { name: "Jackson" },
};

beforeEach(() => vi.clearAllMocks());

describe("loadSetupState", () => {
  it("an org that has done nothing has four steps to do and is prompted", async () => {
    const { db } = makeDb([], null);
    const state = await loadSetupState(db, "org_A");
    expect(state.steps.map((s) => s.status)).toEqual(["todo", "todo", "todo", "todo"]);
    expect(state.connectedCount).toBe(0);
    expect(state.totalCount).toBe(4);
    expect(state.nextStep).toBe("data");
    expect(state.allDecided).toBe(false);
    expect(state.promptVisible).toBe(true);
  });

  it("counts only what actually works, and carries the recognition fields", async () => {
    const { db } = makeDb([connectedSupabase], { setupSkipped: [] });
    const state = await loadSetupState(db, "org_A");
    const data = state.steps.find((s) => s.step.id === "data")!;
    expect(data.status).toBe("connected");
    expect(data.last4).toBe("3f2a");
    expect(data.connectedByName).toBe("Jackson");
    expect(state.connectedCount).toBe(1);
    expect(state.nextStep).toBe("calendar");
  });

  it("a stored credential whose last test failed is broken, and jumps the queue", async () => {
    const { db } = makeDb(
      [
        connectedSupabase,
        {
          provider: "CLAUDE",
          status: "ERROR",
          secretFingerprint: "fp",
          lastError: "Claude rejected this API key.",
        },
      ],
      { setupSkipped: [] },
    );
    const state = await loadSetupState(db, "org_A");
    expect(state.attention).toEqual(["claude"]);
    // Broken before untouched: a club whose key died should be sent there
    // first, not to the next new thing.
    expect(state.nextStep).toBe("claude");
    expect(state.connectedCount).toBe(1);
    expect(needsAttention("error")).toBe(true);
  });

  it("Google's expired grant reads as needing reconnecting, not as an error to retype", async () => {
    const { db } = makeDb(
      [{ provider: "GOOGLE_CALENDAR", status: "NEEDS_REAUTH", secretFingerprint: "fp" }],
      { setupSkipped: [] },
    );
    const state = await loadSetupState(db, "org_A");
    expect(state.steps.find((s) => s.step.id === "calendar")!.status).toBe("needs_reauth");
    expect(state.attention).toEqual(["calendar"]);
  });

  it("a skipped step is decided: out of the queue, never counted as connected", async () => {
    const { db } = makeDb([], { setupSkipped: ["calendar", "email", "claude"] });
    const state = await loadSetupState(db, "org_A");
    expect(state.skipped).toEqual(["calendar", "email", "claude"]);
    expect(state.todo).toEqual(["data"]);
    expect(state.connectedCount).toBe(0);
  });

  it("connecting beats a stale skip: a working service is never shown as skipped", async () => {
    const { db } = makeDb([connectedSupabase], { setupSkipped: ["data"] });
    const state = await loadSetupState(db, "org_A");
    expect(state.steps.find((s) => s.step.id === "data")!.status).toBe("connected");
    expect(state.skipped).not.toContain("data");
  });

  it("a row with no stored secret is not set up, whatever its status column says", async () => {
    const { db } = makeDb(
      [{ provider: "CLAUDE", status: "CONNECTED", secretFingerprint: null, secretLast4: "abcd" }],
      { setupSkipped: [] },
    );
    const state = await loadSetupState(db, "org_A");
    expect(state.steps.find((s) => s.step.id === "claude")!.status).toBe("todo");
    expect(state.connectedCount).toBe(0);
  });

  it("only whitelisted config reaches a page: a secret smuggled into config never does", async () => {
    const { db } = makeDb(
      [
        {
          ...connectedSupabase,
          config: { projectRef: "abcdefghijklmnopqrst", password: "hunter2", apiKey: "sk-ant-x" },
        },
      ],
      { setupSkipped: [] },
    );
    const state = await loadSetupState(db, "org_A");
    const config = state.steps.find((s) => s.step.id === "data")!.config;
    expect(config).toEqual({ projectRef: "abcdefghijklmnopqrst" });
    expect(JSON.stringify(state)).not.toMatch(/hunter2|sk-ant-x/);
  });

  it("everything decided ends the flow; finishing hides the prompt without changing anything", async () => {
    const { db } = makeDb([connectedSupabase], { setupSkipped: ["calendar", "email", "claude"] });
    const state = await loadSetupState(db, "org_A");
    expect(state.allDecided).toBe(true);
    expect(state.nextStep).toBeNull();
    expect(state.promptVisible).toBe(false);

    const done = makeDb([connectedSupabase], {
      setupSkipped: [],
      setupCompletedAt: new Date("2026-09-24T00:00:00Z"),
    });
    const after = await loadSetupState(done.db, "org_A");
    expect(after.promptVisible).toBe(false);
    // Hidden, not finished: three steps are still worth doing.
    expect(after.todo).toEqual(["calendar", "email", "claude"]);
  });

  it("a broken connection brings the prompt back even after Done for now", async () => {
    const { db } = makeDb(
      [
        {
          provider: "SUPABASE_SOURCE",
          status: "ERROR",
          secretFingerprint: "fp",
          lastError: "nope",
        },
      ],
      { setupSkipped: ["calendar", "email", "claude"], setupCompletedAt: new Date() },
    );
    const state = await loadSetupState(db, "org_A");
    // promptVisible stays false, but the attention list is what the prompt
    // component keys on for the "stopped working" variant.
    expect(state.attention).toEqual(["data"]);
  });
});

describe("the stored choices", () => {
  it("skipping adds the step once and writes an audit row", async () => {
    const { db, update } = makeDb([], { setupSkipped: ["email"] });
    await skipStep(db, "org_A", "u1", "email");
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ setupSkipped: ["email"] }) }),
    );
    expect(writeOrgAuditLog).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ action: "setup.step_skipped", diff: { step: "email" } }),
    );
  });

  it("skipping drops anything that is not a step id", async () => {
    const { db, update } = makeDb([], { setupSkipped: ["email", "not-a-step"] });
    await skipStep(db, "org_A", "u1", "claude");
    expect(update.mock.calls[0][0].data.setupSkipped).toEqual(["email", "claude"]);
  });

  it("un-skipping and connecting both clear the flag, and neither writes when there is nothing to clear", async () => {
    const a = makeDb([], { setupSkipped: ["calendar"] });
    await unskipStep(a.db, "org_A", "u1", "calendar");
    expect(a.update.mock.calls[0][0].data.setupSkipped).toEqual([]);

    const b = makeDb([], { setupSkipped: ["calendar"] });
    await clearSkipForProvider(b.db, "org_A", "GOOGLE_CALENDAR");
    expect(b.update.mock.calls[0][0].data.setupSkipped).toEqual([]);

    const c = makeDb([], { setupSkipped: [] });
    await unskipStep(c.db, "org_A", "u1", "calendar");
    await clearSkipForProvider(c.db, "org_A", "CLAUDE");
    expect(c.update).not.toHaveBeenCalled();
  });

  it("a provider with no step of its own is ignored", async () => {
    const { db, update } = makeDb([], { setupSkipped: ["data"] });
    await clearSkipForProvider(db, "org_A", "NETLIFY_BUILD_HOOK");
    expect(update).not.toHaveBeenCalled();
  });

  it("finishing and reopening set and clear the timestamp, both audited", async () => {
    const done = makeDb([], { setupSkipped: [] });
    await setSetupCompleted(done.db, "org_A", "u1", true);
    expect(done.update.mock.calls[0][0].data.setupCompletedAt).toBeInstanceOf(Date);
    expect(writeOrgAuditLog).toHaveBeenCalledWith(
      done.db,
      expect.objectContaining({ action: "setup.completed" }),
    );

    vi.clearAllMocks();
    const reopen = makeDb([], { setupSkipped: [] });
    await setSetupCompleted(reopen.db, "org_A", "u1", false);
    expect(reopen.update.mock.calls[0][0].data.setupCompletedAt).toBeNull();
    expect(writeOrgAuditLog).toHaveBeenCalledWith(
      reopen.db,
      expect.objectContaining({ action: "setup.reopened" }),
    );
  });
});
