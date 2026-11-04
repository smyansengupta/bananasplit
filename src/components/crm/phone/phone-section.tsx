import Link from "next/link";

import { Section } from "@/components/crm/record-page";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/crm/fields";
import { crmQuoteHref } from "@/lib/crm/href";
import { formatDuration, outcomeLabel, readConsent } from "@/lib/crm/phone";
import { effectiveStatus, KIND_WORD, STATUS_WORD, type QuoteKind, type QuoteStatus } from "@/lib/crm/quotes";
import { readPhoneStatus } from "@/server/crm/phone/connection";
import { withOrgTx, withSystemOrgTx } from "@/server/db/context";

import { NewQuoteButtons } from "../quotes/new-quote";
import { CallPerson } from "./call-person";
import type { PhoneCaps } from "./softphone";
import { TextThread } from "./texts";
import { VoiceNoteButton } from "./voice-note";

/**
 * Calls, texts, voice notes and quotes on a person, company or item page
 * (Phase 5): one self-contained section, so the record pages add it with an
 * import and one line. Everything is read as the viewer (RLS decides),
 * except whether a phone provider is connected (members can't read
 * integrations, so that comes from the service path, non-secret only).
 */

type Target = { kind: "person" | "company" | "deal"; id: string };

const when = (d: Date) =>
  d.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const quoteVariant = (s: QuoteStatus) =>
  s === "ACCEPTED" || s === "PAID" ? "success" : s === "DECLINED" || s === "EXPIRED" ? "outline" : s === "SENT" ? "info" : "secondary";

