import "../../rsvp.css";

import type { Metadata } from "next";
import Link from "next/link";

import { BrandRoot } from "@/components/brand/brand-root";
import { CoreMark } from "@/components/brand/logo";
import { PrintButton } from "@/components/rsvp/print-button";
import { QrCode } from "@/components/rsvp/qr-code";
import { appUrl } from "@/lib/app-url";
import { splitLocation } from "@/lib/rsvp/format";
import { formatCents } from "@/lib/rsvp/pay";
import { dateLine, timeLine } from "@/lib/rsvp/when";
import { brandPageAccentStyle } from "@/lib/theme/accent";
import { getPublicOrgTheme } from "@/lib/theme/loader";
import { effectivePalettes } from "@/lib/theme/resolve";
import { loadRsvpPage, rsvpPageTarget } from "@/server/rsvp/page";

/**
 * A printable flyer for an RSVP page (/e/{slug}/flyer): the event in big
 * type with a QR code to the page, and tear-off tabs along the bottom, for
 * the bulletin boards a club actually uses. It only shows what the page
 * shows anyone, so any guest can print one too. Letter size.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Flyer · Bananasplit",
  robots: { index: false, follow: false },
};

const TABS = 7;

export default async function FlyerPage({ params }: PageProps<"/e/[slug]/flyer">) {
  const { slug } = await params;
  const target = await rsvpPageTarget(slug);
  const page = target ? await loadRsvpPage(slug, target, null) : null;
  if (!page) {
    return (
      <BrandRoot>
        <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
          <h1 className="font-heading text-[32px]">This event isn&apos;t here</h1>
          <Link href="/" className="font-semibold underline">
            Go to Bananasplit
          </Link>
        </main>
      </BrandRoot>
    );
  }

  // The hosting club's accent (default theme: Bananasplit yellow), as on the page.
  const club = await getPublicOrgTheme(target!.organizationId);
  const accentStyle = (
    club && !club.theme.isDefault
      ? brandPageAccentStyle(effectivePalettes(club.theme).light.accent)
      : {}
  ) as React.CSSProperties;

  const url = appUrl(`/e/${slug}`);
  // A tear-off tab is about 0.9in of vertical text: a short name and the day.
  const tabTitle = page.title.length > 20 ? `${page.title.slice(0, 19).trimEnd()}…` : page.title;
  const tabDate = new Intl.DateTimeFormat("en-US", {
    timeZone: page.timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(page.startsAt);
  const short = url.replace(/^https?:\/\//, "");
  const place = page.location ? splitLocation(page.location) : null;
  const host = page.org.name;
  const stillNeeded = page.items.filter((i) => i.taken < i.slots).length;
  const perks = [
    page.cost
      ? page.cost.mode === "EACH"
        ? `${formatCents(page.cost.cents)} at the door or on ${page.cost.payWith[0] ?? "the page"}`
        : `${formatCents(page.cost.cents)} split between everyone`
      : "Free",
    page.capacity ? `${page.capacity} spots` : null,
    stillNeeded > 0
      ? `Bring list: ${stillNeeded} thing${stillNeeded === 1 ? "" : "s"} needed`
      : null,
  ].filter(Boolean) as string[];

  return (
    <BrandRoot look="cream">
      <div className="flyer-screen flex flex-1 flex-col items-center gap-5 px-4 py-6">
        <div className="flyer-toolbar flex w-full max-w-[8.5in] flex-wrap items-center justify-between gap-3">
          <Link href={`/e/${slug}`} className="text-ink-muted text-[14px] font-semibold">
            ← Back to the page
          </Link>
          <div className="flex items-center gap-3">
            <span className="text-ink-soft hidden text-[13px] sm:inline">
              Letter size. Cut along the dashes so people can tear off a tab.
            </span>
            <PrintButton />
          </div>
        </div>

        <article
          className="flyer-sheet bg-cream text-ink relative flex flex-col overflow-hidden"
          style={accentStyle}
        >
          {/* A flat accent band across the top: no blobs or washes. */}
          <span aria-hidden="true" className="bg-banana block h-[0.32in] flex-none" />

          <div className="relative flex min-h-0 flex-1 flex-col gap-[0.2in] overflow-hidden px-[0.6in] pt-[0.45in]">
            <div className="flex items-center justify-between">
              <span className="text-[15pt] font-semibold">You&apos;re invited</span>
              {page.cover && (
                // eslint-disable-next-line @next/next/no-img-element -- a stored WebP variant
                <img
                  src={page.cover.s480}
                  alt=""
                  className="border-ink size-[1.55in] rotate-3 rounded-[0.18in] border-[3px] object-cover"
                />
              )}
            </div>

            <h1 className="font-heading m-0 text-[clamp(44pt,9vw,68pt)] leading-[0.98] tracking-[-0.03em] text-balance break-words">
              {page.title}
            </h1>

            <div className="flex flex-col gap-[0.06in] text-[19pt] leading-[1.25]">
              <span className="font-bold">{dateLine(page.startsAt, page.timeZone)}</span>
              <span>{timeLine(page.startsAt, page.endsAt, page.timeZone, page.allDay)}</span>
              {place ? (
                <span>
                  {place.venue}
                  {place.rest ? <span className="text-ink-muted">, {place.rest}</span> : null}
                </span>
              ) : page.locationHidden ? (
                <span className="text-ink-muted">Location shared when you RSVP</span>
              ) : page.online ? (
                <span>Online</span>
              ) : null}
            </div>

            {perks.length > 0 && (
              <ul className="m-0 flex list-none flex-wrap gap-[0.12in] p-0">
                {perks.map((perk) => (
                  <li
                    key={perk}
                    className="border-ink rounded-full border-2 px-[0.16in] py-[0.05in] text-[12pt] font-bold"
                  >
                    {perk}
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-auto flex items-end gap-[0.35in] pb-[0.28in]">
              <div className="bg-paper border-ink flex-none rounded-[0.2in] border-[3px] p-[0.1in]">
                <QrCode
                  value={url}
                  label="Scan to RSVP"
                  className="block size-[2.1in]"
                  border={1}
                />
              </div>
              <div className="flex min-w-0 flex-col gap-[0.08in] pb-[0.06in]">
                <span className="font-heading text-[28pt] leading-none">Scan to RSVP</span>
                <span className="font-mono text-[12pt] break-all">{short}</span>
                <span className="text-ink-muted text-[12pt]">Hosted by {host}</span>
              </div>
            </div>
          </div>

          <div
            className="flyer-tabs border-ink relative grid border-t-2 border-dashed"
            style={{ gridTemplateColumns: `repeat(${TABS}, 1fr)` }}
          >
            {Array.from({ length: TABS }, (_, i) => (
              <div
                key={i}
                className="border-ink flex h-[1.75in] flex-col items-center justify-between border-dashed px-[0.04in] py-[0.1in] [&:not(:last-child)]:border-r-2"
              >
                <QrCode value={url} className="size-[0.62in]" border={1} />
                <span className="text-[7.5pt] leading-[1.25] whitespace-nowrap [writing-mode:vertical-rl]">
                  <span className="font-bold">{tabTitle}</span>
                  <br />
                  {tabDate}
                </span>
              </div>
            ))}
          </div>

          <div className="bg-ink text-cream flex items-center justify-center gap-2 py-[0.08in] text-[9pt]">
            <CoreMark size={12} />
            RSVP pages for your organization, free at bananasplit · split the cost, bring lists, QR
            check-in
          </div>
        </article>

        <p className="flyer-toolbar text-ink-soft m-0 max-w-[8.5in] text-center text-[13px]">
          Anyone with the event&apos;s link can print this flyer.
        </p>
      </div>
    </BrandRoot>
  );
}
