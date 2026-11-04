import type { Metadata } from "next";

import { Check } from "@/components/icons";
import { PublicFrame, PublicNotice } from "@/components/crm/outreach/public-frame";
import { formatMoney } from "@/lib/crm/fields";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-ip";
import { loadGuestPage } from "@/server/crm/outreach/partners";

export const metadata: Metadata = { title: "Our partnership", robots: { index: false } };

function day(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/**
 * A partner's or client's private page (/g/{token}): their agreement,
 * what we promised and how it's going, and a recap from real event and
 * attendance numbers. Nothing else in the CRM is reachable from it.
 */
export default async function GuestPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const limited = await checkRateLimit(rateLimitKey("crm-guest", await getClientIp()), 120, 3600);
  if (!limited.allowed) return <PublicNotice title="Too many visits" body="Try again in a little while." />;
  const page = await loadGuestPage(token);
  if (!page) return <PublicNotice title="This link isn't working" body="It may have been turned off. Ask your contact for a new one." />;
  const done = page.deliverables.filter((d) => d.done).length;
  return (
    <PublicFrame orgName={page.companyName ? `${page.orgName} and ${page.companyName}` : page.orgName} title={page.title} wide>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="bg-card ring-foreground/6 rounded-2xl px-4 py-3 ring-1">
          <dt className="text-muted-foreground text-xs">Where it stands</dt>
          <dd className="mt-0.5 text-[15px] font-semibold">{page.stage}</dd>
        </div>
        {page.amountCents !== null && (
          <div className="bg-card ring-foreground/6 rounded-2xl px-4 py-3 ring-1">
            <dt className="text-muted-foreground text-xs">Amount</dt>
            <dd className="mt-0.5 text-[15px] font-semibold tabular-nums">{formatMoney(page.amountCents, page.currency)}</dd>
          </div>
        )}
        {page.expectedOn && (
          <div className="bg-card ring-foreground/6 rounded-2xl px-4 py-3 ring-1">
            <dt className="text-muted-foreground text-xs">Expected</dt>
            <dd className="mt-0.5 text-[15px] font-semibold">{day(page.expectedOn)}</dd>
          </div>
        )}
        {page.contact && (
          <div className="bg-card ring-foreground/6 rounded-2xl px-4 py-3 ring-1">
            <dt className="text-muted-foreground text-xs">Your contact</dt>
            <dd className="mt-0.5 text-[15px] font-semibold">{page.contact}</dd>
          </div>
        )}
      </dl>
      <section className="bg-card ring-foreground/6 rounded-card space-y-2 p-5 ring-1">
        <h2 className="heading text-lg">So far</h2>
        {page.recap.map((l, i) => (
          <p key={i} className="text-[15px]">
            {l}
          </p>
        ))}
      </section>
      {page.deliverables.length > 0 && (
        <section className="bg-card ring-foreground/6 rounded-card space-y-3 p-5 ring-1">
          <h2 className="heading text-lg">
            What we promised, {done} of {page.deliverables.length} done
          </h2>
          <ul className="space-y-2">
            {page.deliverables.map((d, i) => (
              <li key={i} className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className={
                    d.done
                      ? "bg-tint-success text-tint-success-foreground mt-0.5 grid size-5 shrink-0 place-items-center rounded-full"
                      : "ring-foreground/20 mt-0.5 size-5 shrink-0 rounded-full ring-1"
                  }
                >
                  {d.done && <Check className="size-3.5" />}
                </span>
                <div className="min-w-0">
                  <p className="text-[15px]">
                    {d.title}
                    <span className="sr-only">{d.done ? ", done" : ", to do"}</span>
                  </p>
                  {(d.dueOn || d.proof) && (
                    <p className="text-muted-foreground text-sm">{[d.dueOn && !d.done ? `By ${day(d.dueOn)}` : null, d.done ? d.proof : null].filter(Boolean).join(". ")}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {page.events.length > 0 && (
        <section className="bg-card ring-foreground/6 rounded-card space-y-3 p-5 ring-1">
          <h2 className="heading text-lg">Events</h2>
          <ul className="space-y-1.5 text-[15px]">
            {page.events.map((e, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-3">
                <b>{e.title}</b>
                <span className="text-muted-foreground text-sm">{day(e.startsAt)}</span>
                <span className="text-sm tabular-nums">
                  {e.checkIns} checked in{e.signUps ? `, ${e.signUps} signed up` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </PublicFrame>
  );
}
