import { describe, expect, it } from "vitest";

import {
  BODY_MAX,
  byline,
  canManageAnnouncement,
  canRestoreAnnouncement,
  cleanAnnouncement,
  postedWhen,
  recapWindowStart,
  seenPercent,
  signupInsight,
  TITLE_MAX,
} from "./rules";

describe("cleanAnnouncement", () => {
  it("squeezes the title to one line and keeps the body's lines", () => {
    expect(
      cleanAnnouncement({ title: "  Fall   Social\nFriday ", body: "Bring\r\na friend  " }),
    ).toEqual({
      ok: true,
      draft: { title: "Fall Social Friday", body: "Bring\na friend" },
    });
  });

  it("asks for a title, and keeps both within their limits", () => {
    expect(cleanAnnouncement({ title: "   ", body: "x" })).toEqual({
      ok: false,
      error: "Give it a title.",
    });
    expect(cleanAnnouncement(null)).toMatchObject({ ok: false });
    expect(cleanAnnouncement({ title: "x".repeat(TITLE_MAX + 1), body: "" })).toMatchObject({
      ok: false,
    });
    expect(cleanAnnouncement({ title: "Hi", body: "x".repeat(BODY_MAX + 1) })).toMatchObject({
      ok: false,
    });
    expect(cleanAnnouncement({ title: "Hi" })).toEqual({
      ok: true,
      draft: { title: "Hi", body: "" },
    });
  });
});

describe("canManageAnnouncement", () => {
  it("lets the author and owners and admins change a post, and nobody else", () => {
    const post = { authorId: "u_author" };
    expect(canManageAnnouncement({ userId: "u_author", role: "MEMBER" }, post)).toBe(true);
    expect(canManageAnnouncement({ userId: "u_x", role: "ADMIN" }, post)).toBe(true);
    expect(canManageAnnouncement({ userId: "u_x", role: "OWNER" }, post)).toBe(true);
    expect(canManageAnnouncement({ userId: "u_x", role: "MEMBER" }, post)).toBe(false);
    expect(canManageAnnouncement({ userId: "u_x", role: "TREASURER" }, post)).toBe(false);
  });

  it("a post whose author is gone is the admins' alone", () => {
    expect(canManageAnnouncement({ userId: "u_x", role: "MEMBER" }, { authorId: null })).toBe(
      false,
    );
    expect(canManageAnnouncement({ userId: "u_x", role: "ADMIN" }, { authorId: null })).toBe(true);
  });
});

describe("canRestoreAnnouncement", () => {
  it("puts a post back for whoever took it down, or an owner or admin", () => {
    const post = { deletedById: "u_admin" };
    expect(canRestoreAnnouncement({ userId: "u_admin", role: "ADMIN" }, post)).toBe(true);
    expect(canRestoreAnnouncement({ userId: "u_x", role: "OWNER" }, post)).toBe(true);
    expect(canRestoreAnnouncement({ userId: "u_author", role: "MEMBER" }, post)).toBe(false);
    expect(
      canRestoreAnnouncement({ userId: "u_author", role: "MEMBER" }, { deletedById: "u_author" }),
    ).toBe(true);
    expect(canRestoreAnnouncement({ userId: "u_x", role: "MEMBER" }, { deletedById: null })).toBe(
      false,
    );
  });
});

describe("seenPercent", () => {
  it("is the share of members, clamped and safe with nobody", () => {
    expect(seenPercent(96, 142)).toBe(68);
    expect(seenPercent(0, 0)).toBe(0);
    expect(seenPercent(10, 5)).toBe(100);
  });
});

describe("signupInsight", () => {
  const posted = new Date("2026-10-27T15:00:00Z");

  it("says how many signed up in the day after the post", () => {
    expect(signupInsight(22, "Fall Social", posted, new Date("2026-10-30T00:00:00Z"))).toEqual({
      count: 22,
      rest: "people signed up for Fall Social in the day after this was posted.",
    });
  });

  it("says since, while the post is less than a day old, and one person is a person", () => {
    expect(signupInsight(1, "Workshop 8", posted, new Date("2026-10-27T20:00:00Z"))).toEqual({
      count: 1,
      rest: "person signed up for Workshop 8 since this was posted.",
    });
  });

  it("says nothing when nobody signed up", () => {
    expect(signupInsight(0, "Fall Social", posted, new Date("2026-10-30T00:00:00Z"))).toBeNull();
  });
});

describe("postedWhen and byline", () => {
  const now = new Date("2026-11-01T16:00:00Z"); // Sunday, Nov 1 in New York

  it("words the day in the organization's time zone", () => {
    const tz = "America/New_York";
    expect(postedWhen(new Date("2026-11-01T13:00:00Z"), now, tz)).toBe("today");
    expect(postedWhen(new Date("2026-10-31T13:00:00Z"), now, tz)).toBe("yesterday");
    expect(postedWhen(new Date("2026-10-27T13:00:00Z"), now, tz)).toBe("Tue");
    expect(postedWhen(new Date("2026-10-20T13:00:00Z"), now, tz)).toBe("Oct 20");
    // 02:00 UTC on Nov 1 is still Oct 31 in New York.
    expect(postedWhen(new Date("2026-11-01T02:00:00Z"), now, tz)).toBe("yesterday");
  });

  it("names the author by first name", () => {
    expect(byline("Kristine Park", "Tue")).toBe("Kristine, Tue");
    expect(byline(null, "today")).toBe("A former member, today");
  });
});

describe("recapWindowStart", () => {
  const NY = "America/New_York";

  it("opens at Friday midnight in the organization's time zone and stays open to Sunday", () => {
    // Fri Oct 30 2026, 00:00 in New York is 04:00 UTC (daylight time).
    const friday = new Date("2026-10-30T04:00:00Z");
    expect(recapWindowStart(new Date("2026-10-30T04:00:00Z"), NY)).toEqual(friday);
    expect(recapWindowStart(new Date("2026-10-31T15:00:00Z"), NY)).toEqual(friday);
    // Sun Nov 1, 23:59 in New York (standard time from 2 AM that day).
    expect(recapWindowStart(new Date("2026-11-02T04:59:00Z"), NY)).toEqual(friday);
  });

  it("is closed Monday to Thursday", () => {
    // Mon Nov 2, 00:00 in New York.
    expect(recapWindowStart(new Date("2026-11-02T05:00:00Z"), NY)).toBeNull();
    expect(recapWindowStart(new Date("2026-11-04T17:00:00Z"), NY)).toBeNull();
    // Thu Oct 29, 23:59 in New York.
    expect(recapWindowStart(new Date("2026-10-30T03:59:00Z"), NY)).toBeNull();
  });

  it("goes by the given time zone's day, not UTC's", () => {
    // 02:00 UTC Friday is still Thursday evening in New York, Friday in UTC.
    const at = new Date("2026-10-30T02:00:00Z");
    expect(recapWindowStart(at, NY)).toBeNull();
    expect(recapWindowStart(at, "UTC")).toEqual(new Date("2026-10-30T00:00:00Z"));
    // 22:00 UTC Sunday is already Monday in Tokyo.
    expect(recapWindowStart(new Date("2026-11-01T22:00:00Z"), "Asia/Tokyo")).toBeNull();
    expect(recapWindowStart(new Date("2026-11-01T22:00:00Z"), "UTC")).toEqual(
      new Date("2026-10-30T00:00:00Z"),
    );
  });
});
