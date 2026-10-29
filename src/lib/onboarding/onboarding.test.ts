import { describe, expect, it } from "vitest";

import {
  blockedHoursPerWeek,
  busyCells,
  describeRule,
  parseAvailability,
  toggleBlock,
  weeklyCells,
} from "@/lib/availability";
import { visibleFinanceCards } from "@/lib/finance/dashboard-cards";
import {
  emailOnDomain,
  generateJoinCode,
  JOIN_CODE_RE,
  normalizeDomain,
  normalizeJoinCode,
} from "@/lib/join-code";
import {
  describeMeeting,
  fiscalYearFor,
  MAX_SETUP_LABELS,
  taskLabelsInputSchema,
  teamsInputSchema,
} from "@/lib/onboarding/org";
import {
  basicsSchema,
  clubRoleHref,
  detectLinkKind,
  gradYearChoices,
  joinMajor,
  nextSetupStep,
  onboardingHref,
  ORG_STEPS,
  PERSONAL_STEPS,
  previousSetupStep,
  schoolSchema,
  setupStepHref,
  splitMajor,
} from "@/lib/onboarding/steps";
import { applyPersonalTheme, parsePersonalTheme, personalThemeSchema } from "@/lib/theme/personal";
import { DEFAULT_RESOLVED_THEME } from "@/lib/theme/resolve";

describe("availability", () => {
  const a = parseAvailability({
    v: 1,
    blocks: ["0-9", "0-9", "2-18"],
    rules: [
      { kind: "never", scope: "hour", hour: 8 },
      { kind: "never", scope: "day", day: 6 },
      { kind: "weekly", label: "Lab section", days: [1, 3], start: 13, end: 15 },
      { kind: "date", label: "Midterm", date: "2026-10-14", start: null, end: null },
    ],
  });

  it("dedupes hand-set blocks and keeps valid rules", () => {
    expect(a.blocks).toEqual(["0-9", "2-18"]);
    expect(a.rules).toHaveLength(4);
  });

  it("paints never rules over a whole row or column and weekly events as their own kind", () => {
    const cells = weeklyCells(a);
    expect(cells.get("3-8")).toBe("never");
    expect(cells.get("6-20")).toBe("never");
    expect(cells.get("1-13")).toBe("weekly");
    expect(cells.get("3-14")).toBe("weekly");
    expect(cells.get("1-15")).toBeUndefined();
    expect(cells.get("0-9")).toBe("never");
  });

  it("counts blocked hours inside the grid only, and exposes no labels to others", () => {
    // 8 AM on the six weekdays not already all-Sunday (6) + Sunday 8a-10p (15)
    // + two hand blocks + the lab's four hours.
    expect(blockedHoursPerWeek(a)).toBe(6 + 15 + 2 + 4);
    const busy = busyCells(a);
    expect(busy.join(",")).not.toMatch(/Lab|Midterm/);
    expect(busy).toContain("1-13");
  });

  it("refuses malformed input as a whole and never throws on stored junk", () => {
    expect(parseAvailability({ blocks: ["9-99"] })).toEqual({ v: 1, blocks: [], rules: [] });
    expect(parseAvailability("nope")).toEqual({ v: 1, blocks: [], rules: [] });
    expect(
      parseAvailability({ rules: [{ kind: "weekly", label: "x", days: [0], start: 15, end: 13 }] })
        .rules,
    ).toEqual([]);
  });

  it("toggles blocks and describes rules the way the flowchart reads", () => {
    expect(toggleBlock(a, "4-10", true).blocks).toContain("4-10");
    expect(toggleBlock(a, "0-9", false).blocks).not.toContain("0-9");
    expect(describeRule({ kind: "never", scope: "hour", hour: 8 })).toEqual({
      badge: "NEVER",
      title: "I can never meet at 8 AM",
      when: "every day",
    });
    expect(
      describeRule({ kind: "weekly", label: "Lab section", days: [1, 3], start: 13, end: 15 }).when,
    ).toBe("Tue, Thu 1–3 PM");
    expect(
      describeRule({ kind: "date", label: "Midterm", date: "2026-10-14", start: null, end: null })
        .when,
    ).toBe("Oct 14, all day");
  });
});

