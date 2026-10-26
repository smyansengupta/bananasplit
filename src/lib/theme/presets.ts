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
  /** The preset's own glow (the light behind the page); absent = its accent. */
  glow?: string;
}

export const CUSTOM_PRESET_ID = "custom";
export const DEFAULT_PRESET_ID = "default";
export const GRAPHITE_PRESET_ID = "graphite";

/**
 * "Moonstone", the default since the redesign: graphite and pearl with no
 * fill colour of its own, lit by a banana glow (the light behind the page,
 * the halo on create buttons, the active item and focus). Dark first: the
 * org mode defaults to dark. The primary and accent are one colour (pearl in
 * dark, ink in light); the glow is what marks "create".
 */
export const DEFAULT_PRESET: ThemePreset = {
  id: DEFAULT_PRESET_ID,
  name: "Moonstone",
  description: "Graphite and pearl, lit by a banana glow.",
  light: {
    primary: "#111318",
    accent: "#111318",
    background: "#eff1f4",
    surface: "#ffffff",
    text: "#111318",
  },
  dark: {
    primary: "#eef0f4",
    accent: "#eef0f4",
    background: "#0c0d10",
    surface: "#15161b",
    text: "#eef0f4",
  },
  glow: "#f2c230",
};

export const BANANA_NIGHT_PRESET_ID = "night";

/** "Banana night": graphite greys with banana as the accent (the redesign's first draft). */
export const BANANA_NIGHT_PRESET: ThemePreset = {
  id: BANANA_NIGHT_PRESET_ID,
  name: "Banana night",
  description: "Graphite greys with a banana accent.",
  light: {
    primary: "#16181b",
    accent: "#f2c230",
    background: "#f3f4f6",
    surface: "#ffffff",
    text: "#16181b",
  },
  dark: {
    primary: "#eceef1",
    accent: "#f2c230",
    background: "#0f1114",
    surface: "#171a1e",
    text: "#eceef1",
  },
};

export const BANANA_CREAM_PRESET_ID = "cream";

/**
 * "Banana cream", the built-in look before the redesign, in the brand's own
 * palette (src/app/brand.css): cream paper, ink type and an ink primary,
 * with banana as the highlighter (a fill only, about 1.5:1 on cream, never
 * text). Dark mode is the same banana split at night: ink-dark paper, cream
 * text, banana as the primary with an ink label, and a riper banana for the
 * highlighter.
 */
export const BANANA_CREAM_PRESET: ThemePreset = {
  id: BANANA_CREAM_PRESET_ID,
  name: "Banana cream",
  description: "Cream paper, ink type and a banana highlighter.",
  light: {
    primary: "#1c1810",
    accent: "#f2c230",
    background: "#f7f2e6",
    surface: "#fffdf7",
    text: "#1c1810",
  },
  dark: {
    primary: "#f2c230",
    accent: "#e3a90a",
    background: "#17140e",
    surface: "#221d15",
    text: "#f7f2e6",
  },
};

/**
 * The Bananasplit preset before the brand redesign (a raspberry primary).
 * Orgs that saved it have these palettes stored under the "default" id;
 * resolve.ts moves them onto today's Bananasplit, since picking Bananasplit
 * means following the brand.
 */
export const LEGACY_DEFAULT_LIGHT: ThemePreset["light"] = {
  primary: "#b0135f",
  accent: "#f2c230",
  background: "#fbf6ea",
  surface: "#fffdf7",
  text: "#1f1611",
};

/**
 * "Graphite": neutral greys with a near-black primary, the built-in look
 * before Bananasplit. Orgs that saved the old Default have exactly these
 * palettes stored under the "default" id; resolve.ts reports them as
 * Graphite so they keep their look under its real name.
 */
