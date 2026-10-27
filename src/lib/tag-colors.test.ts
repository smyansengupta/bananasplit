import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { contrastRatio, hexToOklch, mixOklab } from "@/lib/theme/color";
import { deriveTokens } from "@/lib/theme/derive";
import { THEME_PRESETS } from "@/lib/theme/presets";

import { TAG_COLOR_NAMES, TAG_COLORS, tagColorOf, tagToken } from "./tag-colors";

/**
 * The tag palette is fixed rather than derived, so nothing else checks it.
 * These are the guarantees chart.ts gives a data series, applied to a
 * label instead: a colour has to read as text beside the word it labels,
 * on the page, on a card and on its own tint, under every preset the app
 * ships. A tag sits next to its own name, so the bar is AA text (4.5:1),
 * not the 3:1 a bare mark would take.
 */

const css = readFileSync(path.resolve(__dirname, "../app/globals.css"), "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`\n${selector} {`);
  expect(start, `${selector} block`).toBeGreaterThanOrEqual(0);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("\n}", start));
  return Object.fromEntries(
    [...body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
  );
}

const PALETTE = { light: block(":root"), dark: block(".dark") };

const TEXT_MIN = 4.5;
/** Below this a hue reads as a grey rather than as a colour. */
const CHROMA_FLOOR = 0.07;
/** Two colours next to each other in a picker want telling apart. */
const HUE_GAP_MIN = 25;

describe("tag colours", () => {
  it("ships a light and a dark value for every name", () => {
    for (const name of TAG_COLORS) {
      for (const mode of ["light", "dark"] as const) {
        expect(PALETTE[mode][`tag-${name}`], `--tag-${name} in ${mode}`).toMatch(
          /^#[0-9a-f]{6}$/,
        );
      }
    }
    expect(Object.keys(TAG_COLOR_NAMES).sort()).toEqual([...TAG_COLORS].sort());
  });

  it("reads as text on every preset's page, card and own tint", () => {
    for (const preset of THEME_PRESETS) {
      for (const mode of ["light", "dark"] as const) {
        const t = deriveTokens(preset[mode], { glow: preset.glow });
        for (const name of TAG_COLORS) {
          const hex = PALETTE[mode][`tag-${name}`]!;
          const where = `${preset.id} ${mode} ${name}`;
          expect(contrastRatio(hex, t.background), `${where} on page`).toBeGreaterThanOrEqual(
            TEXT_MIN,
          );
          expect(contrastRatio(hex, t.card), `${where} on card`).toBeGreaterThanOrEqual(TEXT_MIN);
          // A tile washed in the colour, with the colour as its label.
          const tint = mixOklab(t.card, hex, 0.15);
          expect(contrastRatio(hex, tint), `${where} on its tint`).toBeGreaterThanOrEqual(
            TEXT_MIN,
          );
        }
      }
    }
  });

  it("keeps every name a colour rather than a grey", () => {
    for (const mode of ["light", "dark"] as const) {
      for (const name of TAG_COLORS) {
        const c = hexToOklch(PALETTE[mode][`tag-${name}`]!);
        expect(c.C, `--tag-${name} ${mode} chroma`).toBeGreaterThanOrEqual(CHROMA_FLOOR);
      }
    }
  });

  it("separates adjacent hues", () => {
    for (const mode of ["light", "dark"] as const) {
      const hues = TAG_COLORS.map((n) => hexToOklch(PALETTE[mode][`tag-${n}`]!).h).sort(
        (a, b) => a - b,
      );
      for (let i = 0; i < hues.length; i++) {
        const next = hues[(i + 1) % hues.length]!;
        const gap = (next - hues[i]! + 360) % 360;
        expect(gap, `${mode} hue gap at ${i}`).toBeGreaterThan(HUE_GAP_MIN);
      }
    }
  });

  it("leaves the chart palette alone", () => {
    // Charts and meters still take the derived slots; the tag palette is a
    // separate thing that happens to sit beside them.
    for (const mode of ["light", "dark"] as const) {
      for (const slot of [1, 2, 3, 4, 5]) {
        expect(PALETTE[mode][`chart-${slot}`], `--chart-${slot} ${mode}`).toMatch(
          /^#[0-9a-f]{6}$/,
        );
      }
    }
  });

  it("reads a stored chart slot as a name, and anything else as none", () => {
    expect(tagColorOf("chart-1")).toBe("navy");
    expect(tagColorOf("chart-5")).toBe("plum");
    expect(tagColorOf("plum")).toBe("plum");
    expect(tagColorOf(null)).toBeNull();
    expect(tagColorOf("chart-9")).toBeNull();
    expect(tagToken("chart-2")).toBe("--tag-rust");
    expect(tagToken("teal")).toBe("--tag-teal");
    expect(tagToken(null)).toBe("--muted-foreground");
  });
});
