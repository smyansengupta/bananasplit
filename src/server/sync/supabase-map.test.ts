// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  cleanName,
  isSourceId,
  kindOfTitle,
  mapCheckinSource,
  mapSignupSource,
  maskEmail,
  normalizeEmail,
  signupAnswers,
  signupLabel,
} from "./supabase-map";

describe("check-in method mapping (the website's checkins.source)", () => {
  it.each([
    ["code", "FORM"],
    ["link", "QR"],
    ["officer", "MANUAL"],
  ])("%s becomes %s", (source, method) => {
    expect(mapCheckinSource(source)).toEqual({ method, unmapped: false });
  });

  it("is case and whitespace tolerant", () => {
    expect(mapCheckinSource(" Officer ")).toEqual({ method: "MANUAL", unmapped: false });
  });

  it("maps an unknown value to FORM and counts it as unmapped", () => {
    for (const value of ["kiosk", "", null, undefined]) {
      expect(mapCheckinSource(value)).toEqual({ method: "FORM", unmapped: true });
    }
  });
});

describe("signup channel mapping", () => {
  it.each([
    ["web", "WEB"],
    ["typeform", "TYPEFORM"],
    ["officer", "OFFICER"],
    ["anything-else", "WEB"],
  ])("%s becomes %s", (source, channel) => {
    expect(mapSignupSource(source)).toBe(channel);
  });
});

describe("kindOfTitle (the website's kindOf, ported)", () => {
  it.each([
    ["Mini Hackathon: Fix Northeastern", "HACKATHON"],
    ["Fall Chatathon", "HACKATHON"],
    ["Hack Night", "HACKATHON"],
    ["Info Session: Meet the Club", "INFO_SESSION"],
    ["Intro to the club", "INFO_SESSION"],
    ["Kick-off", "INFO_SESSION"],
    ["Welcome Social: Board Games", "SOCIAL"],
    ["Workshop 3: Tool Use", "WORKSHOP"],
    ["Prompting office hours", "WORKSHOP"],
  ])("%s is a %s", (title, kind) => {
    expect(kindOfTitle(title)).toBe(kind);
  });
});

describe("emails", () => {
  it("normalizes and rejects non-addresses", () => {
    expect(normalizeEmail("  Alvarez.J@Northeastern.EDU ")).toBe("alvarez.j@northeastern.edu");
    for (const bad of ["", "nope", "a@b@c.com", "a@", "@b.com", "a b@c.com", null]) {
      expect(normalizeEmail(bad)).toBeNull();
    }
  });

  it("masks the local part only", () => {
    expect(maskEmail("maya@husky.neu.edu")).toEqual({ masked: "m***@husky.neu.edu", domain: "husky.neu.edu" });
  });
});

describe("names and ids", () => {
  it("collapses whitespace and bounds the length", () => {
    expect(cleanName("  Ada   Park ")).toBe("Ada Park");
    expect(cleanName("   ")).toBeNull();
    expect(cleanName("x".repeat(200))?.length).toBe(120);
  });

  it("only UUID-shaped external ids belong to the website source", () => {
    expect(isSourceId("11111111-1111-1111-1111-111111111111")).toBe(true);
    expect(isSourceId("ck_1000")).toBe(false);
    expect(isSourceId(null)).toBe(false);
  });
});

describe("signup answers", () => {
  it("keeps plain tokens, lower-cases them and drops the rest", () => {
    expect(
      signupAnswers({ colleges: ["Khoury", "<script>", 7], meet_days: ["tuesday"], interests: null }),
    ).toEqual({ colleges: ["khoury"], meet_days: ["tuesday"], interests: [] });
  });

  it("labels known tokens and falls back to the token", () => {
    expect(signupLabel("colleges", "khoury")).toBe("Khoury");
    expect(signupLabel("interests", "quantum")).toBe("quantum");
  });
});