export const GRAPHITE_PRESET: ThemePreset = {
  id: GRAPHITE_PRESET_ID,
  name: "Graphite",
  description: "Neutral greys with a near-black primary. Quiet, like plain newsprint.",
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
 * "Paper & Coral" (id "cbc", kept so saved themes still resolve): first made
 * for Claude Builders Club, from the club website's design system
 * (anthropic-club-website/DESIGN.md, "The Marked Page"): warm paper, near-black
 * ink, Burnt Terracotta for every readable coral (5.58:1 on paper) and Claude
 * Coral as a fill only (2.96:1 on paper, never text). In dark mode the coral
 * becomes the primary with an ink label. Must stay in step with CBC_THEME in
 * src/server/bootstrap/cbc-template.ts (the seed).
 */
export const CBC_PRESET: ThemePreset = {
  id: "cbc",
  name: "Paper & Coral",
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

/**
 * What a space looks like with no theme of its own: Graphite, since
 * 2026-10-25. Every org that had already saved a theme keeps it (their
 * palettes are stored on the row, and resolve.ts reads those), so this is the
 * look for new clubs, Personal spaces, and the signed-out shell - marketing,
 * sign-in and onboarding, whose tokens globals.css ships.
 *
 * DEFAULT_PRESET is still Moonstone and still in the list below; it is simply
 * no longer the one you get by default.
 */
export const UNTHEMED_PRESET: ThemePreset = GRAPHITE_PRESET;
export const UNTHEMED_PRESET_ID = GRAPHITE_PRESET_ID;

export const THEME_PRESETS: readonly ThemePreset[] = [
  GRAPHITE_PRESET,
  DEFAULT_PRESET,
  BANANA_NIGHT_PRESET,
  BANANA_CREAM_PRESET,
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
  {
    id: "sunset",
    name: "Sunset",
    description: "Burnt orange on warm cream, with a golden accent.",
    light: {
      primary: "#b43c0c",
      accent: "#f2a93b",
      background: "#fdf8f3",
      surface: "#ffffff",
      text: "#24150d",
    },
    dark: {
      primary: "#ff9a62",
      accent: "#f6c05c",
      background: "#16100c",
      surface: "#221913",
      text: "#f8ede4",
    },
  },
  {
    id: "midnight",
    name: "Midnight",
    description: "Indigo on a crisp page, with a teal accent. Best in dark.",
    light: {
      primary: "#4338ca",
      accent: "#14b8a6",
      background: "#f7f7fc",
      surface: "#ffffff",
      text: "#111127",
    },
    dark: {
      primary: "#a5b4fc",
      accent: "#2dd4bf",
      background: "#090a18",
      surface: "#121429",
      text: "#e8e9fb",
    },
  },
];

export function findPreset(id: string): ThemePreset | undefined {
  return THEME_PRESETS.find((preset) => preset.id === id);
}

export function sameRoles(a: ThemeRoles, b: ThemeRoles): boolean {
  return (
    a.primary === b.primary &&
    a.accent === b.accent &&
    a.background === b.background &&
    a.surface === b.surface &&
    a.text === b.text
  );
}

/** The preset whose palettes equal these roles, if any (a custom theme can match one). */
export function matchPreset(light: ThemeRoles, dark: ThemeRoles | null): ThemePreset | undefined {
  return THEME_PRESETS.find(
    (preset) => sameRoles(preset.light, light) && dark !== null && sameRoles(preset.dark, dark),
  );
}

/**
 * The preset id a saved row stands for. A row saved as "default" before the
 * Default became Bananasplit stores the old greys: that is Graphite now.
 */
export function savedPresetId(id: string, light: ThemeRoles): string {
  if (id === DEFAULT_PRESET_ID && sameRoles(light, GRAPHITE_PRESET.light)) {
    return GRAPHITE_PRESET_ID;
  }
  return findPreset(id) ? id : CUSTOM_PRESET_ID;
}

/**
 * Light palettes a row saved as "default" may hold from before Moonstone:
 * the raspberry Bananasplit and the cream Bananasplit. Picking the default
 * has always meant following the brand, so resolve.ts moves them onto
 * today's default (the decision recorded in docs/features/themes.md).
 */
export function isFormerDefault(light: ThemeRoles): boolean {
  return sameRoles(light, LEGACY_DEFAULT_LIGHT) || sameRoles(light, BANANA_CREAM_PRESET.light);
}

/** The glow a preset paints with: its own, else null (the accent). */
export function presetGlow(id: string): string | null {
  return findPreset(id)?.glow ?? null;
}
