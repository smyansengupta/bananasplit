import type { Metadata } from "next";
import { cache } from "react";

import { PublicOrgFrame } from "@/components/theme/public-org-frame";
import { clubShare, shareMetadata } from "@/lib/metadata/share";
import { getPublicOrgTheme, orgIdForPoll } from "@/lib/theme/loader";

/**
 * The org running the poll, once per request: generateMetadata and the
 * layout both want it, and the poll -> org id lookup is the one part that
 * is not already cached (getOrgBranding is).
 */
const pollOrg = cache(async (pollId: string) => getPublicOrgTheme(await orgIdForPoll(pollId)));

/**
 * What a shared poll link previews as (iMessage, Slack, X): an ask to fill
 * the poll in, named after the club running it and wearing its logo. A club
 * without a logo falls back to the drawn card beside this file,
 * opengraph-image.png and twitter-image.png.
 */
export async function generateMetadata({
  params,
}: LayoutProps<"/poll/[pollId]">): Promise<Metadata> {
  const { pollId } = await params;
  const club = await pollOrg(pollId);
  const description = "Mark the times you're free. No account needed, just your name.";
  if (!club) {
    return shareMetadata({ title: "Fill out this availability poll", description, noIndex: true });
  }
  return clubShare({ club, title: `${club.name} is finding a time`, description });
}

/**
 * Themes the public availability poll with the org that runs it (B8): the
 * org's colours, default mode and logo. The page itself is the Calendar
 * builder's; this layout only frames it.
 */
export default async function PublicPollLayout({
  params,
  children,
}: LayoutProps<"/poll/[pollId]">) {
  const { pollId } = await params;
  const org = await pollOrg(pollId);
  return (
    <PublicOrgFrame org={org} wide>
      {children}
    </PublicOrgFrame>
  );
}
