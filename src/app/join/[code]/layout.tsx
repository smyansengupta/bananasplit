import type { Metadata } from "next";

import { PublicOrgFrame } from "@/components/theme/public-org-frame";
import { clubShare, FALLBACK_CARDS, shareMetadata } from "@/lib/metadata/share";

import { clubForCode } from "./club";

/**
 * What a texted invite code previews as: "You've been invited to join <club>
 * on Bananasplit", wearing the club's logo as the picture and the tab's
 * icon. Only the club's public name and logo are shown, the same an emailed
 * invite link already shows signed out; the code never appears in the
 * metadata, and the page stays out of search. A code that opens nothing, or
 * a club without a logo, previews as the drawn join card (public/og/join.png).
 */
export async function generateMetadata({ params }: LayoutProps<"/join/[code]">): Promise<Metadata> {
  const { code } = await params;
  const club = await clubForCode(code);
  if (!club) {
    return shareMetadata({
      title: "Join your club",
      description: "Open the link to join your club's workspace on Bananasplit.",
      noIndex: true,
      card: FALLBACK_CARDS.join,
    });
  }
  return clubShare({
    club,
    title: `You've been invited to join ${club.name} on Bananasplit`,
    description: `Tasks, docs, meetings and the budget for ${club.name}, in one place. Open the link to join.`,
    fallback: FALLBACK_CARDS.join,
  });
}

/** Themes the page with the club the code opens, like an emailed invite. */
export default async function JoinCodeLayout({ params, children }: LayoutProps<"/join/[code]">) {
  const { code } = await params;
  return <PublicOrgFrame org={await clubForCode(code)}>{children}</PublicOrgFrame>;
}
