import { describe, expect, it } from "vitest";

import { withoutStaleWebsiteData } from "./website-sync";

const list = [
  { key: "sessions", kind: "SESSIONS" as const },
  { key: "attendance", kind: "ATTENDANCE" as const },
  { key: "signups", kind: "SIGNUPS" as const },
  { key: "ballots", kind: "BALLOTS" as const },
  { key: "people", kind: "PEOPLE" as const },
  { key: "roster", kind: "CUSTOM" as const },
];

describe("withoutStaleWebsiteData", () => {
  it("keeps every database while the website sync is connected", () => {
    expect(withoutStaleWebsiteData(list, true).map((d) => d.key)).toEqual(list.map((d) => d.key));
  });

  it("leaves out only the ones the sync alone fills when it isn't", () => {
    expect(withoutStaleWebsiteData(list, false).map((d) => d.key)).toEqual([
      "sessions",
      "attendance",
      "signups",
      "people",
      "roster",
    ]);
  });
});