describe("join codes", () => {
  it("generates eight-character XXXX-XXXX codes with no look-alike characters", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateJoinCode();
      expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
      expect(code).toMatch(JOIN_CODE_RE);
      expect(code).not.toMatch(/[01OILU]/);
    }
  });

  it("normalizes what people type", () => {
    expect(normalizeJoinCode(" rpka ywsf ")).toBe("RPKA-YWSF");
    expect(normalizeJoinCode("rpka-ywsf")).toBe("RPKA-YWSF");
    expect(normalizeJoinCode("RPKAYWSF")).toBe("RPKA-YWSF");
    expect(normalizeJoinCode("abc")).toBeNull();
    expect(normalizeJoinCode("abcdefg")).toBeNull();
    expect(normalizeJoinCode("abcd-efgh-ijkl")).toBeNull();
  });

  it("still accepts the six-character codes issued for a while", () => {
    expect(normalizeJoinCode(" robo26 ")).toBe("ROBO26");
    expect(normalizeJoinCode("ro-bo 26")).toBe("ROBO26");
    expect(JOIN_CODE_RE.test("ROBO26")).toBe(true);
  });

  it("matches an email to the org's domain and its subdomains only", () => {
    expect(normalizeDomain("@Northeastern.edu ")).toBe("northeastern.edu");
    expect(normalizeDomain("not a domain")).toBeNull();
    expect(emailOnDomain("ada@northeastern.edu", "northeastern.edu")).toBe(true);
    expect(emailOnDomain("ada@coe.northeastern.edu", "northeastern.edu")).toBe(true);
    expect(emailOnDomain("ada@evilnortheastern.edu", "northeastern.edu")).toBe(false);
    expect(emailOnDomain("ada@northeastern.edu.evil.com", "northeastern.edu")).toBe(false);
  });
});

describe("onboarding steps", () => {
  it("joins with one profile screen", () => {
    expect(clubRoleHref("robotics")).toBe("/onboarding/join/robotics/profile");
  });

  it("sets an organization up import first and the profile last, Finance and the pulse gone", () => {
    expect(ORG_STEPS.slice(0, 2)).toEqual(["basics", "import"]);
    // Back from the first step after creating edits the organization; no Back before it.
    expect(previousSetupStep("org", "import")).toBe("basics");
    expect(previousSetupStep("org", "basics")).toBeNull();
    expect(ORG_STEPS.at(-1)).toBe("profile");
    expect(ORG_STEPS).not.toContain("finance" as never);
    expect(ORG_STEPS).not.toContain("pulse" as never);
    expect(nextSetupStep("org", "bring")).toBe("profile");
    expect(nextSetupStep("org", "profile")).toBeNull();
    expect(setupStepHref("org", "acme", "teams")).toBe("/onboarding/organization/acme/teams");
  });

  it("walks every step in order, whatever was picked to import (no importer skips any yet)", () => {
    expect(nextSetupStep("org", "picture")).toBe("labels");
    expect(previousSetupStep("org", "emails")).toBe("teams");
    expect(nextSetupStep("personal", "import")).toBe("labels");
  });

  it("sets the personal workspace up with iMessage, no event types, the profile last", () => {
    expect(PERSONAL_STEPS).toEqual(["import", "labels", "emails", "imessage", "profile"]);
    expect(previousSetupStep("personal", "import")).toBeNull();
    expect(setupStepHref("personal", "me-x", "emails")).toBe("/onboarding/personal/emails");
  });

  it("carries where sign-up started through /onboarding", () => {
    expect(onboardingHref(null)).toBe("/onboarding");
    expect(onboardingHref("/invite/tok")).toBe("/onboarding?callbackUrl=%2Finvite%2Ftok");
  });

  it("keeps two majors in the one profile field", () => {
    expect(joinMajor("Computer Science", " Mathematics ")).toBe("Computer Science, Mathematics");
    expect(splitMajor("Computer Science, Mathematics")).toEqual([
      "Computer Science",
      "Mathematics",
    ]);
    expect(splitMajor(null)).toEqual(["", ""]);
  });

  it("detects the link type from the URL", () => {
    expect(detectLinkKind("linkedin.com/in/ada")).toBe("linkedin");
    expect(detectLinkKind("https://github.com/ada")).toBe("github");
    expect(detectLinkKind("twitter.com/ada")).toBe("x");
    expect(detectLinkKind("ada.dev")).toBe("website");
  });

  it("offers this academic year's grads first", () => {
    expect(gradYearChoices(new Date("2026-09-29T00:00:00Z"))).toEqual([2027, 2028, 2029, 2030]);
    expect(gradYearChoices(new Date("2027-03-01T00:00:00Z"))).toEqual([2027, 2028, 2029, 2030]);
  });

  it("validates each step's input", () => {
    expect(basicsSchema.safeParse({ name: "  ", pronouns: null, timezone: null }).success).toBe(
      false,
    );
    expect(
      basicsSchema.parse({
        name: "Ada  Lovelace",
        pronouns: "she/her",
        timezone: "America/New_York",
      }),
    ).toEqual({
      name: "Ada Lovelace",
      pronouns: "she/her",
      timezone: "America/New_York",
    });
    expect(schoolSchema.parse({ major: "CS", gradYear: 2027 })).toEqual({
      major: "CS",
      gradYear: 2027,
    });
    expect(schoolSchema.safeParse({ major: "CS", gradYear: 27 }).success).toBe(false);
    // The club role is per club now, not part of school.
    expect(
      schoolSchema.safeParse({ major: "CS", gradYear: 2027, preferredTitle: "VP" }).success,
    ).toBe(false);
  });
});

