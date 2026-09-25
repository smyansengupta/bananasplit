import { describe, expect, it } from "vitest";

import { peopleHref, personHref, personTasksHref, profileHref } from "./href";
import { linkDisplayText, MAX_LINKS, normalizeLinkUrl, parseStoredLinks } from "./links";
import {
  profileDetailsSchema,
  profileFieldErrors,
  profileInputSchema,
  profileLinksSchema,
} from "./schema";
import { effectiveTimezone, isValidTimeZone, listTimeZones } from "./timezone";

describe("profile links", () => {
  it("normalizes a bare address and keeps http(s) URLs", () => {
    expect(normalizeLinkUrl("github", "github.com/ada")).toEqual({ ok: true, url: "https://github.com/ada" });
    expect(normalizeLinkUrl("website", "  http://ada.dev/  ")).toEqual({ ok: true, url: "http://ada.dev/" });
    expect(normalizeLinkUrl("linkedin", "https://www.linkedin.com/in/ada")).toEqual({
      ok: true,
      url: "https://www.linkedin.com/in/ada",
    });
    expect(normalizeLinkUrl("x", "twitter.com/ada").ok).toBe(true);
    expect(normalizeLinkUrl("x", "https://x.com/ada").ok).toBe(true);
  });

  it("refuses other schemes, credentials, bare hosts and spaces", () => {
    for (const url of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "mailto:ada@example.edu",
      "ftp://ada.dev/file",
      "https://user:pass@ada.dev",
      "https://localhost/",
      "https://ada dev.com",
      "",
      "   ",
    ]) {
      expect(normalizeLinkUrl("website", url).ok, url).toBe(false);
    }
  });

  it("keeps each network on its own site", () => {
    expect(normalizeLinkUrl("github", "https://evil.example/github.com").ok).toBe(false);
    expect(normalizeLinkUrl("github", "https://github.com.evil.example/ada").ok).toBe(false);
    expect(normalizeLinkUrl("linkedin", "https://notlinkedin.com/in/ada").ok).toBe(false);
    expect(normalizeLinkUrl("instagram", "https://www.instagram.com/ada").ok).toBe(true);
    expect(normalizeLinkUrl("tiktok", "https://www.tiktok.com/@ada").ok).toBe(true);
    expect(normalizeLinkUrl("other", "https://anything.example/x").ok).toBe(true);
  });

  it("caps a URL at 300 characters", () => {
    expect(normalizeLinkUrl("website", `https://ada.dev/${"a".repeat(284)}`).ok).toBe(true);
    expect(normalizeLinkUrl("website", `https://ada.dev/${"a".repeat(285)}`).ok).toBe(false);
  });

  it("reads stored links defensively: malformed entries are dropped, never rendered", () => {
    expect(
      parseStoredLinks([
        { kind: "github", url: "https://github.com/ada" },
        { kind: "website", url: "javascript:alert(1)" },
        { kind: "bogus", url: "https://ada.dev" },
        { kind: "website" },
        "https://ada.dev",
        null,
      ]),
    ).toEqual([{ kind: "github", url: "https://github.com/ada" }]);
    expect(parseStoredLinks({})).toEqual([]);
    expect(parseStoredLinks(null)).toEqual([]);
    const many = Array.from({ length: 12 }, (_, i) => ({ kind: "website", url: `https://site${i}.dev` }));
    expect(parseStoredLinks(many)).toHaveLength(MAX_LINKS);
  });

  it("labels links by network, or by host for websites", () => {
    expect(linkDisplayText({ kind: "github", url: "https://github.com/ada" })).toBe("GitHub");
    expect(linkDisplayText({ kind: "website", url: "https://www.ada.dev/" })).toBe("ada.dev");
    expect(linkDisplayText({ kind: "other", url: "https://blog.ada.dev/posts" })).toBe("blog.ada.dev/posts");
  });
});

