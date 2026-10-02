import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CBC_THEME } from "@/server/bootstrap/cbc-template";

import { contrastRatio, hexToOklch } from "./color";
import { deriveTokens, TOKEN_NAMES } from "./derive";
import {
  CBC_PRESET,
  DEFAULT_PRESET,
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
    expect(THEME_PRESETS[0]).toBe(DEFAULT_PRESET);
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

  it("keep the Bananasplit highlighter a fill and its primary clear of the destructive red", () => {
    // Banana on vanilla is a highlighter, never text; raspberry reads as a link.
    expect(
      contrastRatio(DEFAULT_PRESET.light.accent, DEFAULT_PRESET.light.background),
    ).toBeLessThan(3);
    expect(
      contrastRatio(DEFAULT_PRESET.light.primary, DEFAULT_PRESET.light.background),
    ).toBeGreaterThan(4.5);
    const light = deriveTokens(DEFAULT_PRESET.light);
    const hue = (hex: string) => hexToOklch(hex).h;
    const gap = Math.abs(((hue(light.primary) - hue(light.destructive) + 540) % 360) - 180);
    expect(gap).toBeGreaterThan(20);
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

  it("ships the Default preset's derived tokens as its defaults, in both modes", () => {
    const root = block(":root");
    const dark = block(".dark");
    const light = deriveTokens(DEFAULT_PRESET.light);
    const darkTokens = deriveTokens(DEFAULT_PRESET.dark);
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
