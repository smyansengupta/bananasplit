import { describe, expect, it } from "vitest";

import { parseGoogleConfig, targetCalendarFor } from "./config";

const live = { deletedAt: null, mergedIntoId: null };

describe("parseGoogleConfig", () => {
  it("has no default public calendar: unset and opted out both mean none", () => {
    // Just connected, "Don't mirror public events", and values that are not calendar ids.
    for (const config of [
      null,
      {},
      { publicCalendarId: null },
      { publicCalendarId: "" },
      { publicCalendarId: "  " },
      { publicCalendarId: "a/b" },
    ]) {
      expect(parseGoogleConfig(config)).toEqual({
        publicCalendarId: null,
        internalCalendarId: null,
      });
    }
  });

  it("keeps an internal calendar without a public one, and never the public one as internal", () => {
    expect(
      parseGoogleConfig({ publicCalendarId: null, internalCalendarId: "board@group" }),
    ).toEqual({
      publicCalendarId: null,
      internalCalendarId: "board@group",
    });
    expect(
      parseGoogleConfig({ publicCalendarId: "club@group", internalCalendarId: "club@group" }),
    ).toEqual({
      publicCalendarId: "club@group",
      internalCalendarId: null,
    });
  });
});

describe("targetCalendarFor", () => {
  it("puts each kind of event on its own calendar, or nowhere without one", () => {
    const both = parseGoogleConfig({
      publicCalendarId: "club@group",
      internalCalendarId: "board@group",
    });
    expect(targetCalendarFor({ ...live, visibility: "PUBLIC" }, both)).toBe("club@group");
    expect(targetCalendarFor({ ...live, visibility: "INTERNAL" }, both)).toBe("board@group");

    const optedOut = parseGoogleConfig({
      publicCalendarId: null,
      internalCalendarId: "board@group",
    });
    expect(targetCalendarFor({ ...live, visibility: "PUBLIC" }, optedOut)).toBeNull();
    expect(targetCalendarFor({ ...live, visibility: "INTERNAL" }, optedOut)).toBe("board@group");

    expect(
      targetCalendarFor({ ...live, visibility: "PUBLIC", deletedAt: new Date() }, both),
    ).toBeNull();
  });
});
