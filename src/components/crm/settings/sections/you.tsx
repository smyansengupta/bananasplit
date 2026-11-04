import Link from "next/link";

import { SettingsCard } from "@/app/app/[orgSlug]/settings/settings-card";
import { CopyLink } from "@/components/crm/outreach/booking";
import { Button } from "@/components/ui/button";
import { appUrl } from "@/lib/app-url";
import { bookingLinksHref } from "@/lib/crm/settings-sections";
import { inboundDomain } from "@/server/crm/outreach/mailbox";
import { ensureMemberSettings } from "@/server/crm/outreach/member";
import { withOrgTx } from "@/server/db/context";

import { RecentCalls } from "../recent-calls";
import { DetailsCard, YourMailCard } from "../you-settings";
import { HandedToYou } from "./handover";
import type { SectionProps } from "./types";

/**
 * You: your name and signature, your mail and the CRM, your booking link,
 * and the people handed to you lately (?role= for a position's). Only you
 * see these.
 */
export async function YouSection({ shell, orgSlug, sp }: SectionProps) {
  const orgId = shell.org.id;
  const data = await withOrgTx(orgId, async ({ db, userId }) => ({
    settings: await ensureMemberSettings(db, orgId, userId),
    // Your own booking link (Meetings > Booking links; made the first time you open it there).
    booking: await db.crmBookingPage.findFirst({
      where: { organizationId: orgId, ownerUserId: userId },
      select: { id: true, slug: true, title: true, active: true },
    }),
  }));
  const name = shell.members.find((m) => m.id === shell.user.id)?.name ?? shell.user.name ?? "You";
  const bookingHref = bookingLinksHref(orgSlug, data.booking?.id ?? null);
  return (
    <>
      <DetailsCard orgId={orgId} name={name} signature={data.settings.signature ?? ""} />
      <YourMailCard
        orgId={orgId}
        bccAddress={data.settings.bccAddress}
        inboundReady={Boolean(inboundDomain())}
        shareMode={data.settings.shareMode}
        neverLog={data.settings.neverLog}
      />
      <SettingsCard
        title="Your booking link"
        description="Share it anywhere, or type / in a message to drop it in. You set its hours in Meetings."
        footer={
          <Button variant="outline" asChild>
            <Link href={bookingHref}>{data.booking ? "Change it in Meetings" : "Open it in Meetings"}</Link>
          </Button>
        }
      >
        {data.booking?.active ? (
          <CopyLink url={appUrl(`/book/${data.booking.slug}`)} label="Copy your booking link" />
        ) : (
          <p className="text-muted-foreground text-sm">
            {data.booking ? "It's off. Turn it on in Meetings." : "It's ready the first time you open it in Meetings."}
          </p>
        )}
      </SettingsCard>
      <HandedToYou shell={shell} orgSlug={orgSlug} role={sp.role} />
      <RecentCalls orgId={orgId} orgSlug={orgSlug} userId={shell.user.id} />
    </>
  );
}
