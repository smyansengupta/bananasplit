import type { Brand } from "@/components/marketing/brands";

/**
 * The data connectors' tiles on Integrations and apps (Tavily, Hunter,
 * Prospeo): each maker's own colour and letters, kept in lib beside the
 * other integration marks (src/lib/integrations/marks.ts), because a maker's
 * colour is not a theme colour.
 */
const mark = (name: string, slug: string, color: string, letters: string): Brand => ({
  name,
  slug,
  group: "inbox",
  color,
  ink: "#FFFFFF",
  mark: letters,
});

export const DATA_CONNECTOR_MARKS = {
  tavily: mark("Tavily", "tavily", "#1F4FD8", "Tv"),
  hunter: mark("Hunter", "hunter", "#F26A35", "H"),
  prospeo: mark("Prospeo", "prospeo", "#5B3DF5", "P"),
} as const;
