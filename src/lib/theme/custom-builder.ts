import type { ThemeRoles } from "./types";

/**
 * The guided "Custom" theme: one colour and one page style make the five
 * roles, so a custom theme is two clicks and always readable. Every
 * combination passes WCAG AA in light and in the derived dark palette
 * (custom-builder.test.ts). "Fine-tune" in the picker edits the five roles
 * directly for anyone who wants an exact brand colour.
 */

export interface ColourSwatch {
  id: string;
  name: string;
  /** Buttons and links: readable on white. */
  primary: string;
  /** Highlights and dots. */
  accent: string;
}

export const COLOUR_SWATCHES: readonly ColourSwatch[] = [
  { id: "terracotta", name: "Terracotta", primary: "#b4462b", accent: "#e0a23a" },
  { id: "crimson", name: "Crimson", primary: "#b91c1c", accent: "#f59e0b" },
  { id: "rose", name: "Rose", primary: "#be185d", accent: "#f472b6" },
  { id: "violet", name: "Violet", primary: "#6d28d9", accent: "#e0457b" },
  { id: "indigo", name: "Indigo", primary: "#4338ca", accent: "#06b6d4" },
  { id: "blue", name: "Blue", primary: "#1d4ed8", accent: "#0ea5e9" },
  { id: "teal", name: "Teal", primary: "#0f766e", accent: "#f59e0b" },
  { id: "green", name: "Green", primary: "#15803d", accent: "#84cc16" },
  { id: "amber", name: "Amber", primary: "#a14a06", accent: "#0ea5e9" },
  { id: "slate", name: "Slate", primary: "#334155", accent: "#f97316" },
];

export interface PageStyle {
  id: string;
  name: string;
  background: string;
  surface: string;
  text: string;
}

export const PAGE_STYLES: readonly PageStyle[] = [
  { id: "clean", name: "Clean white", background: "#ffffff", surface: "#ffffff", text: "#0a0a0a" },
  { id: "warm", name: "Warm paper", background: "#faf7f2", surface: "#ffffff", text: "#1a1512" },
  { id: "cool", name: "Cool mist", background: "#f4f7fb", surface: "#ffffff", text: "#0f172a" },
  { id: "stone", name: "Soft stone", background: "#f4f4f2", surface: "#ffffff", text: "#1c1917" },
];

export function buildCustomRoles(colourId: string, pageId: string): ThemeRoles {
  const colour = COLOUR_SWATCHES.find((c) => c.id === colourId) ?? COLOUR_SWATCHES[0];
  const page = PAGE_STYLES.find((p) => p.id === pageId) ?? PAGE_STYLES[0];
  return {
    primary: colour.primary,
    accent: colour.accent,
    background: page.background,
    surface: page.surface,
    text: page.text,
  };
}

/** Which swatch and page style made these roles, if the guided picker did. */
export function matchCustomRoles(roles: ThemeRoles): { colour: string | null; page: string | null } {
  const colour = COLOUR_SWATCHES.find((c) => c.primary === roles.primary && c.accent === roles.accent);
  const page = PAGE_STYLES.find(
    (p) => p.background === roles.background && p.surface === roles.surface && p.text === roles.text,
  );
  return { colour: colour?.id ?? null, page: page?.id ?? null };
}
