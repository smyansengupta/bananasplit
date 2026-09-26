// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  SETUP_STEPS,
  SETUP_TOTAL_MINUTES,
  isSetupStepId,
  setupStep,
  stepIdForProvider,
} from "./catalog";
import { diagnose } from "./diagnose";

/**
 * A failed test already says what went wrong; diagnose says what to do
 * next. These pin the pairs that matter — the failures a student officer
 * will actually hit — and pin the rule that an unrecognised reason is
 * passed through whole rather than swallowed.
 */

describe("diagnose", () => {
  const cases: [Parameters<typeof diagnose>[0], string, RegExp][] = [
    ["data", "The website database refused the password for the reader role.", /ALTER ROLE/],
    [
      "data",
      "The website database has no suite export. Apply supabase/suite-export.sql first.",
      /applied to this project yet/,
    ],
    ["data", "The pooler host was not found. Check the region and prefix.", /Session pooler/],
    ["data", "The website database did not answer.", /paused/],
    ["data", "The website export is version 9; this suite understands version 1.", /latest/],
    ["calendar", "Google access was revoked or expired. Connect again.", /Testing mode/],
    [
      "email",
      "mail.club.org is not a domain in this Resend account. Add and verify it in Resend first.",
      /from address/,
    ],
    [
      "email",
      "mail.club.org is pending in Resend. Finish the DNS records, then test again.",
      /DNS/,
    ],
    [
      "email",
      "Resend rejected this API key (it needs full access to read domains).",
      /Full access/,
    ],
    ["claude", "Claude rejected this API key.", /console\.anthropic\.com/],
    [
      "claude",
      "The key works, but it cannot use claude-opus-5. Pick another default model.",
      /different default/,
    ],
    ["claude", "Claude rate-limited the test. Try again shortly.", /Nothing is wrong/],
    ["claude", "Claude answered 403.", /spend limit/],
  ];

  it.each(cases)("%s: %s", (step, reason, fix) => {
    const d = diagnose(step, reason);
    expect(d.reason).toBe(reason);
    expect(d.fix).toMatch(fix);
  });

  it("names the field to go back to when exactly one is at fault", () => {
    expect(
      diagnose("data", "The website database refused the password for the reader role.").field,
    ).toBe("password");
    expect(diagnose("email", "Resend rejected this API key (it needs full access).").field).toBe(
      "apiKey",
    );
    expect(
      diagnose("data", "The pooler host was not found. Check the region and prefix.").field,
    ).toBe("poolerRegion");
  });

  it("the timeout rule is shared by every step", () => {
    for (const step of SETUP_STEPS) {
      expect(diagnose(step.id, "The connection test timed out.").fix).toMatch(/ten seconds/);
    }
  });

  it("passes an unrecognised reason through whole rather than swallowing it", () => {
    const odd = "ECONNRESET while negotiating something nobody anticipated";
    const d = diagnose("data", odd);
    expect(d.reason).toBe(odd);
    expect(d.fix).toBeNull();
    expect(d.field).toBeNull();
  });

  it("a reason from one step does not pick up another step's fix", () => {
    expect(diagnose("claude", "Resend rejected this API key.").fix).toBeNull();
  });
});

describe("the step catalog", () => {
  it("every step names a provider, a settings page and something it turns on", () => {
    for (const step of SETUP_STEPS) {
      expect(step.unlocks.length).toBeGreaterThan(0);
      expect(step.consequences.length).toBeGreaterThan(0);
      expect(step.where.length).toBeGreaterThan(0);
      expect(step.ifSkipped).toBeTruthy();
      expect(step.minutes).toBeGreaterThan(0);
      expect(setupStep(step.id)).toBe(step);
      expect(stepIdForProvider(step.provider)).toBe(step.id);
    }
  });

  it("the data source comes first: it is the step that fills empty screens", () => {
    expect(SETUP_STEPS[0].id).toBe("data");
  });

  it("the quoted total is the sum of the steps, not a guess", () => {
    expect(SETUP_TOTAL_MINUTES).toBe(SETUP_STEPS.reduce((n, s) => n + s.minutes, 0));
  });

  it("only real step ids are accepted from a URL", () => {
    expect(isSetupStepId("data")).toBe(true);
    expect(isSetupStepId("finish")).toBe(false);
    expect(isSetupStepId("../../etc")).toBe(false);
  });

  it("the example credentials in the copy are obvious placeholders, never real keys", () => {
    const codes = SETUP_STEPS.flatMap((s) => s.where.map((w) => w.code)).filter((c): c is string =>
      Boolean(c),
    );
    const keyish = codes.filter((c) => /^(sk-ant|re_)/.test(c));
    expect(keyish.length).toBeGreaterThan(0);
    // A placeholder repeats one character or trails off; a real key does neither.
    for (const code of keyish) expect(code).toMatch(/x{6,}|…/);
  });
});
