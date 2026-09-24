/**
 * Theme vocabulary shared by the server (save, render) and the client (the
 * editor and live preview). No server imports here: client components use it.
 */

/** The five colour roles an org chooses, per mode. */
export const ROLE_KEYS = ["primary", "accent", "background", "surface", "text"] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

/** One palette: a strict `#rrggbb` value per role. */
export type ThemeRoles = Record<RoleKey, string>;

export type ColorMode = "light" | "dark";
export const COLOR_MODES: readonly ColorMode[] = ["light", "dark"];

/** Mirrors the Prisma enum ThemeMode (the org's default light/dark mode). */
export const THEME_MODES = ["LIGHT", "DARK", "SYSTEM"] as const;
export type ThemeModeValue = (typeof THEME_MODES)[number];

/** Mirrors the Prisma enum ThemeLogoDisplay (how the org logo shows in the app shell). */
export const LOGO_DISPLAYS = ["LOGO_AND_NAME", "LOGO_ONLY", "NAME_ONLY"] as const;
export type LogoDisplayValue = (typeof LOGO_DISPLAYS)[number];

export const ROLE_LABELS: Record<RoleKey, string> = {
  primary: "Primary",
  accent: "Accent",
  background: "Background",
  surface: "Surface",
  text: "Text",
};

export const ROLE_HINTS: Record<RoleKey, string> = {
  primary: "Buttons, links and the focus ring. Must read on the background.",
  accent: "Highlights, hover tints and charts. Used as a fill, rarely as text.",
  background: "The page behind everything.",
  surface: "Cards, dialogs, menus and popovers.",
  text: "Body text and headings.",
};
