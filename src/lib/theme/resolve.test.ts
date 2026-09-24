import { describe, expect, it } from "vitest";

import { deriveDarkRoles, deriveTheme } from "./derive";
import { CBC_PRESET, DEFAULT_PRESET } from "./presets";
import { buildThemeRecord } from "./record";
import { DEFAULT_RESOLVED_THEME, resolveTheme, themeProviderMode } from "./resolve";

describe("resolveTheme", () => {
  it("resolves no row to the default theme, which injects nothing", () => {
    expect(resolveTheme(null)).toBe(DEFAULT_RESOLVED_THEME);
    expect(DEFAULT_RESOLVED_THEME.isDefault).toBe(true);
    expect(DEFAULT_RESOLVED_THEME.light).toEqual(DEFAULT_PRESET.light);
    expect(DEFAULT_RESOLVED_THEME.mode).toBe("SYSTEM");
  });

  it("resolves the seeded CBC row", () => {
    const theme = resolveTheme({
      preset: "cbc",
      mode: "SYSTEM",
      lockMode: false,
      logoDisplay: "LOGO_AND_NAME",
      light: CBC_PRESET.light,
      dark: CBC_PRESET.dark,
    });
    expect(theme.isDefault).toBe(false);
    expect(theme.preset).toBe("cbc");
    expect(theme.tokens).toEqual(deriveTheme(CBC_PRESET.light, CBC_PRESET.dark));
  });

  it("labels an unknown preset as custom and defaults a missing logo display", () => {
    const theme = resolveTheme({
      preset: "cbc-light",
      mode: "LIGHT",
      lockMode: false,
      light: CBC_PRESET.light,
      dark: null,
    });
    expect(theme.preset).toBe("custom");
    expect(theme.logoDisplay).toBe("LOGO_AND_NAME");
    expect(theme.dark).toBeNull();
    expect(theme.effectiveDark).toEqual(deriveDarkRoles(CBC_PRESET.light));
  });

  it("never locks the SYSTEM mode, and survives unknown enum values", () => {
    const base = { preset: "cbc", light: CBC_PRESET.light, dark: null };
    expect(resolveTheme({ ...base, mode: "SYSTEM", lockMode: true }).lockMode).toBe(false);
    expect(resolveTheme({ ...base, mode: "DARK", lockMode: true }).lockMode).toBe(true);
    const odd = resolveTheme({ ...base, mode: "NEON", lockMode: true, logoDisplay: "HUGE" });
    expect(odd.mode).toBe("SYSTEM");
    expect(odd.lockMode).toBe(false);
    expect(odd.logoDisplay).toBe("LOGO_AND_NAME");
  });
});

describe("themeProviderMode", () => {
  it("applies the org default only as a default, and forces it only when locked", () => {
    expect(themeProviderMode({ mode: "SYSTEM", lockMode: false })).toEqual({
      defaultTheme: "system",
      forcedTheme: undefined,
    });
    expect(themeProviderMode({ mode: "DARK", lockMode: false })).toEqual({
      defaultTheme: "dark",
      forcedTheme: undefined,
    });
    expect(themeProviderMode({ mode: "LIGHT", lockMode: true })).toEqual({
      defaultTheme: "light",
      forcedTheme: "light",
    });
    expect(themeProviderMode({ mode: "SYSTEM", lockMode: true }).forcedTheme).toBeUndefined();
  });
});

describe("buildThemeRecord", () => {
  const custom = {
    primary: "#3355aa",
    accent: "#ee8844",
    background: "#fdfcfa",
    surface: "#ffffff",
    text: "#222222",
  };

  it("stores a known preset's own palettes, whatever colours came with it", () => {
    const record = buildThemeRecord({
      preset: "cbc",
      mode: "LIGHT",
      lockMode: false,
      logoDisplay: "NAME_ONLY",
      light: custom,
      dark: null,
    });
    expect(record.preset).toBe("cbc");
    expect(record.light).toEqual(CBC_PRESET.light);
    expect(record.dark).toEqual(CBC_PRESET.dark);
    expect(record.contrastWarnings).toEqual([]);
    expect(record.logoDisplay).toBe("NAME_ONLY");
  });

  it("stores anything else as custom, with derived tokens and warnings", () => {
    const record = buildThemeRecord({
      preset: "not-a-preset",
      mode: "SYSTEM",
      lockMode: true,
      logoDisplay: "LOGO_AND_NAME",
      light: custom,
      dark: null,
    });
    expect(record.preset).toBe("custom");
    expect(record.light).toEqual(custom);
    expect(record.dark).toBeNull();
    expect(record.lockMode).toBe(false);
    expect(record.tokens).toEqual(deriveTheme(custom, null));
    expect(Array.isArray(record.contrastWarnings)).toBe(true);
  });
});
