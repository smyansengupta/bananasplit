// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CBC_OPEN_ITEMS, CBC_POSITIONS } from "@/server/bootstrap/cbc-template";

import expected from "./__fixtures__/expected.json";
import { markdownToText } from "./__fixtures__/generate";

/**
 * The parser fixtures agree with the seed: expected.json (the normalized
 * CBC parse) holds exactly the positions the seed publishes as version 1,
 * and the generated .txt still matches the markdown.
 */

const dir = path.resolve("src/lib/org-chart/__fixtures__");

describe("CBC fixtures", () => {
  it("expected.json equals the seed template's chart", () => {
    expect(expected.positions.map((p) => p.key)).toEqual(CBC_POSITIONS.map((p) => p.key));
    for (const seed of CBC_POSITIONS) {
      const got = expected.positions.find((p) => p.key === seed.key);
      expect(got).toMatchObject({
        title: seed.title,
        personName: seed.personName,
        reportsTo: seed.reportsTo,
        isOpen: seed.isOpen,
        isAdvisor: seed.isAdvisor,
        responsibilities: seed.responsibilities,
        decidesAlone: seed.decidesAlone,
      });
    }
    expect(expected.openItems).toEqual(CBC_OPEN_ITEMS);
  });

  it("the .txt fixture is the markdown without markers", () => {
    const md = readFileSync(path.join(dir, "cbc-fall-2026.md"), "utf8");
    expect(readFileSync(path.join(dir, "cbc-fall-2026.txt"), "utf8")).toBe(markdownToText(md));
  });
});
