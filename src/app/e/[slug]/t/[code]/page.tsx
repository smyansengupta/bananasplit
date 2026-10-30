import type { Metadata } from "next";
import Link from "next/link";

import { BrandRoot } from "@/components/brand/brand-root";
import { Logo } from "@/components/brand/logo";
import { pill } from "@/components/brand/pill";
import { QrCode } from "@/components/rsvp/qr-code";
import { TicketCheckIn } from "@/components/rsvp/ticket-check-in";
import { appUrl } from "@/lib/app-url";
import { getSession } from "@/lib/auth/session";
import { displayName } from "@/lib/rsvp/format";
import { formatCents } from "@/lib/rsvp/pay";
import { dateLine, startTime, timeLine } from "@/lib/rsvp/when";
import { isEventHost, loadTicket } from "@/server/rsvp/ticket";
import { mainShare } from "@/lib/metadata/share";

/**
 * A guest's ticket: /e/{slug}/t/{code}, the QR on their RSVP card and in
 * their emails. The guest shows it at the door; a host who scans it with
 * any camera opens this same URL and, signed in, gets the check-in screen.
 * Plain on purpose (no page background): it's read at a glance in a
 * doorway. Not indexed, and the code is 12 random characters.
 */
export const dynamic = "force-dynamic";

// The main card, src/app/opengraph-image.png. The code is in the path, never the preview.
export const metadata: Metadata = {
  ...mainShare({
    title: "Ticket",
    description: "Your ticket. Show it at the door.",
    noIndex: true,
  }),
  referrer: "no-referrer",
};

export default async function TicketPage({ params }: PageProps<"/e/[slug]/t/[code]">) {
  const { slug, code } = await params;
  const ticket = await loadTicket(slug, code);
  if (!ticket) return <Missing slug={slug} />;

  const session = await getSession();
  const host = session ? await isEventHost(session.user.id, ticket.organizationId) : false;
  const e = ticket.event;
  const when = `${dateLine(e.startsAt, e.timeZone)} · ${timeLine(e.startsAt, e.endsAt, e.timeZone, e.allDay)}`;

  return (
    <BrandRoot className="bg-background">
      <header className="mx-auto flex w-full max-w-[480px] items-center justify-between px-5 py-4">
        <Link href={`/e/${slug}`} aria-label="Back to the event page" className="text-foreground">
          <Logo size={22} textSize={16} />
        </Link>
        <span className="text-muted-foreground text-[13px] font-semibold">
          {host ? "Check-in" : "Your ticket"}
        </span>
      </header>
      <main className="mx-auto flex w-full max-w-[480px] flex-1 flex-col gap-4 px-5 pb-12">
        <section className="border-border bg-card rounded-block flex flex-col gap-5 border p-5 sm:p-6">
          <div className="border-border flex flex-col gap-0.5 border-b pb-4">
            <h1 className="m-0 text-[17px] leading-[1.3] font-bold text-balance">{e.title}</h1>
            <p className="text-muted-foreground m-0 text-[14px]">{when}</p>
            <p className="text-muted-foreground m-0 text-[14px]">Hosted by {e.hostName}</p>
          </div>
          {host ? (
            <TicketCheckIn
              organizationId={ticket.organizationId}
              eventId={ticket.eventId}
              registrationId={ticket.registrationId}
              name={displayName(ticket.name)}
              status={ticket.status}
              checkedInAt={ticket.checkedInAt ? startTime(ticket.checkedInAt, e.timeZone) : null}
              cost={ticket.cost}
              doorHref={e.doorHref}
            />
          ) : (
            <GuestTicket ticketUrl={appUrl(`/e/${slug}/t/${code}`)} ticket={ticket} />
          )}
        </section>

        {!host && (
          <Link href={`/e/${slug}`} className={pill({ tone: "outline", size: "md" })}>
            Back to the event page
          </Link>
        )}
      </main>
    </BrandRoot>
  );
}

function GuestTicket({
  ticketUrl,
  ticket,
}: {
  ticketUrl: string;
  ticket: NonNullable<Awaited<ReturnType<typeof loadTicket>>>;
}) {
  const going = ticket.status === "GOING";
  const name = displayName(ticket.name);
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <div className="rounded-tile w-full max-w-[300px] bg-white p-3">
        <QrCode value={ticketUrl} label={`Ticket for ${name}`} className="size-full" />
      </div>
      <div className="flex flex-col gap-1">
        <span className="font-heading text-[26px] leading-[1.1]">{name}</span>
        <span className="text-muted-foreground text-[15px]">
          {ticket.checkedInAt
            ? "You're checked in. Enjoy it!"
            : going
              ? "Show this at the door. The host scans it to check you in."
              : ticket.status === "WAITLIST"
                ? "You're on the waitlist. We'll email you if a spot opens up."
                : "This sign-up was cancelled."}
        </span>
      </div>
      {ticket.cost && going && !ticket.cost.confirmed && (
        <p className="bg-muted text-foreground rounded-field m-0 w-full px-4 py-3 text-[14px]">
          {ticket.cost.claimed
            ? `You said you paid ${formatCents(ticket.cost.paidCents ?? ticket.cost.owes)}.`
            : `You still owe the host ${formatCents(ticket.cost.owes)}.`}
        </p>
      )}
    </div>
  );
}

function Missing({ slug }: { slug: string }) {
  return (
    <BrandRoot className="bg-background">
      <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        <Logo size={28} textSize={20} />
        <h1 className="font-heading m-0 text-[32px] leading-[1.05] tracking-[-0.02em]">
          This ticket isn&apos;t valid
        </h1>
        <p className="text-muted-foreground m-0 max-w-[400px] text-[16px]">
          The link may be mistyped, or the event was removed. Open the event page to check your
          sign-up.
        </p>
        <Link href={`/e/${encodeURIComponent(slug)}`} className={pill({ size: "md" })}>
          Go to the event page
        </Link>
      </main>
    </BrandRoot>
  );
}