describe("profile form schemas", () => {
  const valid = {
    name: "  Ada   Lovelace ",
    pronouns: "she/her",
    major: "Mathematics",
    gradYear: 2028,
    bio: "Line one\r\nLine two",
    timezone: "America/New_York",
  };

  it("trims, normalizes and turns empty optional fields into null", () => {
    expect(profileDetailsSchema.parse(valid)).toEqual({
      name: "Ada Lovelace",
      pronouns: "she/her",
      major: "Mathematics",
      gradYear: 2028,
      bio: "Line one\nLine two",
      timezone: "America/New_York",
    });
    expect(
      profileDetailsSchema.parse({ name: "Ada", pronouns: "  ", major: "", bio: "", gradYear: null, timezone: "" }),
    ).toEqual({ name: "Ada", pronouns: null, major: null, gradYear: null, bio: null, timezone: null });
  });

  it("enforces the limits", () => {
    const errors = (input: Record<string, unknown>) => {
      const result = profileDetailsSchema.safeParse({ ...valid, ...input });
      return result.success ? {} : profileFieldErrors(result.error);
    };
    expect(errors({ name: "   " })).toHaveProperty("name");
    expect(errors({ name: "x".repeat(81) })).toHaveProperty("name");
    expect(errors({ name: "x".repeat(80) })).toEqual({});
    expect(errors({ pronouns: "x".repeat(41) })).toHaveProperty("pronouns");
    expect(errors({ major: "x".repeat(81) })).toHaveProperty("major");
    expect(errors({ bio: "x".repeat(1001) })).toHaveProperty("bio");
    expect(errors({ bio: "x".repeat(1000) })).toEqual({});
    expect(errors({ gradYear: 28 })).toHaveProperty("gradYear");
    expect(errors({ gradYear: 2028.5 })).toHaveProperty("gradYear");
    expect(errors({ gradYear: "2028" })).toHaveProperty("gradYear");
    expect(errors({ timezone: "Mars/Olympus_Mons" })).toHaveProperty("timezone");
    expect(errors({ timezone: "'; DROP TABLE" })).toHaveProperty("timezone");
  });

  it("refuses fields a user may not set on their profile", () => {
    for (const extra of [{ email: "x@example.edu" }, { emailVerified: new Date() }, { title: "President" }, { avatar: {} }]) {
      expect(profileInputSchema.safeParse({ ...valid, ...extra }).success).toBe(false);
    }
  });

  it("validates links and reports the failing row", () => {
    expect(
      profileLinksSchema.parse({ links: [{ kind: "github", url: "github.com/ada" }] }),
    ).toEqual({ links: [{ kind: "github", url: "https://github.com/ada" }] });

    const bad = profileLinksSchema.safeParse({
      links: [
        { kind: "github", url: "https://github.com/ada" },
        { kind: "github", url: "https://gitlab.com/ada" },
      ],
    });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(profileFieldErrors(bad.error)).toHaveProperty("links.1.url");

    const kind = profileLinksSchema.safeParse({ links: [{ kind: "myspace", url: "https://myspace.com/a" }] });
    expect(kind.success).toBe(false);

    const tooMany = profileLinksSchema.safeParse({
      links: Array.from({ length: MAX_LINKS + 1 }, () => ({ kind: "website", url: "https://ada.dev" })),
    });
    expect(tooMany.success).toBe(false);
    expect(profileLinksSchema.parse({})).toEqual({ links: [] });
  });
});

describe("timezones", () => {
  it("accepts IANA zones and refuses anything else", () => {
    expect(isValidTimeZone("America/New_York")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Etc/GMT+5")).toBe(true);
    expect(isValidTimeZone("Nowhere/Special")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone(null)).toBe(false);
    expect(isValidTimeZone("../../etc/passwd")).toBe(false);
  });

  it("uses the user's zone when set, else the org's", () => {
    const org = { timezone: "America/New_York" };
    expect(effectiveTimezone({ timezone: null }, org)).toBe("America/New_York");
    expect(effectiveTimezone({ timezone: "Europe/Paris" }, org)).toBe("Europe/Paris");
    expect(effectiveTimezone({ timezone: "Not/AZone" }, org)).toBe("America/New_York");
  });

  it("lists zones for the picker", () => {
    const zones = listTimeZones();
    expect(zones).toContain("UTC");
    expect(zones).toContain("America/New_York");
    expect(zones.every(isValidTimeZone)).toBe(true);
  });
});

describe("profile links (hrefs)", () => {
  it("builds the section, directory, person and open-task URLs", () => {
    expect(profileHref("cbc")).toBe("/app/cbc/profile");
    expect(profileHref("cbc", "notifications")).toBe("/app/cbc/profile#notifications");
    expect(peopleHref("cbc")).toBe("/app/cbc/people");
    expect(peopleHref("cbc", { q: "VP ops", page: 2 })).toBe("/app/cbc/people?q=VP+ops&page=2");
    expect(peopleHref("cbc", { page: 1 })).toBe("/app/cbc/people");
    expect(personHref("cbc", "u_1")).toBe("/app/cbc/people/u_1");
    expect(personTasksHref("cbc", "u_1")).toBe("/app/cbc/tasks?view=table&assignee=u_1");
  });
});
