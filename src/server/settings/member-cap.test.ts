import { describe, expect, it } from "vitest";

import { capRefusal } from "./member-cap";

const base = { name: "Acme", kind: "CLUB" as const, trialEndsAt: null, planAfterTrial: null };

describe("capRefusal", () => {
  it("refuses the 11th member of a Team Free org, and says why", () => {
    expect(capRefusal({ ...base, plan: "TEAM_FREE" }, 9)).toBeNull();
    expect(capRefusal({ ...base, plan: "TEAM_FREE" }, 10)).toMatch(/Acme is on Free.*10 members/);
  });

  it("has no cap on a running trial, a paid plan or a Personal space", () => {
    const running = new Date(Date.now() + 86_400_000);
    expect(capRefusal({ ...base, plan: "TRIAL", trialEndsAt: running }, 50)).toBeNull();
    expect(capRefusal({ ...base, plan: "CLUB" }, 50)).toBeNull();
    expect(capRefusal({ ...base, kind: "PERSONAL", plan: "FREE" }, 50)).toBeNull();
  });

  it("caps a trial that ended with nothing picked, as Free", () => {
    const ended = new Date(Date.now() - 86_400_000);
    expect(capRefusal({ ...base, plan: "TRIAL", trialEndsAt: ended }, 10)).not.toBeNull();
  });
});
