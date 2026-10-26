import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CBC_THEME } from "@/server/bootstrap/cbc-template";

import { contrastRatio, hexToOklch } from "./color";
import { deriveTokens, TOKEN_NAMES } from "./derive";
import {
  CBC_PRESET,
  BANANA_CREAM_PRESET,
  BANANA_NIGHT_PRESET,
  DEFAULT_PRESET,
  UNTHEMED_PRESET,
  isFormerDefault,
  findPreset,
  GRAPHITE_PRESET,
  matchPreset,
  THEME_PRESETS,
} from "./presets";
import { HEX_RE } from "./validate";

describe("presets", () => {
  it("have unique slug ids and strict-hex palettes", () => {
    const ids = THEME_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain("custom");
    for (const preset of THEME_PRESETS) {
      expect(preset.id).toMatch(/^[a-z0-9-]{1,32}$/);
      for (const value of [...Object.values(preset.light), ...Object.values(preset.dark)]) {
        expect(value).toMatch(HEX_RE);
        expect(value).toBe(value.toLowerCase());
      }
    }
  });

  it("include Default, Claude Builders Club and at least two generic presets", () => {
    // Graphite leads: it is what a space gets with nothing saved.
    expect(THEME_PRESETS[0]).toBe(UNTHEMED_PRESET);
    expect(THEME_PRESETS).toContain(DEFAULT_PRESET);
    expect(findPreset("cbc")).toBe(CBC_PRESET);
    expect(THEME_PRESETS.length).toBeGreaterThanOrEqual(4);
  });

  it("keep the CBC preset equal to the seeded workspace theme", () => {
    expect(CBC_THEME.preset).toBe(CBC_PRESET.id);
    expect(CBC_PRESET.light).toEqual(CBC_THEME.light);
    expect(CBC_PRESET.dark).toEqual(CBC_THEME.dark);
  });

  it("follow the club website's brand for Claude Builders Club", () => {
    // DESIGN.md: warm paper, near-black ink, terracotta words, coral fill.
    expect(CBC_PRESET.light).toMatchObject({
      background: "#faf9f5",
      text: "#141413",
      primary: "#a34a2a",
      accent: "#d97757",
    });
    expect(CBC_PRESET.dark).toMatchObject({ background: "#141413", primary: "#d97757" });
    // Dark mode: coral primary with an ink label.
    expect(deriveTokens(CBC_PRESET.dark)["primary-foreground"]).toBe("#141413");
  });

  it("keep the pre-Bananasplit Default greys as Graphite", () => {
    expect(findPreset("graphite")).toBe(GRAPHITE_PRESET);
    expect(GRAPHITE_PRESET.light).toEqual({
      primary: "#171717",
      accent: "#737373",
      background: "#ffffff",
      surface: "#ffffff",
      text: "#0a0a0a",
    });
    expect(GRAPHITE_PRESET.dark).toMatchObject({ background: "#0a0a0a", primary: "#e5e5e5" });
  });

  it("keep the Banana cream highlighter a fill and its primary clear of the destructive red", () => {
    // Banana on cream is a highlighter, never text; the ink primary reads as text.
    expect(
      contrastRatio(BANANA_CREAM_PRESET.light.accent, BANANA_CREAM_PRESET.light.background),
    ).toBeLessThan(3);
    expect(
      contrastRatio(BANANA_CREAM_PRESET.light.primary, BANANA_CREAM_PRESET.light.background),
    ).toBeGreaterThan(4.5);
    const light = deriveTokens(BANANA_CREAM_PRESET.light);
    const hue = (hex: string) => hexToOklch(hex).h;
    const gap = Math.abs(((hue(light.primary) - hue(light.destructive) + 540) % 360) - 180);
    expect(gap).toBeGreaterThan(20);
  });

  it("keep the cream look as Banana cream: ink on cream with a banana highlighter", () => {
    expect(BANANA_CREAM_PRESET.name).toBe("Banana cream");
    expect(BANANA_CREAM_PRESET.light).toEqual({
      primary: "#1c1810",
      accent: "#f2c230",
      background: "#f7f2e6",
      surface: "#fffdf7",
      text: "#1c1810",
    });
    // Dark: banana primary with an ink label.
    expect(deriveTokens(BANANA_CREAM_PRESET.dark)["primary-foreground"]).toBe("#17140e");
  });

  it("make Moonstone the default: monochrome, lit by a banana glow", () => {
    expect(DEFAULT_PRESET.name).toBe("Moonstone");
    expect(DEFAULT_PRESET.glow).toBe("#f2c230");
    // Primary and accent are one colour per mode, with no hue of their own.
    for (const roles of [DEFAULT_PRESET.light, DEFAULT_PRESET.dark]) {
      expect(roles.accent).toBe(roles.primary);
      expect(hexToOklch(roles.primary).C).toBeLessThan(0.05);
    }
    const dark = deriveTokens(DEFAULT_PRESET.dark, { glow: DEFAULT_PRESET.glow });
    expect(dark.glow).toBe("#f2c230");
    // Charts take the glow's hue as their brand slot (snapped into the dark
    // band); the block cards stay apart.
    const hueGap = Math.abs(
      ((hexToOklch(dark["chart-1"]).h - hexToOklch("#f2c230").h + 540) % 360) - 180,
    );
    expect(hueGap).toBeLessThan(15);
    expect(contrastRatio(dark["block-quiet"], dark["block-answer"])).toBeGreaterThan(1.6);
    expect(findPreset("night")).toBe(BANANA_NIGHT_PRESET);
    expect(findPreset("cream")).toBe(BANANA_CREAM_PRESET);
  });

  it("move a saved former default (raspberry or cream) onto today's default", () => {
    expect(isFormerDefault(BANANA_CREAM_PRESET.light)).toBe(true);
    expect(isFormerDefault(DEFAULT_PRESET.light)).toBe(false);
  });

  it("match a palette back to its preset", () => {
    expect(matchPreset(CBC_PRESET.light, CBC_PRESET.dark)).toBe(CBC_PRESET);
    expect(matchPreset(CBC_PRESET.light, null)).toBeUndefined();
  });
});

