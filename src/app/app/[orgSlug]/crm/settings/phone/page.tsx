import { redirect } from "next/navigation";

import { CrmTabs } from "@/components/crm/crm-tabs";
import { PhoneSettingsForm } from "@/components/crm/settings/phone-settings";
import { CrmSettingsLinks } from "@/components/crm/settings/settings-links";
import { PageHeader } from "@/components/page-header";
import { readPhoneStatus } from "@/server/crm/phone/connection";
import { withOrgTx, withSystemOrgTx } from "@/server/db/context";

import { crmShell } from "../../shell";

export const metadata = { title: "Phone settings" };

/** Calls and texts: provider and number, recording and its notice, quiet and calling hours, the voicemail. */
export default async function CrmPhoneSettingsPage({ params }: PageProps<"/app/[orgSlug]/crm/settings/phone">) {
  const { orgSlug } = await params;
  const { gate, shell } = await crmShell(orgSlug);
  if (!shell) return gate;
  if (!shell.access.admin) redirect(`/app/${orgSlug}/crm`);
  const orgId = shell.org.id;
  const status = await withSystemOrgTx(orgId, ({ db }) => readPhoneStatus(db, orgId));
  const tz = await withOrgTx(orgId, ({ db }) => db.organization.findUnique({ where: { id: orgId }, select: { timezone: true } }));
  return (
    <div className="space-y-6">
      <PageHeader title="Phone" tabs={<CrmTabs tabs={shell.tabs} />} />
      <CrmSettingsLinks orgSlug={orgSlug} current="phone" />
      <PhoneSettingsForm
        orgId={orgId}
        orgSlug={orgSlug}
        settings={status.settings}
        timezone={tz?.timezone ?? "UTC"}
        providers={[
          { id: "telnyx", label: "Telnyx", connected: status.telnyx.connected, number: status.telnyx.number },
          { id: "twilio", label: "Twilio", connected: status.twilio.connected, number: status.twilio.number },
        ]}
      />
    </div>
  );
}
