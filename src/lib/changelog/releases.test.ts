import { describe, expect, it } from "vitest";

import { latestRelease, RELEASES } from "./releases";

const SEMVER = /^\d+\.\d+\.\d+$/;

function parts(version: string): number[] {
  return version.split(".").map(Number);
}

function compare(a: string, b: string): number {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
  return 0;
}

describe("releases", () => {
  it("lists unique semver versions, newest first", () => {
    for (const r of RELEASES) expect(r.version).toMatch(SEMVER);
    for (let i = 1; i < RELEASES.length; i++) {
      expect(compare(RELEASES[i - 1]!.version, RELEASES[i]!.version)).toBeGreaterThan(0);
      expect(RELEASES[i - 1]!.date >= RELEASES[i]!.date).toBe(true);
    }
  });

  it("has valid dates and at least one item in every section", () => {
    for (const r of RELEASES) {
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.sections.length).toBeGreaterThan(0);
      for (const s of r.sections) expect(s.items.length).toBeGreaterThan(0);
    }
  });

  it("reports the first entry as the latest", () => {
    expect(latestRelease()).toBe(RELEASES[0]);
  });
});
