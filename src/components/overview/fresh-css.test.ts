import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * fresh.tsx draws with classes that live in globals.css. Without them a
 * changed number shows both values side by side ("3435"), so a CSS tidy
 * that drops them must fail here.
 */
const css = readFileSync(path.resolve(__dirname, "../../app/globals.css"), "utf8");

describe("Home's fresh-change styles", () => {
  it.each([".tick-roll", ".row-arrive"])("keeps %s in globals.css", (selector) => {
    expect(css).toContain(selector);
  });

  it("rolls a changed number in one line's height, not both side by side", () => {
    expect(css).toMatch(/\.tick-roll\s*\{[^}]*overflow:\s*hidden/);
  });
});
