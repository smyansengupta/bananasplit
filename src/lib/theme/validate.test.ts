import { describe, expect, it } from "vitest";

import { themeStyleSheet, tokenStyle } from "./css";
import { deriveTheme, deriveTokens } from "./derive";
import { CBC_PRESET, DEFAULT_PRESET } from "./presets";
import { buildThemeRecord } from "./record";
import { resolveTheme } from "./resolve";
import { hexSchema, isHex, normalizeHex, parseRoles, themeInputSchema } from "./validate";

/** Values that would break out of `--token:VALUE;` inside the <style>. */
const MALICIOUS = [
  "#fff;}</style><script>alert(1)</script>",
  "#a34a2a;background:url(https://evil.example/x)",
  "#a34a2a}html{display:none",
  "red",
  "expression(alert(1))",
  "#abc",
  "#a34a2a ",
  " #a34a2a",
  "#a34a2a\n",
  "#a34a2g",
  "#a34a2aff",
  "",
];

const VALID_INPUT = {
  preset: "custom",
  mode: "DARK",
  lockMode: true,
  logoDisplay: "LOGO_ONLY",
  light: { ...CBC_PRESET.light },
  dark: null,
};

describe("strict hex validation", () => {
  it("accepts six-digit hex in any case and normalizes to lowercase", () => {
    expect(isHex("#A34A2A")).toBe(true);
    expect(normalizeHex("#A34A2A")).toBe("#a34a2a");
    expect(hexSchema.parse("#A34A2A")).toBe("#a34a2a");
  });

  it.each(MALICIOUS)("rejects %j", (value) => {
    expect(isHex(value)).toBe(false);
    expect(normalizeHex(value)).toBeNull();
    expect(hexSchema.safeParse(value).success).toBe(false);
  });

  it("rejects non-strings", () => {
    for (const value of [null, undefined, 0xa34a2a, ["#a34a2a"], { toString: () => "#a34a2a" }]) {
      expect(isHex(value)).toBe(false);
    }
  });

  it("rejects a malicious value anywhere in the save input", () => {
    expect(themeInputSchema.safeParse(VALID_INPUT).success).toBe(true);
    for (const value of MALICIOUS) {
      const light = { ...VALID_INPUT, light: { ...VALID_INPUT.light, primary: value } };
      expect(themeInputSchema.safeParse(light).success).toBe(false);
      const dark = { ...VALID_INPUT, dark: { ...VALID_INPUT.light, text: value } };
      expect(themeInputSchema.safeParse(dark).success).toBe(false);
    }
  });

  it("rejects unknown keys, missing roles and bad enums", () => {
    expect(themeInputSchema.safeParse({ ...VALID_INPUT, tokens: {} }).success).toBe(false);
    expect(
      themeInputSchema.safeParse({
        ...VALID_INPUT,
        light: { ...VALID_INPUT.light, extra: "#000000" },
      }).success,
    ).toBe(false);
    const { text: _text, ...missing } = VALID_INPUT.light;
    expect(themeInputSchema.safeParse({ ...VALID_INPUT, light: missing }).success).toBe(false);
    expect(themeInputSchema.safeParse({ ...VALID_INPUT, mode: "AUTO" }).success).toBe(false);
    expect(themeInputSchema.safeParse({ ...VALID_INPUT, logoDisplay: "BIG" }).success).toBe(false);
    expect(themeInputSchema.safeParse({ ...VALID_INPUT, preset: "</style>" }).success).toBe(false);
  });

  it("parses stored palettes strictly", () => {
    expect(parseRoles(CBC_PRESET.light)).toEqual(CBC_PRESET.light);
    expect(parseRoles({ ...CBC_PRESET.light, primary: "#A34A2A" })?.primary).toBe("#a34a2a");
    for (const value of MALICIOUS) {
      expect(parseRoles({ ...CBC_PRESET.light, surface: value })).toBeNull();
    }
    expect(parseRoles(null)).toBeNull();
    expect(parseRoles([])).toBeNull();
    expect(parseRoles({ primary: "#000000" })).toBeNull();
  });
});

describe("render-time validation", () => {
  it("renders html:root and html.dark blocks of hex-only declarations", () => {
    const css = themeStyleSheet(deriveTheme(CBC_PRESET.light, CBC_PRESET.dark));
    expect(css.startsWith("html:root{--background:#faf9f5;")).toBe(true);
    expect(css).toContain("}html.dark{--background:#141413;");
    // Nothing but token names, hex values and the two selectors.
    expect(css).toMatch(
      /^html:root\{(--[a-z0-9-]+:#[0-9a-f]{6};?)+\}html\.dark\{(--[a-z0-9-]+:#[0-9a-f]{6};?)+\}$/,
    );
  });

  it("drops the whole sheet when any token is not strict hex", () => {
    const theme = deriveTheme(CBC_PRESET.light, CBC_PRESET.dark);
    for (const value of MALICIOUS) {
      const tampered = { ...theme, dark: { ...theme.dark, ring: value } };
      expect(themeStyleSheet(tampered)).toBe("");
      expect(tokenStyle({ ...theme.light, primary: value })).toEqual({});
    }
  });

  it("falls back to the default theme for a tampered row", () => {
    for (const value of MALICIOUS) {
      const row = {
        preset: "custom",
        mode: "LIGHT",
        lockMode: false,
        light: { ...CBC_PRESET.light, background: value },
        dark: null,
      };
      const resolved = resolveTheme(row);
      expect(resolved.isDefault).toBe(true);
      expect(resolved.light).toEqual(DEFAULT_PRESET.light);
    }
  });

  it("ignores a tampered dark palette (derives it instead)", () => {
    const resolved = resolveTheme({
      preset: "custom",
      mode: "DARK",
      lockMode: false,
      light: CBC_PRESET.light,
      dark: { ...CBC_PRESET.dark, primary: "#fff;}</style>" },
    });
    expect(resolved.dark).toBeNull();
    expect(resolved.isDefault).toBe(false);
    expect(themeStyleSheet(resolved.tokens)).not.toContain("</style>");
  });

  it("recomputes tokens on save instead of trusting the client", () => {
    const record = buildThemeRecord(themeInputSchema.parse(VALID_INPUT));
    expect(record.tokens.light).toEqual(deriveTokens(CBC_PRESET.light));
  });
});
