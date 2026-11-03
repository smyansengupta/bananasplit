import Link from "next/link";

import { CrmTabs } from "@/components/crm/crm-tabs";
import { AddTextSender } from "@/components/crm/phone/add-text-sender";
import { Dialer } from "@/components/crm/phone/dialer";
import type { PhoneCaps } from "@/components/crm/phone/softphone";
import { when } from "@/components/crm/record-page";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { serverChipClass as chipClass } from "@/components/crm/chip-class";
import { crmRecordHref } from "@/lib/crm/href";
import { formatDuration, formatNumber, outcomeLabel } from "@/lib/crm/phone";
import { cn } from "@/lib/utils";
import { readPhoneStatus } from "@/server/crm/phone/connection";
import { callingHoursHint, dialQueue } from "@/server/crm/phone/queue";
import { withOrgTx, withSystemOrgTx } from "@/server/db/context";

import { crmShell } from "../shell";

export const metadata = { title: "Calls" };

/**
 * Calls (docs/features/crm.md module 5): the power dialer over the
 * follow-ups due or any saved view of people, your recent calls, and texts
 * from numbers that aren't in the CRM yet.
 */
export default async function CrmCallsPage({ params, searchParams }: PageProps<"/app/[orgSlug]/crm/calls">) {
  const { orgSlug } = await params;
  const sp = (await searchParams) as Record<string, string | undefined>;
  const { gate, shell } = await crmShell(orgSlug);
  if (!shell) return gate;
  const orgId = shell.org.id;
  const status = await withSystemOrgTx(orgId, ({ db }) => readPhoneStatus(db, orgId));
  const data = await withOrgTx(orgId, async ({ db }) => {
    const views = await db.crmView.findMany({
      where: { organizationId: orgId, objectKind: "people" },
      orderBy: { createdAt: "asc" },
      take: 12,
      select: { id: true, name: true, filters: true },
    });
    const picked = sp.list?.startsWith("view:") ? views.find((v) => `view:${v.id}` === sp.list) : undefined;
    const queue = await dialQueue(
      db,
      orgId,
      shell.user.id,
      shell.roles,
      picked ? { kind: "view", filters: picked.filters } : { kind: "due" },
    );
    const calls = await db.crmCall.findMany({
      where: { organizationId: orgId, userId: shell.user.id },
      orderBy: { startedAt: "desc" },
      take: 20,
      select: {
        id: true,
        startedAt: true,
        outcome: true,
        durationSec: true,
        recordingKey: true,
        person: { select: { id: true, name: true } },
      },
    });
    const recent = await db.crmTextMessage.findMany({
      where: { organizationId: orgId, direction: "INBOUND", personId: null },
      orderBy: { sentAt: "desc" },
      take: 50,
      select: { id: true, fromNumber: true, body: true, sentAt: true },
    });
    // One row per number: its latest text, and how many came in.
    const unmatched: ((typeof recent)[number] & { count: number })[] = [];
    for (const t of recent) {
      const seen = unmatched.find((u) => u.fromNumber === t.fromNumber);
      if (seen) seen.count++;
      else if (unmatched.length < 10) unmatched.push({ ...t, count: 1 });
    }
    const org = await db.organization.findUnique({ where: { id: orgId }, select: { timezone: true } });
    return { views, picked: picked?.id ?? null, queue, calls, unmatched, timezone: org?.timezone ?? "UTC" };
  });
  const caps: PhoneCaps = {
    softphone: Boolean(status.active && (status.active === "telnyx" ? status.telnyx.softphone : status.twilio.softphone) && status.number),
    provider: status.active,
    canRecord: status.settings.recording !== "never",
    voicemail: Boolean(status.settings.voicemailKey),
  };
  const base = `/app/${orgSlug}/crm/calls`;
  const lists = [{ id: "due", name: "Calls and follow-ups due", href: base, active: !data.picked }].concat(
    data.views
      // The ready-made "Follow-ups due" view is the first list already.
      .filter((v) => v.name !== "Follow-ups due")
      .map((v) => ({ id: v.id, name: v.name, href: `${base}?list=view:${v.id}`, active: data.picked === v.id })),
  );
  return (
    <div className="space-y-6">
      <PageHeader
        title="Calls"
        description={
          status.active
            ? `Calling from ${formatNumber(status.number)} through ${status.active === "telnyx" ? "Telnyx" : "Twilio"}.`
            : "Calls open your phone's dialer. Connect Telnyx or Twilio to call from the browser."
        }
        tabs={<CrmTabs tabs={shell.tabs} />}
      />
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Who to call">
        {lists.map((l) => (
          <Link key={l.id} href={l.href} className={cn(chipClass(l.active), "h-8 px-3 text-[13px]")} aria-current={l.active ? "page" : undefined}>
            {l.name}
          </Link>
        ))}
      </div>
      <Dialer
        key={data.picked ?? "due"}
        orgId={orgId}
        orgSlug={orgSlug}
        caps={caps}
        outsideHours={callingHoursHint(status.settings, data.timezone)}
        people={data.queue.map((p) => ({
          id: p.id,
          name: p.name,
          phone: p.phone,
          sub: [p.title, p.companyName].filter(Boolean).join(" at ") || null,
          lastContacted: p.lastContactedAt ? when(p.lastContactedAt) : null,
          stepId: p.stepId,
        }))}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="gap-3 p-5">
          <h2 className="heading text-base">Your recent calls</h2>
          {data.calls.length === 0 ? (
            <p className="text-muted-foreground text-sm">No calls yet.</p>
          ) : (
            <ul className="divide-border divide-y text-sm">
              {data.calls.map((c) => (
                <li key={c.id} className="space-y-1.5 py-2">
                  <div className="flex items-baseline gap-2">
                    {c.person ? (
                      <Link href={crmRecordHref(orgSlug, "person", c.person.id)} className="truncate font-semibold hover:underline">
                        {c.person.name}
                      </Link>
                    ) : (
                      <b>A call</b>
                    )}
                    <span className="text-muted-foreground">{outcomeLabel(c.outcome)}</span>
                    <span className="text-muted-foreground ms-auto shrink-0 text-xs tabular-nums">
                      {c.durationSec ? `${formatDuration(c.durationSec)}, ` : ""}
                      {when(c.startedAt)}
                    </span>
                  </div>
                  {c.recordingKey && (
                    <audio controls preload="none" className="h-9 w-full" src={`/api/orgs/${orgId}/crm/audio?call=${c.id}`}>
                      <track kind="captions" />
                    </audio>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="gap-3 p-5">
          <h2 className="heading text-base">Texts from numbers not in the CRM</h2>
          {data.unmatched.length === 0 ? (
            <p className="text-muted-foreground text-sm">None. Texts from people in the CRM go on their timeline.</p>
          ) : (
            <ul className="divide-border divide-y text-sm">
              {data.unmatched.map((t) => (
                <li key={t.id} className="py-2">
                  <div className="flex items-baseline gap-2">
                    <b className="tabular-nums">{formatNumber(t.fromNumber)}</b>
                    {t.count > 1 && <span className="text-muted-foreground text-xs">{t.count} texts</span>}
                    <span className="text-muted-foreground ms-auto text-xs">{when(t.sentAt)}</span>
                  </div>
                  <p className="text-muted-foreground line-clamp-2">{t.body}</p>
                  <AddTextSender orgId={orgId} orgSlug={orgSlug} textId={t.id} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
