import { contrastRatio } from "@/lib/theme/color";

/**
 * Task label colours. The first four are Bananasplit's own tones (ripe
 * banana, stem, ink, dusk), the ones onboarding suggests; the rest are the
 * original brights.
 */
export const LABEL_COLOR_PALETTE = [
  "#e3a90a",
  "#6b4a1e",
  "#1c1810",
  "#c9bfa8",
  "#ef4444",
  "#f59e0b",
  "#22c55e",
  "#3b82f6",
  "#a855f7",
  "#ec4899",
  "#64748b",
] as const;

export type LabelColor = (typeof LABEL_COLOR_PALETTE)[number];

/**
 * Text on a label's colour: white, unless white would be hard to read (under
 * 3:1, the large-text minimum), as on the dusk and banana tones; then ink.
 */
export function labelTextColor(color: string): string {
  return contrastRatio(color, "#ffffff") < 3 ? "#1c1810" : "#ffffff";
}

/** The ten colours onboarding's colour picker offers: the palette without its near-black. */
export const TAG_PICKER_COLORS = LABEL_COLOR_PALETTE.filter((c) => c !== "#1c1810");