describe("globals.css", () => {
  const css = readFileSync(path.resolve(__dirname, "../../app/globals.css"), "utf8");

  function block(selector: string): Record<string, string> {
    const start = css.indexOf(`\n${selector} {`);
    expect(start).toBeGreaterThanOrEqual(0);
    const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
    return Object.fromEntries(
      [...body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
    );
  }

  it("ships the untheme preset's derived tokens as its defaults, in both modes", () => {
    const root = block(":root");
    const dark = block(".dark");
    const light = deriveTokens(UNTHEMED_PRESET.light, { glow: UNTHEMED_PRESET.glow });
    const darkTokens = deriveTokens(UNTHEMED_PRESET.dark, { glow: UNTHEMED_PRESET.glow });
    for (const name of TOKEN_NAMES) {
      expect(root[name], `:root --${name}`).toBe(light[name]);
      expect(dark[name], `.dark --${name}`).toBe(darkTokens[name]);
    }
  });

  it("exposes the new tokens to Tailwind", () => {
    for (const name of [
      "primary-hover",
      "brand-accent",
      "brand-accent-foreground",
      "success",
      "success-foreground",
      "warning",
      "warning-foreground",
      "destructive-foreground",
    ]) {
      expect(css).toContain(`--color-${name}: var(--${name});`);
    }
  });

  it("maps the FullCalendar and React Flow variables to tokens", () => {
    expect(css).toMatch(/\.fc \{[^}]*--fc-border-color: var\(--border\)/);
    expect(css).toMatch(/\.fc \{[^}]*--fc-event-bg-color: var\(--primary\)/);
    expect(css).toMatch(/\.react-flow \{[^}]*--xy-node-background-color: var\(--card\)/);
    expect(css).toMatch(/\.react-flow \{[^}]*--xy-edge-stroke: var\(--muted-foreground\)/);
  });
});
