import Link from "next/link";

import { SettingsCard } from "@/app/app/[orgSlug]/settings/settings-card";
import { CopyLink } from "@/components/crm/outreach/booking";
import { Button } from "@/components/ui/button";
import { appUrl } from "@/lib/app-url";
import { crmSettingsHref } from "@/lib/crm/settings-sections";
import { inboundDomain } from "@/server/crm/outreach/mailbox";
import { ensureMemberSettings } from "@/server/crm/outreach/member";
import { withOrgTx } from "@/server/db/context";

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
    booking: await db.crmBookingPage.findFirst({
      where: { organizationId: orgId, active: true, hostIds: { has: userId } },
      orderBy: { createdAt: "asc" },
      select: { slug: true, title: true },
    }),
  }));
  const name = shell.members.find((m) => m.id === shell.user.id)?.name ?? shell.user.name ?? "You";
  const bookingHref = crmSettingsHref(orgSlug, "booking");
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
        description="Share it anywhere, or type / in a message to drop it in."
        footer={
          <Button variant="outline" asChild>
            <Link href={bookingHref}>{data.booking ? "Change it" : "Make your booking link"}</Link>
          </Button>
        }
      >
        {data.booking ? (
          <CopyLink url={appUrl(`/book/${data.booking.slug}`)} label="Copy your booking link" />
        ) : (
          <p className="text-muted-foreground text-sm">
            You don&apos;t have one yet. It takes a minute.
          </p>
        )}
      </SettingsCard>
      <HandedToYou shell={shell} orgSlug={orgSlug} role={sp.role} />
    </>
  );
}