describe("org setup", () => {
  it("finds the fiscal year that contains today", () => {
    expect(fiscalYearFor("2026-09-29", 8)).toEqual({
      label: "FY 2026–27",
      startsOn: "2026-08-01",
      endsOn: "2027-07-31",
    });
    expect(fiscalYearFor("2026-03-10", 8)).toEqual({
      label: "FY 2025–26",
      startsOn: "2025-08-01",
      endsOn: "2026-07-31",
    });
    expect(fiscalYearFor("2026-03-10", 1)).toEqual({
      label: "FY 2026",
      startsOn: "2026-01-01",
      endsOn: "2026-12-31",
    });
  });

  it("describes meetings like the flowchart", () => {
    expect(describeMeeting({ day: 0, minutes: 19 * 60, cadence: "weekly" })).toBe(
      "Mon 7 PM weekly",
    );
    expect(describeMeeting({ day: 3, minutes: 17 * 60 + 30, cadence: "biweekly" })).toBe(
      "Thu 5:30 PM every 2 weeks",
    );
  });

  it("validates teams", () => {
    expect(
      teamsInputSchema.safeParse({
        teams: [],
        addMeetingsToCalendar: true,
        showMemberAvailability: true,
      }).success,
    ).toBe(false);
    expect(
      teamsInputSchema.safeParse({
        teams: [
          {
            name: "Board",
            leadUserId: null,
            meeting: { day: 0, minutes: 19 * 60 + 7, cadence: "weekly" },
          },
        ],
        addMeetingsToCalendar: true,
        showMemberAvailability: true,
      }).success,
    ).toBe(false);
  });

  it("validates the task labels: palette colours, a name each, and a cap", () => {
    const label = { id: null, name: "  Events  ", color: "#e3a90a" };
    const parsed = taskLabelsInputSchema.safeParse({ labels: [label] });
    expect(parsed.success && parsed.data.labels[0]?.name).toBe("Events");
    expect(
      taskLabelsInputSchema.safeParse({ labels: [{ ...label, color: "#123456" }] }).success,
    ).toBe(false);
    expect(taskLabelsInputSchema.safeParse({ labels: [{ ...label, name: "   " }] }).success).toBe(
      false,
    );
    expect(
      taskLabelsInputSchema.safeParse({
        labels: Array.from({ length: MAX_SETUP_LABELS + 1 }, () => label),
      }).success,
    ).toBe(false);
  });

  it("shows every finance section until the org picks some", () => {
    expect(visibleFinanceCards([]).size).toBe(4);
    expect([...visibleFinanceCards(["runway", "nonsense"])]).toEqual(["runway"]);
  });
});

