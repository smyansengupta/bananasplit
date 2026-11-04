import { describe, expect, it } from "vitest";

import { friendlyTimeZone } from "./timezones";

describe("friendlyTimeZone", () => {
  it("names a zone the way people say it, with its city", () => {
    const label = friendlyTimeZone("America/New_York");
    expect(label).toContain("New York");
    expect(label).not.toContain("/");
    expect(label).not.toContain("_");
  });

  it("keeps UTC as it is and never throws on an unknown zone", () => {
    expect(friendlyTimeZone("UTC")).toBe("UTC");
    expect(friendlyTimeZone("Nowhere/Some_Place")).toBe("Some Place");
  });
});
