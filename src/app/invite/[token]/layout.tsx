import type { Metadata } from "next";
import { cache } from "react";

import { hashInvitationToken } from "@/lib/invitations";
import { PublicOrgFrame } from "@/components/theme/public-org-frame";
import { clubShare, FALLBACK_CARDS } from "@/lib/metadata/share";
import { getPublicOrgTheme, orgIdForInviteTokenHash } from "@/lib/theme/loader";

/**
 * The inviting org, once per request: generateMetadata and the layout both
 * want it, and the token -> org id lookup is the one part of this that is
 * not already cached (getOrgBranding is). An unknown token gives null, and
 * both callers fall back to the plain default.
 */
const invitingOrg = cache(async (token: string) =>
  getPublicOrgTheme(await orgIdForInviteTokenHash(hashInvitationToken(token))),
);

/**
 * What an emailed invite link previews as: "You've been invited to join <club>
 * on Bananasplit", with the club's own logo as the picture and as the tab's
 * icon. The club's name and logo are already public on this page (the frame
 * below themes it with them before anyone signs in), so the preview shows
 * nothing the link did not already show; the token never appears in it, and
 * the page stays out of search either way.
 */
export async function generateMetadata({
  params,
}: LayoutProps<"/invite/[token]">): Promise<Metadata> {
  const { token } = await params;
  const club = await invitingOrg(token);
  if (!club) {
    return {
      title: "Invite · Bananasplit",
      description: "This invite link isn't valid.",
      robots: { index: false, follow: false },
    };
  }
  return clubShare({
    club,
    title: `You've been invited to join ${club.name} on Bananasplit`,
    description: `${club.name} runs on Bananasplit: tasks, docs, meetings and the budget in one place. Open the link to accept.`,
    fallback: FALLBACK_CARDS.invite,
  });
}

/**
 * Themes the invite page with the inviting org (B8): the org's colours,
 * default mode and logo. The page itself is the Settings builder's; this
 * layout only frames it. The raw token is hashed exactly as the invitation
 * lookup does, and an unknown token gets the plain default frame.
 */
export default async function InviteLayout({ params, children }: LayoutProps<"/invite/[token]">) {
  const { token } = await params;
  const org = await invitingOrg(token);
  return <PublicOrgFrame org={org}>{children}</PublicOrgFrame>;
}
