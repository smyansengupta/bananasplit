import { describe, expect, it } from "vitest";

import {
  FEATURE_LABELS,
  FEATURE_PITCH,
  PLAN_FEATURES,
  PLAN_LIMITS,
  PLAN_NAMES,
  PLAN_ORDER,
  featuresOf,
  isOrgPlan,
  isPlanChoiceFor,
  personalPlanFor,
  planChoicesFor,
  planFor,
  planIncludes,
  type PlanFeature,
} from "./features";
import { CLUB_PLANS, PERSONAL_PLANS } from "./plans";

const ALL = Object.keys(PLAN_FEATURES) as PlanFeature[];
const MB = 1024 * 1024;
const GB = 1024 * MB;

describe("what each plan includes", () => {
  it("gives Personal Free RSVP pages, tasks, polls, notes and files, databases, settings and AI connectors", () => {
    expect(featuresOf("FREE")).toEqual([
      "rsvp",
      "tasks",
      "taskViews",
      "polls",
      "admin",
      "files",
      "databases",
      "connectors",
    ]);
    for (const f of ["teamwork", "people", "finance", "reports", "overview", "themes"] as const) {
      expect(planIncludes("FREE", f)).toBe(false);
    }
  });

  it("gives Personal Plus Personal Free plus themes, calendar sync and AI, and nothing for a team", () => {
    expect(featuresOf("PERSONAL_PLUS")).toEqual([
      ...featuresOf("FREE"),
      "integrations",
      "themes",
      "ai",
    ]);
    for (const f of ["overview", "teamwork", "labels", "people", "finance", "sponsorships", "auditLog"] as const) {
      expect(planIncludes("PERSONAL_PLUS", f)).toBe(false);
    }
  });

  it("gives Team (CLUB) the officer workspace, notes and files included, but not the Team Advanced extras", () => {
    for (const f of [
      "overview",
      "teamwork",
      "files",
      "people",
      "finance",
      "databases",
      "reports",
      "integrations",
    ] as const) {
      expect(planIncludes("CLUB", f)).toBe(true);
    }
    for (const f of ["themes", "ai", "sponsorships", "websiteSync", "auditLog"] as const) {
      expect(planIncludes("CLUB", f)).toBe(false);
      expect(planIncludes("SOCIETY", f)).toBe(true);
    }
  });

  it("keeps the club ladder ordered: Team has Personal Free's, Team Advanced has everything", () => {
    expect(featuresOf("SOCIETY")).toEqual(ALL);
    for (const f of ALL) {
      if (planIncludes("FREE", f)) {
        expect(planIncludes("PERSONAL_PLUS", f)).toBe(true);
        expect(planIncludes("CLUB", f)).toBe(true);
      }
      if (planIncludes("CLUB", f)) expect(planIncludes("SOCIETY", f)).toBe(true);
      expect(planIncludes(planFor(f), f)).toBe(true);
    }
  });

  it("knows which Personal plan has a feature, or that only clubs do", () => {
    expect(personalPlanFor("files")).toBe("FREE");
    expect(personalPlanFor("themes")).toBe("PERSONAL_PLUS");
    expect(personalPlanFor("integrations")).toBe("PERSONAL_PLUS");
    expect(personalPlanFor("finance")).toBeNull();
  });

  it("names and describes every feature for the upgrade screen", () => {
    for (const f of ALL) {
      expect(FEATURE_LABELS[f]).toBeTruthy();
      expect(FEATURE_PITCH[f]).toMatch(/\.$/);
    }
  });

  it("recognises the four priced plans and nothing else", () => {
    expect(PLAN_ORDER).toEqual(["FREE", "PERSONAL_PLUS", "CLUB", "SOCIETY"]);
    expect(PLAN_ORDER.every(isOrgPlan)).toBe(true);
    expect(isOrgPlan("TRIAL")).toBe(false);
    expect(isOrgPlan("PRO")).toBe(false);
    expect(isOrgPlan("free")).toBe(false);
    expect(isOrgPlan(undefined)).toBe(false);
  });
});

describe("names, prices and limits (redesign guide 11.1, 20.9 a, 20.10 a)", () => {
  it("names the four tiers", () => {
    expect(PLAN_NAMES).toMatchObject({
      FREE: "Personal Free",
      PERSONAL_PLUS: "Personal Plus",
      CLUB: "Team",
      SOCIETY: "Team Advanced",
    });
    expect(CLUB_PLANS.club.name).toBe("Team");
    expect(CLUB_PLANS.society.name).toBe("Team Advanced");
    expect(PERSONAL_PLANS.plus.name).toBe("Personal Plus");
  });

  it("prices Personal Plus at $4 a month or $36 a year, and Team at $4 and $7 a member", () => {
    expect(PERSONAL_PLANS.plus).toMatchObject({ perMonth: 4, perYear: 36 });
    expect(PERSONAL_PLANS.free).toMatchObject({ perMonth: 0, perYear: 0 });
    expect(CLUB_PLANS.club.perMemberPerSemester).toBe(4);
    expect(CLUB_PLANS.society.perMemberPerSemester).toBe(7);
  });

  it("gives each tier its storage, largest file and note history", () => {
    expect(PLAN_LIMITS.FREE).toMatchObject({ storageBytes: 1 * GB, maxFileBytes: 10 * MB, noteHistoryDays: 7 });
    expect(PLAN_LIMITS.PERSONAL_PLUS).toMatchObject({
      storageBytes: 25 * GB,
      maxFileBytes: 250 * MB,
      noteHistoryDays: 365,
    });
    expect(PLAN_LIMITS.CLUB).toMatchObject({ storageBytes: 100 * GB, maxFileBytes: 250 * MB, noteHistoryDays: 90 });
    expect(PLAN_LIMITS.SOCIETY).toMatchObject({ storageBytes: 500 * GB, maxFileBytes: 1 * GB, noteHistoryDays: 365 });
  });

  it("keeps the data-connection limits, and gives a trial Team Advanced's limits", () => {
    expect(PLAN_LIMITS.FREE.dataConnections).toBe(0);
    expect(PLAN_LIMITS.CLUB.dataConnections).toBe(2);
    expect(PLAN_LIMITS.SOCIETY.dataConnections).toBe(6);
    expect(PLAN_LIMITS.TRIAL).toEqual(PLAN_LIMITS.SOCIETY);
  });
});

describe("plan choices", () => {
  it("lets a Personal space pick Personal Free or Plus, and a club Team or Team Advanced", () => {
    expect(planChoicesFor("PERSONAL")).toEqual(["FREE", "PERSONAL_PLUS"]);
    expect(planChoicesFor("CLUB")).toEqual(["CLUB", "SOCIETY"]);
    expect(isPlanChoiceFor("PERSONAL", "PERSONAL_PLUS")).toBe(true);
    expect(isPlanChoiceFor("PERSONAL", "CLUB")).toBe(false);
    expect(isPlanChoiceFor("CLUB", "PERSONAL_PLUS")).toBe(false);
    expect(isPlanChoiceFor("CLUB", "FREE")).toBe(false);
    expect(isPlanChoiceFor("CLUB", "TRIAL")).toBe(false);
    expect(isPlanChoiceFor("PERSONAL", "TRIAL")).toBe(false);
  });
});
