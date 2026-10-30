import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  FALLBACK_CARDS,
  PRODUCT_CARDS,
  SIGN_IN_CARD,
  type FallbackCard,
} from "@/lib/metadata/share";

import { OG_CARDS } from "./og-cards";

/**
 * The drawings and the capture manifest are two files that have to agree:
 * a card with nowhere to go is never captured, and a row pointing at a card
 * that no longer exists fails the run halfway through.
 */
const manifest = JSON.parse(
  readFileSync(path.join(process.cwd(), "scripts/og-cards.json"), "utf8"),
) as Record<string, { targets: string[]; alt: string; title: string; group: string }>;

describe("link-preview cards", () => {
  it("draws exactly the cards the manifest captures", () => {
    expect(Object.keys(OG_CARDS).sort()).toEqual(Object.keys(manifest).sort());
  });

  it("writes every card into a route's metadata file or public/og", () => {
    for (const [card, { targets, alt }] of Object.entries(manifest)) {
      expect(targets.length, card).toBeGreaterThan(0);
      for (const target of targets) {
        expect(target, card).toMatch(
          /^src\/app\/(.*\/)?(opengraph|twitter)-image\.png$|^public\/og\/[a-z-]+\.png$/,
        );
      }
      // The alt text is read aloud by a screen reader in place of the card.
      expect(alt.length, card).toBeGreaterThan(20);
    }
  });

  it("captures every card share.ts names where it points, with the same alt", () => {
    const named: [string, FallbackCard][] = [
      ...Object.entries(FALLBACK_CARDS),
      ...Object.entries(PRODUCT_CARDS).map(([slug, card]): [string, FallbackCard] => [
        `product-${slug}`,
        card,
      ]),
      ["sign-in", SIGN_IN_CARD],
    ];
    for (const [card, { url, alt }] of named) {
      expect(manifest[card]?.targets, card).toContain(`public${url}`);
      expect(manifest[card]?.alt, card).toBe(alt);
    }
  });

  it("gives every card in public/og a name in share.ts, so none is drawn and never shown", () => {
    const urls = new Set([
      ...Object.values(FALLBACK_CARDS).map((c) => c.url),
      ...Object.values(PRODUCT_CARDS).map((c) => c.url),
      SIGN_IN_CARD.url,
    ]);
    for (const [card, { targets }] of Object.entries(manifest)) {
      for (const target of targets.filter((t) => t.startsWith("public/og/"))) {
        expect(urls.has(target.slice("public".length)), `${card}: ${target}`).toBe(true);
      }
    }
  });

  it("puts no drawn card beside a page that picks its picture in metadata", () => {
    // A file-based opengraph-image outranks generateMetadata's images.
    const chosenInMetadata = [
      "invite/[token]",
      "join/[code]",
      "poll/[pollId]",
      "e/[slug]",
      "product/[slug]",
      "sign-in",
    ];
    for (const route of chosenInMetadata) {
      for (const file of ["opengraph-image.png", "twitter-image.png"]) {
        const where = path.join(process.cwd(), "src/app", route, file);
        expect(existsSync(where), `${route}/${file}`).toBe(false);
      }
    }
  });
});
