import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { FALLBACK_CARDS } from "@/lib/metadata/share";

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

  it("writes every card into a route's metadata file or public/og", () => {
    for (const [card, { targets, alt }] of Object.entries(manifest)) {
      expect(targets.length, card).toBeGreaterThan(0);
      for (const target of targets) {
        expect(target, card).toMatch(
          /^src\/app\/(.*\/)?(opengraph|twitter)-image\.png$|^public\/og\/[a-z]+\.png$/,
        );
      }
      // The alt text is read aloud by a screen reader in place of the card.
      expect(alt.length, card).toBeGreaterThan(20);
    }
  });

  it("captures each club page's fallback card where share.ts points, with the same alt", () => {
    for (const [card, { url, alt }] of Object.entries(FALLBACK_CARDS)) {
      expect(manifest[card]?.targets, card).toContain(`public${url}`);
      expect(manifest[card]?.alt, card).toBe(alt);
    }
  });

  it("puts no drawn card beside a club page, where it would hide the club's logo", () => {
    // A file-based opengraph-image outranks generateMetadata's images.
    for (const route of ["invite/[token]", "join/[code]", "poll/[pollId]", "e/[slug]"]) {
      for (const file of ["opengraph-image.png", "twitter-image.png"]) {
        const where = path.join(process.cwd(), "src/app", route, file);
        expect(existsSync(where), `${route}/${file}`).toBe(false);
      }
    }
  });
});
