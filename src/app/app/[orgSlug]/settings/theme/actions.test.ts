import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Settings > Theme actions against a fake withOrgAction that hands the
 * handler a mocked transaction client and runs the afterCommit queue after
 * the handler returns, like the real wrapper. The database side (RLS on
 * OrgTheme) is covered by prisma/rls/phases.mjs P8-01..03.
 */

const { state, db, calls } = vi.hoisted(() => {
  const calls: string[] = [];
  return {
    calls,
    state: { role: "ADMIN" as string, committed: true },
    db: {
      $queryRaw: vi.fn(async () => [{ id: "audit1" }]),
      orgTheme: {
        findUnique: vi.fn(async () => null),
        upsert: vi.fn(async () => ({})),
        deleteMany: vi.fn(async () => ({ count: 1 })),
      },
    },
  };
});

vi.mock("next/cache", () => ({
  refresh: vi.fn(() => calls.push("refresh")),
  updateTag: vi.fn((tag: string) => calls.push(`updateTag:${tag}`)),
  revalidateTag: vi.fn((tag: string) => calls.push(`revalidateTag:${tag}`)),
}));

vi.mock("@/server/db/context", () => {
  const queue: Array<() => unknown> = [];
  return {
    currentTx: () => ({ afterCommit: (fn: () => unknown) => queue.push(fn) }),
    withOrgAction:
      (handler: (ctx: unknown, ...args: unknown[]) => Promise<unknown>) =>
      async (organizationId: string, ...args: unknown[]) => {
        queue.length = 0;
        const result = await handler(
          {
            kind: "action",
            db,
            user: { id: "u1", email: "u1@example.edu", name: null },
            userId: "u1",
            organizationId,
            role: state.role,
            afterCommit: (fn: () => unknown) => queue.push(fn),
          },
          ...args,
        );
        calls.push("commit");
        for (const fn of queue) await fn();
        return result;
      },
  };
});

const { resetOrgTheme, saveOrgTheme } = await import("./actions");
const { CBC_PRESET } = await import("@/lib/theme/presets");
const { deriveTheme } = await import("@/lib/theme/derive");
const { Prisma } = await import("@/generated/prisma/client");

const ORG = "org_1";
const INPUT = {
  preset: "custom",
  mode: "DARK",
  lockMode: true,
  logoDisplay: "LOGO_ONLY",
  light: { ...CBC_PRESET.light, primary: "#3355aa" },
  dark: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  state.role = "ADMIN";
});

describe("saveOrgTheme", () => {
  it("refuses members and treasurers without touching the database", async () => {
    for (const role of ["MEMBER", "TREASURER"]) {
      state.role = role;
      const result = await saveOrgTheme(ORG, INPUT);
      expect(result).toEqual({ ok: false, error: "Only owners and admins can change the theme." });
    }
    expect(db.orgTheme.upsert).not.toHaveBeenCalled();
  });

  it("rejects a malicious colour before any write", async () => {
    const result = await saveOrgTheme(ORG, {
      ...INPUT,
      light: { ...INPUT.light, surface: "#fff;}</style><script>alert(1)</script>" },
    });
    expect(result.ok).toBe(false);
    expect(db.orgTheme.upsert).not.toHaveBeenCalled();
    expect(calls).not.toContain("refresh");
  });

  it("stores server-derived tokens and warnings, audits, then invalidates and refreshes after commit", async () => {
    // Client-sent tokens are an unknown key: the strict schema rejects them.
    const result = await saveOrgTheme(ORG, { ...INPUT, tokens: { light: {}, dark: {} } });
    expect(result.ok).toBe(false);
    expect(db.orgTheme.upsert).not.toHaveBeenCalled();
    calls.length = 0;

    const ok = await saveOrgTheme(ORG, INPUT);
    expect(ok.ok).toBe(true);
    const args = db.orgTheme.upsert.mock.calls[0] as unknown as [
      { where: unknown; create: Record<string, unknown>; update: Record<string, unknown> },
    ];
    const { where, create, update } = args[0];
    expect(where).toEqual({ organizationId: ORG });
    expect(create).toMatchObject({
      organizationId: ORG,
      preset: "custom",
      mode: "DARK",
      lockMode: true,
      logoDisplay: "LOGO_ONLY",
      light: INPUT.light,
      updatedById: "u1",
    });
    expect(create.dark).toBe(Prisma.DbNull);
    expect(create.tokens).toEqual(deriveTheme(INPUT.light, null));
    expect(update).toMatchObject({ preset: "custom", mode: "DARK" });
    expect(db.$queryRaw).toHaveBeenCalledTimes(1); // app.write_org_audit
    expect(calls).toEqual(["commit", `updateTag:org:${ORG}:theme`, "refresh"]);
  });

  it("stores a preset's own palettes and never locks SYSTEM", async () => {
    await saveOrgTheme(ORG, { ...INPUT, preset: "cbc", mode: "SYSTEM", lockMode: true });
    const args = db.orgTheme.upsert.mock.calls[0] as unknown as [
      { create: Record<string, unknown> },
    ];
    expect(args[0].create).toMatchObject({
      preset: "cbc",
      light: CBC_PRESET.light,
      dark: CBC_PRESET.dark,
      mode: "SYSTEM",
      lockMode: false,
      contrastWarnings: [],
    });
  });

  it("saves a failing theme anyway and returns its warnings", async () => {
    const failing = { ...INPUT, light: { ...INPUT.light, text: "#bbbbbb" } };
    const result = await saveOrgTheme(ORG, failing);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings.some((w) => w.pair === "text-background")).toBe(true);
    }
    expect(db.orgTheme.upsert).toHaveBeenCalledTimes(1);
  });
});

describe("resetOrgTheme", () => {
  it("deletes the row (back to the default) and refreshes after commit", async () => {
    const result = await resetOrgTheme(ORG);
    expect(result).toEqual({ ok: true, warnings: [] });
    expect(db.orgTheme.deleteMany).toHaveBeenCalledWith({ where: { organizationId: ORG } });
    expect(calls).toEqual(["commit", `updateTag:org:${ORG}:theme`, "refresh"]);
  });

  it("refuses members", async () => {
    state.role = "MEMBER";
    expect((await resetOrgTheme(ORG)).ok).toBe(false);
    expect(db.orgTheme.deleteMany).not.toHaveBeenCalled();
  });
});
