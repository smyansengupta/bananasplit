import type { Metadata } from "next";

import { BookForm } from "@/components/crm/outreach/book-form";
import { PublicFrame, PublicNotice } from "@/components/crm/outreach/public-frame";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-ip";
import { loadBooking } from "@/server/crm/outreach/booking";

export const metadata: Metadata = { title: "Book a time", robots: { index: false } };

/**
 * A booking page (/book/{slug}): anyone with the link picks a free time
 * and books it, no sign-in. Times come from the hosts' availability and
 * calendars (src/server/crm/outreach/booking.ts). Rate-limited per visitor.
 */
export default async function BookPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const limited = await checkRateLimit(rateLimitKey("crm-book-view", await getClientIp()), 120, 3600);
  if (!limited.allowed) return <PublicNotice title="Too many visits" body="Try again in a little while." />;
  const page = await loadBooking(slug);
  if (!page) return <PublicNotice title="This booking page isn't open" body="Ask whoever sent it for a new link." />;
  return (
    <PublicFrame orgName={page.hosts.length === 1 ? `With ${page.hosts[0]!.name}, ${page.orgName}` : page.orgName} title={page.title}>
      {page.description && <p className="text-[15px] whitespace-pre-wrap">{page.description}</p>}
      <BookForm
        slug={slug}
        tz={page.tz}
        durationMin={page.durationMin}
        slots={page.slots.map((s) => s.start.toISOString())}
        questions={page.questions}
      />
    </PublicFrame>
  );
}
