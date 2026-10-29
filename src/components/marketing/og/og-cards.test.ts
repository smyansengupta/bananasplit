import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { OG_CARDS } from "./og-cards";

/**
 * The drawings and the capture manifest are two files that have to agree:
 * a card with nowhere to go is never captured, and a row pointing at a card
 * that no longer exists fails the run halfway through.
 */
const manifest = JSON.parse(
  readFileSync(path.join(process.cwd(), "scripts/og-cards.json"), "utf8"),
) as Record<string, { targets: string[]; alt: string }>;

describe("link-preview cards", () => {
  it("draws exactly the cards the manifest captures", () => {
    expect(Object.keys(OG_CARDS).sort()).toEqual(Object.keys(manifest).sort());
  });

  it("writes every card into a route's own metadata file", () => {
    for (const [card, { targets, alt }] of Object.entries(manifest)) {
      expect(targets.length, card).toBeGreaterThan(0);
      for (const target of targets) {
        expect(target, card).toMatch(
          /^src\/app\/.*\/(opengraph|twitter)-image\.png$|^src\/app\/(opengraph|twitter)-image\.png$/,
        );
      }
      // The alt text is read aloud by a screen reader in place of the card.
      expect(alt.length, card).toBeGreaterThan(20);
    }
  });
});
