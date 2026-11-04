import { PhoneSettingsForm } from "@/components/crm/settings/phone-settings";
import { readPhoneStatus } from "@/server/crm/phone/connection";
import { withOrgTx, withSystemOrgTx } from "@/server/db/context";

import type { SectionProps } from "./types";

/** Phone and texts (owners and admins): provider and number, recording and its notice, hours, the voicemail. */
export async function PhoneSection({ shell, orgSlug }: SectionProps) {
  const orgId = shell.org.id;
  const status = await withSystemOrgTx(orgId, ({ db }) => readPhoneStatus(db, orgId));
  const tz = await withOrgTx(orgId, ({ db }) =>
    db.organization.findUnique({ where: { id: orgId }, select: { timezone: true } }),
  );
  return (
    <PhoneSettingsForm
      orgId={orgId}
      orgSlug={orgSlug}
      settings={status.settings}
      timezone={tz?.timezone ?? "UTC"}
      providers={[
        {
          id: "telnyx",
          label: "Telnyx",
          connected: status.telnyx.connected,
          number: status.telnyx.number,
        },
        {
          id: "twilio",
          label: "Twilio",
          connected: status.twilio.connected,
          number: status.twilio.number,
        },
      ]}
    />
  );
}
