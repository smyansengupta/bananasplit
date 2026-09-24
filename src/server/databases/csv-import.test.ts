// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

// The import module reaches the member reads through the contact resolver.
vi.mock("@/lib/auth/session", () => ({ requireUser: vi.fn(), getSession: vi.fn() }));

import { parseCsv, parseLocalDateTime, previewSignups } from "./csv-import";

const TZ = "America/New_York";

describe("parseCsv", () => {
  it("handles quotes, doubled quotes, CRLF and a BOM", () => {
    const text = '﻿name,note\r\n"Park, Ada","She said ""hi"""\r\nBo,\r\n';
    expect(parseCsv(text)).toEqual([
      ["name", "note"],
      ["Park, Ada", 'She said "hi"'],
      ["Bo", ""],
    ]);
  });

  it("drops blank lines", () => {
    expect(parseCsv("a\n\n\nb\n")).toEqual([["a"], ["b"]]);
  });
});

describe("parseLocalDateTime", () => {
  it("reads a bare date or time as the org's local time", () => {
    expect(parseLocalDateTime("2026-09-10 18:02", TZ)?.toISOString()).toBe("2026-09-10T22:02:00.000Z");
    expect(parseLocalDateTime("2026-09-10T18:02", TZ)?.toISOString()).toBe("2026-09-10T22:02:00.000Z");
    expect(parseLocalDateTime("2026-09-10", TZ)?.toISOString()).toBe("2026-09-10T04:00:00.000Z");
  });

  it("honours an explicit offset", () => {
    expect(parseLocalDateTime("2026-09-10T18:02:00Z", TZ)?.toISOString()).toBe("2026-09-10T18:02:00.000Z");
  });

  it("refuses anything else", () => {
    expect(parseLocalDateTime("last tuesday", TZ)).toBeNull();
    expect(parseLocalDateTime("", TZ)).toBeNull();
  });
});

describe("previewSignups", () => {
  const now = new Date("2026-09-24T16:00:00Z");

  it("needs a name column", () => {
    expect(previewSignups(TZ, "email\nx@y.edu\n", now).issues[0].message).toMatch(/name column/i);
  });

  it("reads answers, derives the term from the local signup date and strips the formula guard", () => {
    const csv =
      "name,email,class_year,signed_up_at,colleges,interests\n" +
      "'Ada Park,ada@husky.example.edu,Second,2026-09-05,khoury;dmsb,workshops;hackathons\n";
    const preview = previewSignups(TZ, csv, now);
    expect(preview.issues).toEqual([]);
    expect(preview.rows[0]).toMatchObject({
      name: "Ada Park",
      email: "ada@husky.example.edu",
      classYear: "second",
      term: "fall-2026",
    });
    expect(preview.rows[0].answers).toEqual({
      colleges: ["khoury", "dmsb"],
      meet_days: [],
      interests: ["workshops", "hackathons"],
    });
  });

  it("reports the bad rows by line and keeps the good ones", () => {
    const csv = "name,email,signed_up_at\nAda,ada@husky.example.edu,2026-09-05\n,nobody@x.edu,2026-09-05\nBo,not-an-email,2026-09-05\nCy,cy@x.edu,whenever\n";
    const preview = previewSignups(TZ, csv, now);
    expect(preview.rows.map((r) => r.name)).toEqual(["Ada"]);
    expect(preview.issues.map((i) => i.line)).toEqual([3, 4, 5]);
    expect(preview.total).toBe(4);
  });

  it("accepts an explicit term and refuses a malformed one", () => {
    expect(previewSignups(TZ, "name,term\nAda,spring-2027\n", now).rows[0].term).toBe("spring-2027");
    expect(previewSignups(TZ, "name,term\nAda,summer\n", now).issues[0].message).toMatch(/fall-YYYY/);
  });

  it("refuses a file above the row cap", () => {
    const csv = ["name", ...Array.from({ length: 5001 }, (_, i) => `P${i}`)].join("\n");
    expect(previewSignups(TZ, csv, now).issues[0].message).toMatch(/at most 5000 rows/i);
  });
});
