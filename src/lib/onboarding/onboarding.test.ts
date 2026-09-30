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
  labelsInputSchema,
  teamsInputSchema,
} from "@/lib/onboarding/org";
import {
  basicsSchema,
  detectLinkKind,
  gradYearChoices,
  joinMajor,
  nextProfileStep,
  schoolSchema,
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
  it("generates XXXX-XXXX codes with no look-alike characters", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateJoinCode();
      expect(code).toMatch(JOIN_CODE_RE);
      expect(code).not.toMatch(/[01OILU]/);
    }
  });

  it("normalizes what people type", () => {
    expect(normalizeJoinCode(" abcd efgh ")).toBe("ABCD-EFGH");
    expect(normalizeJoinCode("abcd-efgh")).toBe("ABCD-EFGH");
    expect(normalizeJoinCode("abc")).toBeNull();
    expect(normalizeJoinCode("abcd-efgh-ijkl")).toBeNull();
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

describe("profile setup steps", () => {
  it("walks the six steps in order", () => {
    expect(nextProfileStep("basics")).toBe("school");
    expect(nextProfileStep("availability")).toBe("review");
    expect(nextProfileStep("review")).toBeNull();
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
    expect(
      schoolSchema.parse({ major: "CS", gradYear: 2027, preferredTitle: "  " }).preferredTitle,
    ).toBeNull();
    expect(
      schoolSchema.safeParse({ major: "CS", gradYear: 27, preferredTitle: null }).success,
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

  it("validates teams and labels", () => {
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
    expect(
      labelsInputSchema.safeParse({
        sources: [{ id: "d1", name: "People", tag: "Spies" }],
        visibility: {},
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
