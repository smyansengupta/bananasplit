import { describe, expect, it } from "vitest";

import { everyWord } from "./where";

const fields = (c: { contains: string }) => [{ title: c }, { body: c }];

describe("everyWord", () => {
  it("needs every word, each in any of the fields", () => {
    expect(everyWord("Budget  spring!", fields)).toEqual({
      AND: [
        {
          OR: [
            { title: { contains: "budget", mode: "insensitive" } },
            { body: { contains: "budget", mode: "insensitive" } },
          ],
        },
        {
          OR: [
            { title: { contains: "spring", mode: "insensitive" } },
            { body: { contains: "spring", mode: "insensitive" } },
          ],
        },
      ],
    });
  });

  it("filters nothing when nothing was typed", () => {
    expect(everyWord("   ", fields)).toBeUndefined();
    expect(everyWord(undefined, fields)).toBeUndefined();
    expect(everyWord([], fields)).toBeUndefined();
  });

  it("matches text with no words as it is, instead of returning everything", () => {
    expect(everyWord(" # ", fields)).toEqual({
      OR: [
        { title: { contains: "#", mode: "insensitive" } },
        { body: { contains: "#", mode: "insensitive" } },
      ],
    });
  });
});
