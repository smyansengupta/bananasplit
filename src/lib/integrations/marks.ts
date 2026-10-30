import { BRANDS, brandBySlug, type Brand } from "@/components/marketing/brands";

/**
 * The tiles on the Integrations page for apps the marketing site doesn't
 * list (yet): each app's own colour and letters, kept beside BRANDS
 * (src/components/marketing/brands.ts) because a maker's colour is not a
 * theme colour.
 */
const mark = (name: string, slug: string, color: string, ink: string, letters: string): Brand => ({
  name,
  slug,
  group: "inbox",
  color,
  ink,
  mark: letters,
});

export const INTEGRATION_MARKS = {
  imessage: mark("iMessage", "imessage", "#34C759", "#FFFFFF", "iM"),
  sms: mark("Text messages", "sms", "#1F3F87", "#FFFFFF", "SMS"),
  slack: mark("Slack", "slack", "#4A154B", "#FFFFFF", "S"),
  discord: mark("Discord", "discord", "#5865F2", "#FFFFFF", "D"),
  groupme: mark("GroupMe", "groupme", "#00AFF0", "#FFFFFF", "GM"),
  email: mark("Email", "email", "#F1F1F0", "#171717", "@"),
  website: mark("Website", "website", "#171717", "#FFFFFF", "W"),
  generic: mark("App", "app", "#171717", "#FFFFFF", "A"),
} as const;

/** A brand from the marketing list by slug, or the generic tile. */
export function brandOr(slug: string, fallback: Brand = INTEGRATION_MARKS.generic): Brand {
  return BRANDS.some((b) => b.slug === slug) ? brandBySlug(slug) : fallback;
}
