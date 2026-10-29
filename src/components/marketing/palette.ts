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
