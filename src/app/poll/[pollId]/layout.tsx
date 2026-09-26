import { PublicOrgFrame } from "@/components/theme/public-org-frame";
import { getPublicOrgTheme, orgIdForPoll } from "@/lib/theme/loader";

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
  const org = await getPublicOrgTheme(await orgIdForPoll(pollId));
  return (
    <PublicOrgFrame org={org} wide>
      {children}
    </PublicOrgFrame>
  );
}
