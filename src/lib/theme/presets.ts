import type { ThemeRoles } from "./types";

/**
 * The preset list shown on Settings > Theme. Each preset carries explicit
 * light and dark palettes; the org's mode setting picks which one members
 * see by default. Every preset passes WCAG AA in both modes (presets.test.ts).
 *
 * "default" is also what globals.css ships (theme-css.test.ts keeps the two
 * identical), so an org with no OrgTheme row and an org that picked Default
 * look the same.
 */

export interface ThemePreset {
  id: string;
  name: string;
  description: string;
  light: ThemeRoles;
  dark: ThemeRoles;
}

export const CUSTOM_PRESET_ID = "custom";
export const DEFAULT_PRESET_ID = "default";

export const DEFAULT_PRESET: ThemePreset = {
  id: DEFAULT_PRESET_ID,
  name: "Default",
  description: "Neutral greys with a near-black primary. The app's built-in look.",
  light: {
    primary: "#171717",
    accent: "#737373",
    background: "#ffffff",
    surface: "#ffffff",
    text: "#0a0a0a",
  },
  dark: {
    primary: "#e5e5e5",
    accent: "#a3a3a3",
    background: "#0a0a0a",
    surface: "#171717",
    text: "#fafafa",
  },
};

/**
 * Claude Builders Club, from the club website's design system
 * (anthropic-club-website/DESIGN.md, "The Marked Page"): warm paper, near-black
 * ink, Burnt Terracotta for every readable coral (5.58:1 on paper) and Claude
 * Coral as a fill only (2.96:1 on paper, never text). In dark mode the coral
 * becomes the primary with an ink label. Must stay in step with CBC_THEME in
 * src/server/bootstrap/cbc-template.ts (the seed).
 */
export const CBC_PRESET: ThemePreset = {
  id: "cbc",
  name: "Claude Builders Club",
  description: "Warm paper, ink text, terracotta links and a coral highlighter.",
  light: {
    primary: "#a34a2a",
    accent: "#d97757",
    background: "#faf9f5",
    surface: "#ffffff",
    text: "#141413",
  },
  dark: {
    primary: "#d97757",
    accent: "#e39a7a",
    background: "#141413",
    surface: "#1f1e1b",
    text: "#f7f5ef",
  },
};

export const THEME_PRESETS: readonly ThemePreset[] = [
  DEFAULT_PRESET,
  CBC_PRESET,
  {
    id: "harbor",
    name: "Harbor",
    description: "Deep sea blue on cool white, with a bright sky accent.",
    light: {
      primary: "#1d4ed8",
      accent: "#0ea5e9",
      background: "#f8fafc",
      surface: "#ffffff",
      text: "#0f172a",
    },
    dark: {
      primary: "#7fb0ff",
      accent: "#38bdf8",
      background: "#0b1220",
      surface: "#131c2e",
      text: "#e5edf7",
    },
  },
  {
    id: "evergreen",
    name: "Evergreen",
    description: "Forest green on a soft sage page, with a fresh lime accent.",
    light: {
      primary: "#1f6b43",
      accent: "#84cc16",
      background: "#f6f8f4",
      surface: "#ffffff",
      text: "#122018",
    },
    dark: {
      primary: "#6fd49b",
      accent: "#a3e635",
      background: "#0d1511",
      surface: "#15201a",
      text: "#e7f0ea",
    },
  },
  {
    id: "orchid",
    name: "Orchid",
    description: "Violet primary on a lilac-tinted page, with a rose accent.",
    light: {
      primary: "#6d28d9",
      accent: "#e0457b",
      background: "#faf8fd",
      surface: "#ffffff",
      text: "#1d1233",
    },
    dark: {
      primary: "#c4b1ff",
      accent: "#f472b6",
      background: "#120e1a",
      surface: "#1b1527",
      text: "#f2edf9",
    },
  },
];

export function findPreset(id: string): ThemePreset | undefined {
  return THEME_PRESETS.find((preset) => preset.id === id);
}

/** The preset whose palettes equal these roles, if any (a custom theme can match one). */
export function matchPreset(light: ThemeRoles, dark: ThemeRoles | null): ThemePreset | undefined {
  const same = (a: ThemeRoles, b: ThemeRoles) =>
    a.primary === b.primary &&
    a.accent === b.accent &&
    a.background === b.background &&
    a.surface === b.surface &&
    a.text === b.text;
  return THEME_PRESETS.find(
    (preset) => same(preset.light, light) && dark !== null && same(preset.dark, dark),
  );
}
