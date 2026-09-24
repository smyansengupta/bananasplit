import { contrastRatio, hexToOklch, oklchToHex } from "./color";
import { deriveDarkRoles, deriveTokens, type TokenMap, type TokenName } from "./derive";
import type { ColorMode, RoleKey, ThemeRoles } from "./types";

/**
 * WCAG AA contrast checks over the pairs that carry meaning in the app, in
 * each mode. The spec says warn, so a failing theme can still be saved: the
 * warnings (with ratios and a suggested fix) are shown in the editor and
 * stored on OrgTheme.contrastWarnings.
 *
 * Text pairs need 4.5:1 (normal-size text). Non-text pairs (the focus ring,
 * chart marks) need 3:1 (WCAG 1.4.11).
 */

export interface ContrastPair {
  id: string;
  /** Plain-language name shown in the warning. */
  label: string;
  fg: TokenName;
  bg: TokenName;
  required: 4.5 | 3;
  /** The role whose change fixes this pair (null: derived-only, fixed by other roles). */
  role: RoleKey | null;
}

export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  {
    id: "text-background",
    label: "Text on the page background",
    fg: "foreground",
    bg: "background",
    required: 4.5,
    role: "text",
  },
  {
    id: "text-card",
    label: "Text on cards",
    fg: "card-foreground",
    bg: "card",
    required: 4.5,
    role: "text",
  },
  {
    id: "text-popover",
    label: "Text in dialogs and menus",
    fg: "popover-foreground",
    bg: "popover",
    required: 4.5,
    role: "text",
  },
  {
    id: "primary-label",
    label: "Label on primary buttons",
    fg: "primary-foreground",
    bg: "primary",
    required: 4.5,
    role: "primary",
  },
  {
    id: "primary-hover-label",
    label: "Label on hovered primary buttons",
    fg: "primary-foreground",
    bg: "primary-hover",
    required: 4.5,
    role: "primary",
  },
  {
    id: "primary-link",
    label: "Primary as link text on the page",
    fg: "primary",
    bg: "background",
    required: 4.5,
    role: "primary",
  },
  {
    id: "muted-background",
    label: "Secondary text on the page",
    fg: "muted-foreground",
    bg: "background",
    required: 4.5,
    role: "text",
  },
  {
    id: "muted-muted",
    label: "Secondary text on muted panels",
    fg: "muted-foreground",
    bg: "muted",
    required: 4.5,
    role: "text",
  },
  {
    id: "secondary-label",
    label: "Label on secondary buttons",
    fg: "secondary-foreground",
    bg: "secondary",
    required: 4.5,
    role: "text",
  },
  {
    id: "accent-hover",
    label: "Text on highlighted menu items",
    fg: "accent-foreground",
    bg: "accent",
    required: 4.5,
    role: "text",
  },
  {
    id: "sidebar-text",
    label: "Sidebar text",
    fg: "sidebar-foreground",
    bg: "sidebar",
    required: 4.5,
    role: "text",
  },
  {
    id: "sidebar-active",
    label: "Active sidebar item",
    fg: "sidebar-accent-foreground",
    bg: "sidebar-accent",
    required: 4.5,
    role: "text",
  },
  {
    id: "accent-fill",
    label: "Text on accent fills",
    fg: "brand-accent-foreground",
    bg: "brand-accent",
    required: 4.5,
    role: "accent",
  },
  {
    id: "destructive-text",
    label: "Error and delete text",
    fg: "destructive",
    bg: "background",
    required: 4.5,
    role: null,
  },
  {
    id: "success-text",
    label: "Success text",
    fg: "success",
    bg: "background",
    required: 4.5,
    role: null,
  },
  {
    id: "warning-text",
    label: "Warning text",
    fg: "warning",
    bg: "background",
    required: 4.5,
    role: null,
  },
  {
    id: "focus-ring",
    label: "Focus ring on the page",
    fg: "ring",
    bg: "background",
    required: 3,
    role: "primary",
  },
  {
    id: "chart-1",
    label: "Chart colour 1 on cards",
    fg: "chart-1",
    bg: "card",
    required: 3,
    role: null,
  },
  {
    id: "chart-2",
    label: "Chart colour 2 on cards",
    fg: "chart-2",
    bg: "card",
    required: 3,
    role: null,
  },
  {
    id: "chart-3",
    label: "Chart colour 3 on cards",
    fg: "chart-3",
    bg: "card",
    required: 3,
    role: null,
  },
  {
    id: "chart-4",
    label: "Chart colour 4 on cards",
    fg: "chart-4",
    bg: "card",
    required: 3,
    role: null,
  },
  {
    id: "chart-5",
    label: "Chart colour 5 on cards",
    fg: "chart-5",
    bg: "card",
    required: 3,
    role: null,
  },
];

