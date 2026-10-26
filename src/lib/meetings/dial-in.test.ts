import { describe, expect, it } from "vitest";

import { parseDialIn } from "./dial-in";

/**
 * `Event.conferenceDialIn` is JSON a provider's answer was stored as. The
 * meeting page reads it back without trusting its shape.
 */
describe("parseDialIn", () => {
  it("reads the numbers a provider returned", () => {
    expect(
      parseDialIn([
        { country: "US", number: "+1 646 558 8656", pin: null },
        { country: "GB", number: "+44 203 481 5240", pin: "5551" },
      ]),
    ).toEqual([
      { country: "US", number: "+1 646 558 8656", pin: null },
      { country: "GB", number: "+44 203 481 5240", pin: "5551" },
    ]);
  });

  it("fills in a missing country or PIN with null", () => {
    expect(parseDialIn([{ number: "+1 646 558 8656" }])).toEqual([
      { country: null, number: "+1 646 558 8656", pin: null },
    ]);
  });

  it("ignores a country or PIN that is not text", () => {
    expect(parseDialIn([{ country: 1, number: "+1 646 558 8656", pin: { x: 1 } }])).toEqual([
      { country: null, number: "+1 646 558 8656", pin: null },
    ]);
  });

  it("is empty for anything that is not a list", () => {
    for (const value of [null, undefined, "+1 646 558 8656", 7, true, {}, { number: "+1 646" }]) {
      expect(parseDialIn(value)).toEqual([]);
    }
  });

  it("drops entries that are not objects with a text number", () => {
    expect(
      parseDialIn([
        null,
        "+1 646 558 8656",
        42,
        ["+1 646"],
        {},
        { number: 6465588656 },
        { number: "" },
        { number: "   " },
        { country: "US", number: "+1 646 558 8656" },
      ]),
    ).toEqual([{ country: "US", number: "+1 646 558 8656", pin: null }]);
  });
});
