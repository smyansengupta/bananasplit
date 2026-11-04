import Link from "next/link";

import { CrmCard } from "@/components/crm/card/crm-card";
import { AddTextSender } from "@/components/crm/phone/add-text-sender";
import { crmRecordHref } from "@/lib/crm/href";
import { formatNumber, phoneKey } from "@/lib/crm/phone";
import { when } from "@/lib/crm/when";
import { withOrgTx } from "@/server/db/context";

import type { OverlayProps } from "./crm-overlays";

/**
 * A text from a number that isn't in the CRM (?open=text:<id>, from its
 * Inbox line): what they sent from that number, and Add them to the CRM,
 * which makes them a person with those texts on their timeline. Once
 * they're in, it says so and opens their card.
 */
export async function TextOverlay({ shell, orgSlug, open }: OverlayProps<"text">) {
  const orgId = shell.org.id;
  const data = await withOrgTx(orgId, async ({ db }) => {
    const text = await db.crmTextMessage.findFirst({
      where: { id: open.id, organizationId: orgId, direction: "INBOUND" },
      select: { id: true, fromNumber: true, personId: true, person: { select: { name: true } } },
    });
    if (!text) return null;
    const key = phoneKey(text.fromNumber);
    const texts = text.personId
      ? []
      : await db.crmTextMessage.findMany({
          where: {
            organizationId: orgId,
            direction: "INBOUND",
            personId: null,
            ...(key ? { fromNumber: { endsWith: key } } : { id: text.id }),
          },
          orderBy: { sentAt: "desc" },
          take: 20,
          select: { id: true, body: true, sentAt: true },
        });
    return { text, texts };
  });
  if (!data) {
    return (
      <CrmCard title="A text">
        <p className="text-muted-foreground text-sm">That text isn&apos;t here any more.</p>
      </CrmCard>
    );
  }
  const { text, texts } = data;
  const number = formatNumber(text.fromNumber);
  if (text.personId) {
    return (
      <CrmCard title={number} subtitle="In the CRM now">
        <p className="text-sm">
          They&apos;re in the CRM as{" "}
          <Link href={crmRecordHref(orgSlug, "person", text.personId)} className="font-semibold hover:underline">
            {text.person?.name ?? "a person"}
          </Link>
          , with their texts on their timeline.
        </p>
      </CrmCard>
    );
  }
  return (
    <CrmCard
      title={number}
      subtitle={`Not in the CRM yet. ${texts.length === 1 ? "1 text" : `${texts.length} texts`} from this number.`}
      description="A text from a number that isn't in the CRM"
      foot={<AddTextSender orgId={orgId} orgSlug={orgSlug} textId={text.id} />}
    >
      <ul className="divide-border divide-y text-sm">
        {texts.map((t) => (
          <li key={t.id} className="space-y-1 py-2.5">
            <span className="text-muted-foreground text-xs">{when(t.sentAt)}</span>
            <p className="whitespace-pre-wrap">{t.body}</p>
          </li>
        ))}
      </ul>
    </CrmCard>
  );
}