export interface ContrastResult {
  mode: ColorMode;
  pair: string;
  label: string;
  fg: string;
  bg: string;
  ratio: number;
  required: number;
  pass: boolean;
}

export interface ContrastFix {
  mode: ColorMode;
  role: RoleKey;
  value: string;
  /** The pair's ratio once the fix is applied. */
  ratio: number;
}

/** A failing pair, as stored on OrgTheme.contrastWarnings and shown in the editor. */
export interface ContrastWarning extends Omit<ContrastResult, "pass"> {
  fix: ContrastFix | null;
}

/** Every pair in one mode's tokens, passing or not. */
export function checkTokens(tokens: TokenMap, mode: ColorMode): ContrastResult[] {
  return CONTRAST_PAIRS.map((pair) => {
    const ratio = contrastRatio(tokens[pair.fg], tokens[pair.bg]);
    return {
      mode,
      pair: pair.id,
      label: pair.label,
      fg: tokens[pair.fg],
      bg: tokens[pair.bg],
      ratio,
      required: pair.required,
      pass: ratio >= pair.required,
    };
  });
}

/**
 * The smallest lightness change to `pair.role` (hue and chroma kept) that
 * makes the pair pass once the tokens are re-derived, or null.
 */
export function suggestFix(
  roles: ThemeRoles,
  mode: ColorMode,
  pair: ContrastPair,
  cache: Map<string, TokenMap> = new Map(),
): ContrastFix | null {
  const role = pair.role;
  if (!role) return null;
  const base = hexToOklch(roles[role]);
  for (let step = 1; step <= 100; step++) {
    for (const direction of [-1, 1]) {
      const L = base.L + direction * step * 0.01;
      if (L < 0 || L > 1) continue;
      const value = oklchToHex({ L, C: base.C, h: base.h });
      const key = `${role}:${value}`;
      let tokens = cache.get(key);
      if (!tokens) {
        tokens = deriveTokens({ ...roles, [role]: value });
        cache.set(key, tokens);
      }
      const ratio = contrastRatio(tokens[pair.fg], tokens[pair.bg]);
      if (ratio >= pair.required) return { mode, role, value, ratio };
    }
  }
  return null;
}

function warningsFor(roles: ThemeRoles, mode: ColorMode): ContrastWarning[] {
  const tokens = deriveTokens(roles);
  // Pairs fixed by the same role walk the same candidates: derive each once.
  const cache = new Map<string, TokenMap>();
  return checkTokens(tokens, mode)
    .filter((result) => !result.pass)
    .map((result) => {
      const pair = CONTRAST_PAIRS.find((p) => p.id === result.pair)!;
      const { pass: _pass, ...rest } = result;
      return { ...rest, fix: suggestFix(roles, mode, pair, cache) };
    });
}

/**
 * The AA warnings for a theme in both modes. `dark` null checks the
 * auto-derived dark palette (a fix for it then means customising Dark).
 */
export function contrastWarnings(light: ThemeRoles, dark: ThemeRoles | null): ContrastWarning[] {
  return [...warningsFor(light, "light"), ...warningsFor(dark ?? deriveDarkRoles(light), "dark")];
}
