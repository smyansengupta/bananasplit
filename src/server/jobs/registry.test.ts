import { describe, expect, it } from "vitest";

import { implementedKinds, JOB_KINDS, jobKind, leaseMap, type JobKind } from "./registry";

const kinds = Object.keys(JOB_KINDS) as JobKind[];

describe("job-kind registry rules ('Background jobs' decision, item 7)", () => {
  it.each(kinds)("%s: lease is at least maxRuntime + 40s", (kind) => {
    const def = jobKind(kind);
    expect(def.leaseSeconds * 1000).toBeGreaterThanOrEqual(def.maxRuntimeMs + 40_000);
  });

  it.each(kinds.filter((k) => jobKind(k).tier === "heavy"))(
    "%s (heavy): lease exceeds the 300s invocation that can run it, and it never runs in after()",
    (kind) => {
      const def = jobKind(kind);
      expect(def.leaseSeconds).toBeGreaterThan(300);
      expect(def.afterEligible).toBe(false);
    },
  );

  it.each(kinds.filter((k) => jobKind(k).afterEligible))(
    "%s: after()-eligible only with maxRuntime <= 30s",
    (kind) => {
      expect(jobKind(kind).maxRuntimeMs).toBeLessThanOrEqual(30_000);
      expect(jobKind(kind).tier).toBe("fast");
    },
  );

  it("matches the decision table for the named kinds", () => {
    expect(jobKind("notify-email")).toMatchObject({ maxRuntimeMs: 20_000, leaseSeconds: 60, afterEligible: true });
    expect(jobKind("gcal")).toMatchObject({ maxRuntimeMs: 30_000, leaseSeconds: 90, afterEligible: true });
    expect(jobKind("site-rebuild")).toMatchObject({ maxRuntimeMs: 30_000, afterEligible: false });
    expect(jobKind("source-sync")).toMatchObject({ maxRuntimeMs: 150_000, leaseSeconds: 330, tier: "heavy" });
    expect(jobKind("claude-parse")).toMatchObject({ maxRuntimeMs: 250_000, leaseSeconds: 360, tier: "heavy" });
    expect(jobKind("org-export")).toMatchObject({ maxRuntimeMs: 240_000, leaseSeconds: 330, tier: "heavy" });
    expect(jobKind("org-purge")).toMatchObject({ tier: "heavy" });
    expect(jobKind("google-import")).toMatchObject({ tier: "heavy" });
  });

  it("platform kinds are the ones app_auth and the maintenance cron enqueue", () => {
    const platform = kinds.filter((k) => jobKind(k).scope === "platform").sort();
    expect(platform).toEqual(["maintenance", "purge-unverified", "verify-email"]);
  });

  it("payload schemas take ids only", () => {
    expect(jobKind("notify-email").payload.safeParse({ notificationId: "n_1" }).success).toBe(true);
    expect(jobKind("notify-email").payload.safeParse({ notificationId: "a@b.co" }).success).toBe(false);
    expect(
      jobKind("notify-email").payload.safeParse({ notificationId: "n_1", email: "a@b.co" }).success,
    ).toBe(false);
  });

  it("only implemented kinds are claimable, and the lease map covers them", () => {
    const implemented = implementedKinds();
    expect(implemented).toEqual(
      expect.arrayContaining([
        "email",
        "notify-email",
        "invite-email",
        "reimbursement-email",
        "verify-email",
        "purge-unverified",
        "maintenance",
      ]),
    );
    expect(leaseMap(["notify-email", "gcal"])).toEqual({ "notify-email": 60, gcal: 90 });
  });
});
