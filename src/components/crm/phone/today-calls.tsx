import Link from "next/link";

import { Phone } from "@/components/icons";
import { Card } from "@/components/ui/card";
import { crmCallsHref, crmRecordHref } from "@/lib/crm/href";
import type { RoleOwner } from "@/server/crm/owners";
import { readPhoneStatus } from "@/server/crm/phone/connection";
import { dialQueue } from "@/server/crm/phone/queue";
import { withOrgTx, withSystemOrgTx } from "@/server/db/context";

import { CallPerson } from "./call-person";
import type { PhoneCaps } from "./softphone";
import { VoiceNoteButton } from "./voice-note";

/**
 * Calls to make, on the CRM's Today (and the phone-first view of it,
 * docs/features/crm.md module 12): the follow-ups due that have a number,
 * each with Call, Log a call and a voice note, and the dialer for the rest.
 * Self-contained, so Today adds it with one line.
 */
export async function TodayCalls({
  orgId,
  orgSlug,
  userId,
  roles,
}: {
  orgId: string;
  orgSlug: string;
  userId: string;
  roles: ReadonlyMap<string, RoleOwner>;
}) {
  const status = await withSystemOrgTx(orgId, ({ db }) => readPhoneStatus(db, orgId));
  const queue = await withOrgTx(orgId, ({ db }) => dialQueue(db, orgId, userId, roles, { kind: "due" }, 6));
  if (queue.length === 0) return null;
  const caps: PhoneCaps = {
    softphone: Boolean(status.active && (status.active === "telnyx" ? status.telnyx.softphone : status.twilio.softphone) && status.number),
    provider: status.active,
    canRecord: status.settings.recording !== "never",
    voicemail: Boolean(status.settings.voicemailKey),
  };
  return (
    <Card className="gap-3 p-5">
      <h2 className="heading flex items-center gap-2 text-base">
        <Phone className="text-muted-foreground size-4" aria-hidden="true" />
        Calls to make
        <Link href={crmCallsHref(orgSlug)} className="text-muted-foreground ms-auto text-sm font-normal underline-offset-2 hover:underline">
          All calls
        </Link>
      </h2>
      <ul className="divide-border divide-y">
        {queue.slice(0, 5).map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
            <Link href={crmRecordHref(orgSlug, "person", p.id)} className="min-w-0 flex-1 truncate text-sm font-semibold hover:underline">
              {p.name}
              {p.companyName && <span className="text-muted-foreground font-normal"> {p.companyName}</span>}
            </Link>
            <CallPerson orgId={orgId} person={{ id: p.id, name: p.name, phone: p.phone, doNotContact: false }} caps={caps} />
            <VoiceNoteButton orgId={orgId} targets={[{ kind: "person", id: p.id }]} label="Note" />
          </li>
        ))}
      </ul>
    </Card>
  );
}
