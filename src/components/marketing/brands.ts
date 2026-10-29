/**
 * The apps Bananasplit connects to, in the order the marketing pages show
 * them. Their logos are files at public/marketing/logos/<slug>.svg (see
 * SOURCES.txt there); the colour and short mark are only the fallback tile
 * when a logo file is missing. Brand colours are fixed, so they live here as
 * data rather than in a component.
 *
 * Groups, by what the connection does:
 *   notes     captured notes land in Bananasplit's notes (Granola, Wispr Flow)
 *   meetings  meetings created from inside Bananasplit (Zoom, Teams, Meet)
 *   ai        your AI adds work to Bananasplit (Claude, ChatGPT)
 *   inbox     email, calendars and courses read for to-dos (Google, Outlook, Canvas)
 *   data      databases synced with the built-in ones (Supabase)
 */

export type BrandGroup = "notes" | "meetings" | "ai" | "inbox" | "data";

export interface Brand {
  name: string;
  slug: string;
  group: BrandGroup;
  /** The fallback tile's colour and its mark's colour. */
  color: string;
  ink: string;
  mark: string;
}

const brand = (
  name: string,
  slug: string,
  group: BrandGroup,
  color: string,
  ink: string,
  mark: string,
): Brand => ({ name, slug, group, color, ink, mark });

export const BRANDS: readonly Brand[] = [
  brand("Claude", "claude", "ai", "#D97757", "#FFFFFF", "C"),
  brand("ChatGPT", "chatgpt", "ai", "#0D0D0D", "#FFFFFF", "G"),
  brand("Granola", "granola", "notes", "#3F6B35", "#FFFFFF", "Gr"),
  brand("Wispr Flow", "wispr-flow", "notes", "#1B1B1F", "#F5F5F5", "W"),
  brand("Zoom", "zoom", "meetings", "#0B5CFF", "#FFFFFF", "Z"),
  brand("Microsoft Teams", "microsoft-teams", "meetings", "#5059C9", "#FFFFFF", "T"),
  brand("Google Meet", "google-meet", "meetings", "#00832D", "#FFFFFF", "M"),
  brand("Google Workspace", "google-workspace", "inbox", "#FFFFFF", "#1F1F1F", "G"),
  brand("Outlook", "outlook", "inbox", "#0078D4", "#FFFFFF", "O"),
  brand("Canvas", "canvas", "inbox", "#E72429", "#FFFFFF", "C"),
  brand("Supabase", "supabase", "data", "#1C1C1C", "#3ECF8E", "S"),
];

/** The brand with this slug (the marketing samples name the apps they show). */
export function brandBySlug(slug: string): Brand {
  const found = BRANDS.find((b) => b.slug === slug);
  if (!found) throw new Error(`Unknown brand: ${slug}`);
  return found;
}