describe("personal theme", () => {
  it("accepts a preset or five custom colours, nothing else", () => {
    expect(personalThemeSchema.safeParse({ preset: "harbor", mode: "dark" }).success).toBe(true);
    expect(personalThemeSchema.safeParse({ preset: "nope", mode: "dark" }).success).toBe(false);
    expect(personalThemeSchema.safeParse({ preset: "custom", mode: "light" }).success).toBe(false);
    expect(
      personalThemeSchema.safeParse({
        preset: "custom",
        mode: "light",
        custom: {
          primary: "red",
          accent: "#000000",
          background: "#ffffff",
          surface: "#ffffff",
          text: "#000000",
        },
      }).success,
    ).toBe(false);
    expect(parsePersonalTheme({ preset: "harbor", mode: "dark", custom: { x: 1 } })).toBeNull();
  });

  it("swaps the palette for the member but keeps an org's light/dark lock", () => {
    const personal = parsePersonalTheme({ preset: "harbor", mode: "dark" });
    const mine = applyPersonalTheme(DEFAULT_RESOLVED_THEME, personal);
    expect(mine.preset).toBe("harbor");
    expect(mine.mode).toBe("DARK");
    expect(mine.isDefault).toBe(false);

    const locked = { ...DEFAULT_RESOLVED_THEME, mode: "LIGHT" as const, lockMode: true };
    const underLock = applyPersonalTheme(locked, personal);
    expect(underLock.mode).toBe("LIGHT");
    expect(underLock.lockMode).toBe(true);
    expect(applyPersonalTheme(locked, null)).toBe(locked);
  });
});

describe("per-IP sign-up and sign-in limits", () => {
  it("default to a room's worth and take an override, ignoring junk", async () => {
    const { signInPerIpLimit, signUpPerIpLimit } = await import("@/lib/auth/ip-limits");
    expect(signUpPerIpLimit({})).toBe(40);
    expect(signInPerIpLimit({})).toBe(120);
    expect(signUpPerIpLimit({ SIGNUP_LIMIT_PER_IP_HOUR: "200" })).toBe(200);
    expect(signUpPerIpLimit({ SIGNUP_LIMIT_PER_IP_HOUR: "0" })).toBe(40);
    expect(signInPerIpLimit({ SIGNIN_LIMIT_PER_IP_15MIN: "lots" })).toBe(120);
    expect(signInPerIpLimit({ SIGNIN_LIMIT_PER_IP_15MIN: "999999" })).toBe(2000);
  });
});

describe("major suggestions and graduation years", () => {
  it("suggests majors that start with, then contain, what was typed", async () => {
    const { suggestMajors } = await import("./majors");
    expect(suggestMajors("comp")[0]).toBe("Comparative Literature");
    expect(suggestMajors("comp")).toContain("Computer Science");
    expect(suggestMajors("science")).toContain("Data Science");
    expect(suggestMajors("")).toEqual([]);
    expect(suggestMajors("Computer Science")).not.toContain("Computer Science");
  });

  it("never offers a year that has already graduated", async () => {
    const { gradYearChoices } = await import("./steps");
    expect(gradYearChoices(new Date(Date.UTC(2027, 3, 1)))).toEqual([2027, 2028, 2029, 2030]);
    expect(gradYearChoices(new Date(Date.UTC(2027, 7, 1)))).toEqual([2028, 2029, 2030, 2031]);
    expect(gradYearChoices(new Date(Date.UTC(2027, 7, 1)), 8)).toHaveLength(8);
  });
});
