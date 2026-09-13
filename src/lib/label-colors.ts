export const LABEL_COLOR_PALETTE = [
  "#ef4444",
  "#f59e0b",
  "#22c55e",
  "#3b82f6",
  "#a855f7",
  "#ec4899",
  "#64748b",
] as const;

export type LabelColor = (typeof LABEL_COLOR_PALETTE)[number];
