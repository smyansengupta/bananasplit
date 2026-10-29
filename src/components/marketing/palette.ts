/**
 * Fixed colours of other products the marketing samples draw (like the
 * brand colours in brands.ts): data, not theme tokens, so they stay true in
 * light and dark.
 */
export const IMESSAGE = {
  /** iMessage's sent bubble. */
  blue: "#0A84FF",
  white: "#FFFFFF",
} as const;

/** iMessage in light mode, for the phone and the threads on the home page: the bubbles, the screen, the bars. */
export const IMESSAGE_LIGHT = {
  received: "#E9E9EB",
  ink: "#000000",
  screen: "#FFFFFF",
  bar: "#F6F6F6",
  hairline: "rgb(0 0 0 / 0.08)",
  field: "rgb(0 0 0 / 0.14)",
} as const;

/** The phone's frame on the home page (black titanium) and the dark-mode greys it shares (the meta text). */
export const IMESSAGE_DARK = {
  meta: "#8E8E93",
  frame: "#1A1A1C",
  frameEdge: "#3A3A3C",
  /** The phone's lift off a light page. */
  shadow: "0 44px 80px -34px rgb(0 0 0 / 0.45), 0 0 0 1px rgb(0 0 0 / 0.5)",
} as const;

/** Claude's chat: its warm background and its accent. */
export const CLAUDE_CHAT = {
  surface: "#F5F4EE",
  ink: "#1F1E1D",
  muted: "#73726C",
  bubble: "#E8E6DC",
  accent: "#D97757",
  onAccent: "#FFFFFF",
  border: "rgb(31 30 29 / 0.12)",
  input: "#FFFFFF",
} as const;
