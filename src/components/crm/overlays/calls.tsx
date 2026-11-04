import { CrmCard } from "@/components/crm/card/crm-card";
import { DialLists } from "@/components/crm/phone/dial-lists";
import { Dialer } from "@/components/crm/phone/dialer";
import type { PhoneCaps } from "@/components/crm/phone/softphone";
import { formatNumber, PROVIDER_LABEL } from "@/lib/crm/phone";
import { when } from "@/lib/crm/when";
import { phoneStatus } from "@/server/crm/phone/connection";
import { callingHoursHint, dialQueue } from "@/server/crm/phone/queue";
import { withOrgTx } from "@/server/db/context";

import type { OverlayProps } from "./crm-overlays";

/**
 * Call them in a row (?open=calls, from Today's Calls group): the power
 * dialer over the calls and follow-ups due, or one of the organization's
 * lists (?dial=<list id>). It was the Calls page.
 */
export async function CallsOverlay({ shell, orgSlug, searchParams }: OverlayProps<"calls">) {
  const orgId = shell.org.id;
  const dial = typeof searchParams.dial === "string" ? searchParams.dial : null;
  const [status, data] = await Promise.all([
    phoneStatus(orgId),
    withOrgTx(orgId, async ({ db }) => {
      const views = await db.crmView.findMany({
        where: { organizationId: orgId, objectKind: "people" },
        orderBy: { createdAt: "asc" },
        take: 12,
        select: { id: true, name: true, filters: true },
      });
      const picked = dial ? views.find((v) => v.id === dial) : undefined;
      const queue = await dialQueue(
        db,
        orgId,
        shell.user.id,
        shell.roles,
        picked ? { kind: "view", filters: picked.filters } : { kind: "due" },
      );
      return { views, picked: picked?.id ?? null, queue };
    }),
  ]);
  const caps: PhoneCaps = {
    softphone: Boolean(
      status.active &&
        (status.active === "telnyx" ? status.telnyx.softphone : status.twilio.softphone) &&
        status.number,
    ),
    provider: status.active,
    canRecord: status.settings.recording !== "never",
    voicemail: Boolean(status.settings.voicemailKey),
  };
  return (
    <CrmCard
      title="Call them in a row"
      subtitle={
        status.active
          ? `Calling from ${formatNumber(status.number)} through ${PROVIDER_LABEL[status.active]}.`
          : "Calls open your phone's dialer until an owner or admin connects Telnyx or Twilio."
      }
      description="Call your list one after another"
      bodyClassName="space-y-4"
    >
      <DialLists
        // The ready-made "Follow-ups due" list is the first chip already.
        lists={data.views.filter((v) => v.name !== "Follow-ups due").map((v) => ({ id: v.id, name: v.name }))}
        picked={data.picked}
      />
      <Dialer
        key={data.picked ?? "due"}
        orgId={orgId}
        orgSlug={orgSlug}
        caps={caps}
        outsideHours={callingHoursHint(status.settings, shell.org.timezone)}
        people={data.queue.map((p) => ({
          id: p.id,
          name: p.name,
          phone: p.phone,
          sub: [p.title, p.companyName].filter(Boolean).join(" at ") || null,
          lastContacted: p.lastContactedAt ? when(p.lastContactedAt) : null,
          stepId: p.stepId,
        }))}
      />
    </CrmCard>
  );
}
