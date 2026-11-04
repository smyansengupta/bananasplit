import type { Metadata } from "next";

import { PublicFrame, PublicNotice } from "@/components/crm/outreach/public-frame";
import { SelfUpdateForm } from "@/components/crm/outreach/self-update-form";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-ip";
import { loadSelfUpdate } from "@/server/crm/outreach/self-update";

export const metadata: Metadata = { title: "Your details", robots: { index: false } };

/**
 * Update your details (/c/{token}): a contact keeps their own email, title,
 * phone and workplace current, from the link in an RSVP confirmation or a
 * form receipt. Only their own record is reachable, and only these fields.
 */
export default async function SelfUpdatePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const limited = await checkRateLimit(rateLimitKey("crm-self-view", await getClientIp()), 60, 3600);
  if (!limited.allowed) return <PublicNotice title="Too many visits" body="Try again in a little while." />;
  const view = await loadSelfUpdate(token);
  if (!view) return <PublicNotice title="This link isn't working" body="Ask whoever sent it for a new one." />;
  return (
    <PublicFrame orgName={`So ${view.orgName} has them right`} title="Your details">
      <SelfUpdateForm
        token={token}
        initial={{ name: view.name, email: view.email ?? "", title: view.title ?? "", phone: view.phone ?? "", company: view.company ?? "" }}
      />
    </PublicFrame>
  );
}