export async function PhoneSection({ orgId, orgSlug, target }: { orgId: string; orgSlug: string; target: Target }) {
  const status = await withSystemOrgTx(orgId, ({ db }) => readPhoneStatus(db, orgId));
  const data = await withOrgTx(orgId, async ({ db }) => {
    let people: { id: string; name: string; phone: string | null; doNotContact: boolean; consent: unknown }[] = [];
    let companyId: string | null = null;
    let dealId: string | null = null;
    const personSelect = { id: true, name: true, phone: true, doNotContact: true, consent: true } as const;
    if (target.kind === "person") {
      const p = await db.crmPerson.findFirst({ where: { id: target.id, organizationId: orgId }, select: { ...personSelect, companyId: true } });
      if (p) {
        people = [p];
        companyId = p.companyId;
      }
    } else if (target.kind === "company") {
      companyId = target.id;
      people = await db.crmPerson.findMany({
        where: { organizationId: orgId, companyId: target.id, deletedAt: null, phone: { not: null } },
        select: personSelect,
        orderBy: { lastContactedAt: { sort: "desc", nulls: "last" } },
        take: 3,
      });
    } else {
      const d = await db.crmDeal.findFirst({
        where: { id: target.id, organizationId: orgId },
        select: { id: true, companyId: true, people: { select: { person: { select: personSelect } }, take: 3 } },
      });
      if (d) {
        dealId = d.id;
        companyId = d.companyId;
        people = d.people.map((x) => x.person);
      }
    }
    // The calls on this record's timeline (a company's or an item's too).
    const onTimeline = await db.crmActivityTarget.findMany({
      where: { organizationId: orgId, targetKind: target.kind, targetId: target.id, activity: { kind: "CALL" } },
      orderBy: { occurredAt: "desc" },
      take: 20,
      select: { activityId: true },
    });
    const calls = await db.crmCall.findMany({
      where: {
        organizationId: orgId,
        OR: [
          { activityId: { in: onTimeline.map((t) => t.activityId) } },
          ...(target.kind === "person" ? [{ personId: target.id }] : []),
        ],
      },
      orderBy: { startedAt: "desc" },
      take: 5,
      select: { id: true, startedAt: true, outcome: true, durationSec: true, recordingKey: true, summary: true, direction: true, personId: true },
    });
    const texts =
      target.kind === "person"
        ? (
            await db.crmTextMessage.findMany({
              where: { organizationId: orgId, personId: target.id },
              orderBy: { sentAt: "desc" },
              take: 30,
              select: { id: true, direction: true, body: true, status: true, sentAt: true },
            })
          ).reverse()
        : [];
    const quotes = await db.crmQuote.findMany({
      where: {
        organizationId: orgId,
        ...(target.kind === "deal" ? { dealId: target.id } : target.kind === "company" ? { companyId: target.id } : { personId: target.id }),
      },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, dealId: true, kind: true, number: true, title: true, status: true, totalCents: true, currency: true, validUntil: true },
    });
    return { people, companyId, dealId, calls, texts, quotes };
  });

  const caps: PhoneCaps = {
    softphone: Boolean(status.active && (status.active === "telnyx" ? status.telnyx.softphone : status.twilio.softphone) && status.number),
    provider: status.active,
    canRecord: status.settings.recording !== "never",
    voicemail: Boolean(status.settings.voicemailKey),
  };
  const names = new Map(data.people.map((p) => [p.id, p.name]));
  const person = target.kind === "person" ? data.people[0] : null;
  const consent = person ? readConsent(person.consent).text : undefined;
  const voiceTargets: Target[] = [
    target,
    ...(target.kind !== "company" && data.companyId ? [{ kind: "company" as const, id: data.companyId }] : []),
  ];
  const quoteTarget =
    target.kind === "deal" ? { dealId: target.id } : target.kind === "company" ? { companyId: target.id } : { personId: target.id };

  return (
    <>
      <Section title="Calls" action={<VoiceNoteButton orgId={orgId} targets={voiceTargets} />}>
        {data.people.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {target.kind === "person" ? "" : "Add someone with a phone number to call them from here."}
          </p>
        ) : (
          <ul className="space-y-3">
            {data.people.map((p) => (
              <li key={p.id} className="space-y-1.5">
                {target.kind !== "person" && <p className="text-sm font-semibold">{p.name}</p>}
                <CallPerson
                  orgId={orgId}
                  person={p}
                  caps={caps}
                  target={{
                    companyId: data.companyId,
                    dealId: data.dealId,
                  }}
                />
              </li>
            ))}
          </ul>
        )}
        {data.calls.length > 0 && (
          <ul className="divide-border divide-y text-sm">
            {data.calls.map((c) => (
              <li key={c.id} className="space-y-1.5 py-2">
                <div className="flex items-baseline gap-2">
                  <b>{outcomeLabel(c.outcome)}</b>
                  {target.kind !== "person" && c.personId && names.get(c.personId) && (
                    <span className="text-muted-foreground truncate">{names.get(c.personId)}</span>
                  )}
                  <span className="text-muted-foreground ms-auto shrink-0 text-xs tabular-nums">
                    {c.durationSec ? `${formatDuration(c.durationSec)}, ` : ""}
                    {when(c.startedAt)}
                  </span>
                </div>
                {c.summary && <p className="text-muted-foreground line-clamp-3 whitespace-pre-wrap">{c.summary}</p>}
                {c.recordingKey && (
                  <audio controls preload="none" className="h-9 w-full" src={`/api/orgs/${orgId}/crm/audio?call=${c.id}`}>
                    <track kind="captions" />
                  </audio>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
      {person && (
        <Section title="Texts">
          <TextThread
            orgId={orgId}
            personId={person.id}
            texts={data.texts.map((t) => ({ ...t, sentAt: t.sentAt.toISOString() }))}
            consent={consent ? (consent.granted ? "granted" : "opted-out") : "none"}
            enabled={Boolean(status.active && status.number) && !person.doNotContact}
          />
        </Section>
      )}
      <Section title="Quotes and invoices" action={<NewQuoteButtons orgId={orgId} orgSlug={orgSlug} target={quoteTarget} />}>
        {data.quotes.length === 0 ? (
          <p className="text-muted-foreground text-sm">None yet.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {data.quotes.map((q) => {
              const s = effectiveStatus({ status: q.status, validUntil: q.validUntil });
              return (
                <li key={q.id} className="flex items-center gap-2">
                  <Link href={crmQuoteHref(orgSlug, q)} className="min-w-0 flex-1 truncate font-semibold hover:underline">
                    {q.number} {q.title}
                  </Link>
                  <span className="text-muted-foreground text-xs">{KIND_WORD[q.kind as QuoteKind]?.title}</span>
                  <Badge variant={quoteVariant(s)}>{STATUS_WORD[s]}</Badge>
                  <span className="text-xs tabular-nums">{formatMoney(q.totalCents, q.currency)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </>
  );
}
