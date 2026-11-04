import type { Metadata } from "next";

import { BookForm } from "@/components/crm/outreach/book-form";
import { PublicNotice } from "@/components/crm/outreach/public-frame";
import { PublicThemeRoot } from "@/components/theme/public-theme-root";
import { initialsOf } from "@/lib/crm/outreach/booking-calendar";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-ip";
import { loadBooking } from "@/server/crm/outreach/booking";

export const metadata: Metadata = { title: "Book a time", robots: { index: false } };

/**
 * A booking page (/book/{slug}; the Booking design): anyone with the link
 * picks a free time and books it, no sign-in. The organization's name and
 * logo on top, then one card: who you're meeting and for how long on the
 * left, a month calendar, the day's times and a short form on the right,
 * and "You're booked" once done. Times come from the hosts' availability
 * and calendars (src/server/crm/outreach/booking.ts). Rate-limited per visitor.
 */
export default async function BookPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const limited = await checkRateLimit(
    rateLimitKey("crm-book-view", await getClientIp()),
    120,
    3600,
  );
  if (!limited.allowed)
    return <PublicNotice title="Too many visits" body="Try again in a little while." />;
  const page = await loadBooking(slug);
  if (!page)
    return (
      <PublicNotice
        title="This booking page isn't open"
        body="Ask whoever sent it for a new link."
      />
    );
  const host = page.hosts.length === 1 ? page.hosts[0]!.name : null;
  return (
    <PublicThemeRoot>
      <main className="bg-background text-foreground flex min-h-dvh flex-col items-center gap-9 px-4 pt-10 pb-16 sm:px-8">
        <header className="flex items-center gap-3">
          {page.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={page.logoUrl}
              alt=""
              className="bg-card ring-foreground/10 size-11 rounded-full object-contain ring-1"
            />
          ) : (
            <span
              aria-hidden="true"
              className="bg-foreground text-background display-title grid size-11 place-items-center rounded-full text-base"
            >
              {initialsOf(page.orgName)}
            </span>
          )}
          <b className="text-lg">{page.orgName}</b>
        </header>
        <BookForm
          slug={slug}
          tz={page.tz}
          durationMin={page.durationMin}
          slots={page.slots.map((s) => s.start.toISOString())}
          questions={page.questions}
          heading={host ? `Meet with ${host}` : page.title}
          hostName={host}
          description={
            page.description ?? (host && !/^meet with/i.test(page.title.trim()) ? page.title : null)
          }
        />
        <footer className="text-muted-foreground text-xs">Made with Bananasplit.</footer>
      </main>
    </PublicThemeRoot>
  );
}
