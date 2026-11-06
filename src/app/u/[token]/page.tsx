import type { Metadata } from "next";

import { PublicFrame, PublicNotice } from "@/components/crm/outreach/public-frame";
import { UnsubscribeForm } from "@/components/crm/outreach/unsubscribe-form";
import { unsubscribeView } from "@/server/crm/outreach/public";

export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false } };

/**
 * Unsubscribe (/u/{token}), from the link in a sequence, campaign or bulk
 * email's footer. Mail apps' one-click unsubscribe posts to
 * /api/crm/u/{token} instead. It applies to every member and every
 * channel of the organization.
 */
export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await unsubscribeView(token).catch(() => null);
  if (!view) return <PublicNotice title="This link isn't working" body="If you still get emails you don't want, reply to one and ask." />;
  return (
    <PublicFrame orgName={view.orgName} title={view.unsubscribed ? "You're unsubscribed" : `Hi ${view.firstName ?? "there"}`}>
      <UnsubscribeForm token={token} orgName={view.orgName} initial={view.unsubscribed} />
    </PublicFrame>
  );
}
