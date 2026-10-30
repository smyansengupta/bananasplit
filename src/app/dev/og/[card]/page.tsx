import { notFound } from "next/navigation";

import { OG_CARDS, OG_HEIGHT, OG_WIDTH } from "@/components/marketing/og/og-cards";

/**
 * /dev/og/<card> (development only, like all of /dev): one link-preview
 * card on its own, at exactly 1200x630 and always in light, for
 *
 *   node scripts/capture-og.mjs
 *
 * which screenshots each one into the opengraph-image.png files listed in
 * scripts/og-cards.json. Open it in a browser to see a card while editing
 * src/components/marketing/og/og-cards.tsx.
 */
export default async function DevOgCardPage({ params }: PageProps<"/dev/og/[card]">) {
  const { card } = await params;
  const drawing = OG_CARDS[card];
  if (!drawing) notFound();
  return (
    <div
      className="light grid min-h-screen place-items-center bg-white"
      style={{ colorScheme: "light", width: OG_WIDTH, height: OG_HEIGHT }}
    >
      {drawing}
    </div>
  );
}
