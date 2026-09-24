import { TOKEN_NAMES, type DerivedTheme, type TokenMap, type TokenName } from "./derive";
import { isHex } from "./validate";

/**
 * Turns derived tokens into CSS. Render-time validation lives here: every
 * name must be a known token (a fixed list, never data) and every value
 * strict `#rrggbb`. One bad value drops the WHOLE sheet (fail closed to the
 * globals.css default) rather than rendering a partial theme, so nothing a
 * row contains can reach the <style> element except six hex digits.
 */

function isTokenMap(value: unknown): value is TokenMap {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return TOKEN_NAMES.every((name) => isHex(record[name]));
}

function declarations(tokens: TokenMap): string {
  return TOKEN_NAMES.map((name) => `--${name}:${tokens[name].toLowerCase()}`).join(";");
}

/**
 * The org theme stylesheet: `html:root{...}html.dark{...}`.
 *
 * - `html:root` (0,1,1) beats globals.css `:root` (0,1,0), and `html.dark`
 *   (0,1,1) beats `.dark`; html.dark comes second so it wins in dark mode.
 * - Custom properties on <html> reach everything, including Radix portals
 *   mounted on <body> (dialogs, menus, popovers, toasts).
 * - Needs no nonce: the CSP is style-src 'self' 'unsafe-inline' (see
 *   src/lib/security/csp.ts), and strict hex keeps it injection-proof.
 *
 * Returns "" when anything fails validation.
 */
export function themeStyleSheet(theme: DerivedTheme): string {
  if (!isTokenMap(theme.light) || !isTokenMap(theme.dark)) return "";
  return `html:root{${declarations(theme.light)}}html.dark{${declarations(theme.dark)}}`;
}

/**
 * The same tokens as a React style object of custom properties, for the
 * scoped preview wrapper and the whole-app preview. Invalid input gives {}.
 */
export function tokenStyle(
  tokens: TokenMap,
): Record<`--${TokenName}`, string> | Record<string, never> {
  if (!isTokenMap(tokens)) return {};
  const style = {} as Record<`--${TokenName}`, string>;
  for (const name of TOKEN_NAMES) style[`--${name}`] = tokens[name];
  return style;
}
