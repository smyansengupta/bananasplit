import { describe, expect, it } from "vitest";

import { PLAN_FEATURES, type PlanFeature } from "./features";
import {
  effectivePlan,
  featureRefusal,
  spaceIncludes,
  spaceLimits,
  spaceRefusal,
  spaceStatus,
  trialDaysLeft,
  trialEndsAtFrom,
  type SpaceInfo,
} from "./space";

const ALL = Object.keys(PLAN_FEATURES) as PlanFeature[];
const NOW = new Date("2026-10-13T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

const personal: SpaceInfo = { kind: "PERSONAL", plan: "FREE", trialEndsAt: null };
const plus: SpaceInfo = { kind: "PERSONAL", plan: "PERSONAL_PLUS", trialEndsAt: null };
const trial = (endsInDays: number): SpaceInfo => ({
  kind: "CLUB",
  plan: "TRIAL",
  trialEndsAt: new Date(NOW.getTime() + endsInDays * DAY),
});
const teamFree: SpaceInfo = { kind: "CLUB", plan: "TEAM_FREE", trialEndsAt: null };
const club: SpaceInfo = { kind: "CLUB", plan: "CLUB", trialEndsAt: null };
const society: SpaceInfo = { kind: "CLUB", plan: "SOCIETY", trialEndsAt: null };

describe("spaceIncludes", () => {
  it("gives both Personal plans tasks (every view), the calendar and RSVP pages, polls, notes and files, databases, and settings", () => {
    for (const space of [personal, plus]) {
      for (const f of [
        "rsvp",
        "tasks",
        "taskViews",
        "polls",
        "admin",
        "files",
        "databases",
      ] as const) {
        expect(spaceIncludes(space, f, NOW)).toBe(true);
      }
    }
  });

  it("gives Personal Plus themes, calendar sync and AI, and Personal Free none of them", () => {
    for (const f of ["themes", "integrations", "ai"] as const) {
      expect(spaceIncludes(plus, f, NOW)).toBe(true);
      expect(spaceIncludes(personal, f, NOW)).toBe(false);
    }
    expect(effectivePlan(plus)).toBe("PERSONAL_PLUS");
    expect(effectivePlan(personal)).toBe("FREE");
  });

  it("gives Personal Free nothing that needs a team", () => {
    for (const f of [
      "overview",
      "teamwork",
      "labels",
      "people",
      "finance",
      "reports",
      "integrations",
      "sidebar",
      "privacy",
      "themes",
      "ai",
      "sponsorships",
      "websiteSync",
      "auditLog",
    ] as const) {
      expect(spaceIncludes(personal, f, NOW)).toBe(false);
    }
  });

  it("gives a running trial everything (Society)", () => {
    for (const f of ALL) expect(spaceIncludes(trial(10), f, NOW)).toBe(true);
    expect(effectivePlan(trial(10), NOW)).toBe("SOCIETY");
  });

  it("moves an ended trial to Team Free: the basics stay, the paid features lock", () => {
    const ended = trial(-1);
    expect(effectivePlan(ended, NOW)).toBe("TEAM_FREE");
    for (const f of ["tasks", "files", "databases", "overview", "people", "labels"] as const) {
      expect(spaceIncludes(ended, f, NOW)).toBe(true);
    }
    for (const f of ["finance", "orgChart", "reports", "ai", "sponsorships", "auditLog"] as const) {
      expect(spaceIncludes(ended, f, NOW)).toBe(false);
    }
  });

  it("gives Team Free the organization basics and nothing paid", () => {
    for (const f of ["overview", "teamwork", "labels", "people", "sidebar", "privacy"] as const) {
      expect(spaceIncludes(teamFree, f, NOW)).toBe(true);
      expect(spaceIncludes(personal, f, NOW)).toBe(false);
    }
    for (const f of ["finance", "orgChart", "reports", "integrations", "themes"] as const) {
      expect(spaceIncludes(teamFree, f, NOW)).toBe(false);
    }
  });

  it("follows a paid organization's plan", () => {
    expect(spaceIncludes(club, "finance", NOW)).toBe(true);
    expect(spaceIncludes(club, "orgChart", NOW)).toBe(true);
    expect(spaceIncludes(club, "teamwork", NOW)).toBe(true);
    expect(spaceIncludes(club, "themes", NOW)).toBe(false);
    for (const f of ALL) expect(spaceIncludes(society, f, NOW)).toBe(true);
  });
});

describe("trials", () => {
  it("runs 30 days from the start", () => {
    expect(trialEndsAtFrom(NOW).getTime() - NOW.getTime()).toBe(30 * DAY);
  });

  it("is on Free from the moment the trial ends, never paused", () => {
    expect(spaceStatus(trial(1), NOW)).toBe("trial");
    expect(spaceStatus(trial(0), NOW)).toBe("free");
    expect(spaceStatus(trial(-5), NOW)).toBe("free");
    expect(spaceStatus(teamFree, NOW)).toBe("free");
  });

  it("reports Personal and paid organizations as such", () => {
    expect(spaceStatus(personal, NOW)).toBe("personal");
    expect(spaceStatus(club, NOW)).toBe("paid");
    expect(spaceStatus(society, NOW)).toBe("paid");
  });

  it("counts the days left, rounding up, and none once it ends", () => {
    expect(trialDaysLeft(trial(30), NOW)).toBe(30);
    expect(trialDaysLeft(trial(0.5), NOW)).toBe(1);
    expect(trialDaysLeft(trial(-2), NOW)).toBe(0);
    expect(trialDaysLeft(club, NOW)).toBeNull();
    expect(trialDaysLeft(personal, NOW)).toBeNull();
  });
});

describe("spaceLimits", () => {
  it("follows the plan: a running trial has Team Advanced's, an ended one Team Free's", () => {
    expect(spaceLimits(personal).storageBytes).toBe(1024 ** 3);
    expect(spaceLimits(plus).maxFileBytes).toBe(250 * 1024 ** 2);
    expect(spaceLimits(club).noteHistoryDays).toBe(90);
    expect(spaceLimits(trial(5), NOW)).toEqual(spaceLimits(society));
    expect(spaceLimits(trial(-5), NOW)).toEqual(spaceLimits(teamFree));
    expect(spaceLimits(teamFree).storageBytes).toBe(5 * 1024 ** 3);
    // Without the trial's end, a trial counts as running.
    expect(spaceLimits({ kind: "CLUB", plan: "TRIAL" })).toEqual(spaceLimits(society));
  });
});

describe("spaceRefusal for notes and files", () => {
  it("lets every space in, an ended trial included, and refuses what the plan lacks", () => {
    for (const space of [personal, plus, teamFree, club, society, trial(3), trial(-1)]) {
      expect(spaceRefusal(space, { feature: "files" }, NOW)).toBeNull();
    }
    expect(spaceRefusal(trial(-1), { feature: "finance" }, NOW)?.refused).toBe("feature");
  });
});

describe("featureRefusal", () => {
  it("points Personal at organizations and names an organization's plan otherwise, never a price", () => {
    expect(featureRefusal(personal, "finance")).toBe(
      "Finance is for organizations. Start an organization or join one to use it.",
    );
    expect(featureRefusal(club, "themes")).toBe("Custom themes isn't on this organization's plan.");
    expect(featureRefusal(personal, "themes")).toBe("Custom themes comes with Personal Plus.");
    expect(featureRefusal(club, "files")).toBe(
      "Notes and files aren't on this organization's plan.",
    );
    expect(featureRefusal(club, "themes")).not.toMatch(/\$/);
  });
});
