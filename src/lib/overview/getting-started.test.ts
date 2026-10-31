import { describe, expect, it } from "vitest";

import {
  STARTED_STEP_KEYS,
  startedHref,
  startedProgress,
  type StartedState,
} from "./getting-started";

const none = Object.fromEntries(STARTED_STEP_KEYS.map((k) => [k, false])) as StartedState;

describe("get your organization started", () => {
  it("counts what the organization has and what it checked off", () => {
    const p = startedProgress({ ...none, picture: true, event: true }, ["database"]);
    expect(p.finished).toBe(3);
    expect(p.total).toBe(STARTED_STEP_KEYS.length);
    expect(p.complete).toBe(false);
    expect(p.steps.find((s) => s.key === "database")?.status).toBe("skipped");
    expect(p.steps.find((s) => s.key === "budget")?.status).toBe("todo");
  });

  it("is complete once every step is done or checked off", () => {
    const done = {
      ...none,
      picture: true,
      members: true,
      event: true,
      types: true,
      task: true,
      teams: true,
    };
    expect(startedProgress(done, ["budget"]).complete).toBe(false);
    expect(startedProgress(done, ["budget", "database"]).complete).toBe(true);
  });

  it("prefers done over checked off, and ignores unknown keys", () => {
    const p = startedProgress({ ...none, budget: true }, ["budget", "sections"]);
    expect(p.steps.find((s) => s.key === "budget")?.status).toBe("done");
    expect(p.finished).toBe(1);
  });

  it("no longer asks an organization to pick its sections, or to check the name it just typed", () => {
    expect(STARTED_STEP_KEYS).not.toContain("sections" as never);
    expect(STARTED_STEP_KEYS).not.toContain("name" as never);
  });

  it("links setup pages whole and app pages under the organization", () => {
    expect(startedHref("acme", "/onboarding/organization/{slug}/teams")).toBe(
      "/onboarding/organization/acme/teams",
    );
    expect(startedHref("acme", "/finance/budget")).toBe("/app/acme/finance/budget");
  });
});
