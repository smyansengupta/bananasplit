import { hashInvitationToken } from "@/lib/invitations";
import { PublicOrgFrame } from "@/components/theme/public-org-frame";
import { getPublicOrgTheme, orgIdForInviteTokenHash } from "@/lib/theme/loader";

/**
 * Themes the invite page with the inviting org (B8): the org's colours,
 * default mode and logo. The page itself is the Settings builder's; this
 * layout only frames it. The raw token is hashed exactly as the invitation
 * lookup does, and an unknown token gets the plain default frame.
 */
export default async function InviteLayout({ params, children }: LayoutProps<"/invite/[token]">) {
  const { token } = await params;
  const org = await getPublicOrgTheme(await orgIdForInviteTokenHash(hashInvitationToken(token)));
  return <PublicOrgFrame org={org}>{children}</PublicOrgFrame>;
}
