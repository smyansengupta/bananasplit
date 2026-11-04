import { describe, expect, it } from "vitest";

import { meetingTypeColor, parseMeetingTypes } from "./meeting-types";

describe("meeting types", () => {
  it("reads the saved list and drops anything that isn't a named, coloured type", () => {
    expect(
      parseMeetingTypes([
        { name: " Standup ", color: "#22aa66" },
        { name: "", color: "#000000" },
        { name: "1:1", color: "red" },
        "All-hands",
      ]),
    ).toEqual([{ name: "Standup", color: "#22aa66" }]);
    expect(parseMeetingTypes(null)).toEqual([]);
  });

  it("colours a meeting by its type's name, any case, and not once the type is gone", () => {
    const types = [{ name: "Standup", color: "#22aa66" }];
    expect(meetingTypeColor(types, "standup")).toBe("#22aa66");
    expect(meetingTypeColor(types, "Offsite")).toBeNull();
    expect(meetingTypeColor(types, null)).toBeNull();
  });
});
