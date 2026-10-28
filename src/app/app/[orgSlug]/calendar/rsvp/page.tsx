import { ArrowUpRight, Plus, Ticket } from "@/components/icons";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TickMeter } from "@/components/ui/meters";
import { shortDayAt } from "@/components/calendar/day-label";
import { KIND_META } from "@/components/calendar/kinds";
import type { EventKind } from "@/generated/prisma/enums";
import { can } from "@/lib/auth/permissions";
import { safeTimeZone } from "@/lib/calendar/dates";
import { newRsvpEventHref } from "@/lib/calendar/range";
import { sectionLabel } from "@/lib/nav/sidebar";
import { rsvpCover } from "@/lib/rsvp/cover";
import { timeLine } from "@/lib/rsvp/when";
import { cn } from "@/lib/utils";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { myRsvpRegistrations, type RegistrationRow } from "@/server/rsvp/my-registrations";

/** Your sign-ups read for this page (the lookup's own ceiling). */
const MY_TICKETS = 50;

interface PageRow {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  rsvpEnabled: boolean;
  rsvpSlug: string | null;
  rsvpCapacity: number | null;
  rsvpCover: unknown;
  kind: EventKind;
}

/**
 * RSVPs, its own sidebar section in Personal and in every club:
 * - Your tickets: events you're going to or waitlisted for. In Personal,
 *   every one of them; in a club, the club's.
 * - Owners and admins (and you, in Personal): every event with an RSVP page,
 *   coming up first, with sign-ups at a glance; each opens its guest list
 *   and page settings.
 * - Everyone else in a club: the club's events taking sign-ups now, each
 *   opening its public page to sign up there.
 */
export default async function RsvpsPage({ params }: PageProps<"/app/[orgSlug]/calendar/rsvp">) {
  const { orgSlug } = await params;
  const ctx = await getOrgContextBySlug(orgSlug);
  const { organization: org, user } = ctx;
  const personal = org.kind === "PERSONAL";
  const canManage = can(ctx, "events.write");
  const timeZone = safeTimeZone(org.timezone);
  const now = new Date();

  const [{ events, counts }, registrations] = await Promise.all([
    withOrgTx(org.id, async ({ db }) => {
      const events: PageRow[] = await db.event.findMany({
        where: {
          organizationId: org.id,
          deletedAt: null,
          rsvpSlug: { not: null },
          // Members see what they can sign up for: pages that are on, still to come.
          ...(canManage ? {} : { rsvpEnabled: true, endsAt: { gt: now } }),
        },
        orderBy: { startsAt: "asc" },
        select: {
          id: true,
          title: true,
          startsAt: true,
          endsAt: true,
          allDay: true,
          rsvpEnabled: true,
          rsvpSlug: true,
          rsvpCapacity: true,
          rsvpCover: true,
          kind: true,
        },
      });
      // Head counts are the hosts' view.
      const counts = canManage
        ? await db.eventRegistration.groupBy({
            by: ["eventId", "status"],
            where: {
              organizationId: org.id,
              eventId: { in: events.map((e) => e.id) },
              status: { in: ["GOING", "WAITLIST"] },
            },
            _count: { _all: true },
          })
        : [];
      return { events, counts };
    }),
    myRsvpRegistrations(user.id, MY_TICKETS),
  ]);

  const countOf = (eventId: string, status: string) =>
    counts.find((c) => c.eventId === eventId && c.status === status)?._count._all ?? 0;
  const here = new Set(events.map((e) => e.id));
  const tickets = personal ? registrations : registrations.filter((r) => here.has(r.eventId));
  const ticketFor = new Map(tickets.map((r) => [r.eventId, r]));
  const upcoming = events.filter((e) => e.endsAt > now);
  const past = events.filter((e) => e.endsAt <= now).reverse();
  // Whoever can make events: the Calendar's New event, with the RSVP page on.
  // The header's is the screen's one create button; the empty state repeats
  // it quietly.
  const newEvent = (variant: "create" | "secondary") =>
    canManage ? (
      <Button variant={variant} asChild>
        <Link href={newRsvpEventHref(orgSlug)}>
          <Plus aria-hidden="true" />
          New event
        </Link>
      </Button>
    ) : null;

  // The live line: what's taking sign-ups now, and who's coming.
  const openPages = upcoming.filter((e) => e.rsvpEnabled);
  const goingSoon = openPages.reduce((n, e) => n + countOf(e.id, "GOING"), 0);
  const summary = [
    openPages.length > 0 &&
      `${openPages.length} ${openPages.length === 1 ? "page" : "pages"} taking RSVPs`,
    canManage && openPages.length > 0 && `${goingSoon} going`,
    tickets.length > 0 &&
      `${tickets.length} ${tickets.length === 1 ? "ticket" : "tickets"} of yours`,
  ]
    .filter(Boolean)
    .join(" · ");

  const hrefOf = (e: PageRow) =>
    canManage
      ? `/app/${orgSlug}/calendar/${e.id}/rsvp`
      : e.rsvpSlug
        ? `/e/${e.rsvpSlug}`
        : `/app/${orgSlug}/calendar/${e.id}`;

  // What each card says on the right: the head count for hosts, your own
  // status for everyone else.
  const statusOf = (e: PageRow) => {
    const going = countOf(e.id, "GOING");
    const waiting = countOf(e.id, "WAITLIST");
    const mine = ticketFor.get(e.id);
    if (canManage) {
      return (
        <span className="flex min-w-0 flex-col gap-1.5 text-sm tabular-nums">
          <span>
            <span className="font-semibold">{going}</span>
            <span className="text-muted-foreground">
              {e.rsvpCapacity ? ` of ${e.rsvpCapacity}` : ""} going
              {waiting > 0 ? ` · ${waiting} waitlisted` : ""}
            </span>
          </span>
          {e.rsvpCapacity && e.rsvpCapacity <= 60 ? (
            <TickMeter
              total={e.rsvpCapacity}
              filled={going}
              height={8}
              color="var(--success)"
              label={`${going} of ${e.rsvpCapacity} spots taken`}
              className="w-full max-w-40"
            />
          ) : null}
        </span>
      );
    }
    return mine ? (
      <Badge variant={mine.status === "WAITLIST" ? "accent" : "success"}>
        {mine.status === "WAITLIST" ? "On the waitlist" : "You're going"}
      </Badge>
    ) : (
      <Badge variant="outline">RSVP</Badge>
    );
  };

  const card = (e: PageRow, featured = false) => (
    <li key={e.id} className={cn(featured && "sm:col-span-2")}>
      <Link
        href={hrefOf(e)}
        className={cn(
          "group bg-card text-card-foreground edge rounded-card focus-glow hover:shadow-e2 flex h-full overflow-hidden transition-[transform,box-shadow] duration-200 ease-(--ease-ink) hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0",
          featured ? "flex-col sm:flex-row" : "flex-col",
        )}
      >
        <Cover
          title={e.title}
          cover={e.rsvpCover}
          kind={e.kind}
          startsAt={e.startsAt}
          timeZone={timeZone}
          className={
            featured ? "aspect-[16/10] sm:aspect-auto sm:min-h-56 sm:w-1/2" : "aspect-[16/9]"
          }
        />
        <span className={cn("flex min-w-0 flex-1 flex-col gap-3", featured ? "p-6" : "p-4.5")}>
          <span className="space-y-1">
            {featured && <span className="eyebrow block">Next up</span>}
            <span className="flex items-start gap-2">
              <span
                className={cn(
                  "min-w-0 font-semibold break-words",
                  featured ? "display-title text-2xl" : "line-clamp-2 text-[15px]",
                )}
              >
                {e.title}
              </span>
              {!e.rsvpEnabled && <Badge variant="secondary">Off</Badge>}
            </span>
            <span className="text-muted-foreground block text-[13px]">
              {KIND_META[e.kind].label} · {listWhen(e.startsAt, e.endsAt, timeZone, e.allDay)}
            </span>
          </span>
          <span className="mt-auto flex items-end justify-between gap-3">
            {statusOf(e)}
            <ArrowUpRight
              className="text-muted-foreground group-hover:text-foreground size-4 flex-none transition-colors"
              aria-hidden="true"
            />
          </span>
        </span>
      </Link>
    </li>
  );

  /** A grid of event cards, like Files; the first upcoming one is the wide "Next up". */
  const pageList = (items: PageRow[], feature = false) => (
    <ul className="grid gap-4.5 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((e, i) => card(e, feature && i === 0 && items.length > 1))}
    </ul>
  );
  const coverOf = new Map(events.map((e) => [e.id, e.rsvpCover]));

  return (
    <div className="space-y-7.5">
      <PageHeader
        title={sectionLabel(ctx.settings?.sidebar, "rsvps")}
        description={
          // The live line once there is something to count; until then, what this is.
          summary ||
          (personal
            ? "Event pages anyone can RSVP to, no account needed, and every event you've signed up for."
            : canManage
              ? "Public sign-up pages for the organization's events, and your own tickets. Start one here, or from any event's page."
              : "The organization's events taking sign-ups, and your tickets.")
        }
        actions={newEvent("create")}
      />

      {tickets.length > 0 && (
        <section className="space-y-3" aria-labelledby="tickets-heading">
          <h2 id="tickets-heading" className="heading flex items-center gap-2 text-[17px]">
            Your tickets <Badge variant="secondary">{tickets.length}</Badge>
          </h2>
          <TicketList tickets={tickets} showHost={personal} covers={coverOf} />
        </section>
      )}

      {events.length === 0 ? (
        canManage ? (
          <EmptyState
            icon={Ticket}
            title="No RSVP pages yet"
            description={
              <>
                Make a new event with a sign-up page, or open one you already have and choose{" "}
                <Ticket className="inline size-3.5 align-[-2px]" aria-hidden="true" /> Set up an
                RSVP page.
              </>
            }
            action={newEvent("secondary")}
          />
        ) : (
          <EmptyState
            icon={Ticket}
            title="Nothing taking sign-ups right now"
            description="When the organization opens RSVPs for an event, it shows here and you can sign up in a click."
          />
        )
      ) : canManage ? (
        <>
          {upcoming.length > 0 && (
            <section className="space-y-3" aria-labelledby="upcoming-heading">
              <h2 id="upcoming-heading" className="heading flex items-center gap-2 text-[17px]">
                {personal ? "Your event pages" : "Event pages"}
                <Badge variant="secondary">{upcoming.length}</Badge>
              </h2>
              {pageList(upcoming, true)}
            </section>
          )}
          {past.length > 0 && (
            <section className="space-y-3" aria-labelledby="past-heading">
              <h2
                id="past-heading"
                className="heading text-muted-foreground flex items-center gap-2 text-[17px]"
              >
                Past <Badge variant="secondary">{past.length}</Badge>
              </h2>
              {pageList(past)}
            </section>
          )}
        </>
      ) : (
        <section className="space-y-3" aria-labelledby="open-heading">
          <h2 id="open-heading" className="heading flex items-center gap-2 text-[17px]">
            Taking RSVPs <Badge variant="secondary">{upcoming.length}</Badge>
          </h2>
          {pageList(upcoming, true)}
        </section>
      )}
    </div>
  );
}

/** "Today, 6:00 – 7:00 PM EDT", "Wed, Oct 14, ...": the day as the app says it. */
function listWhen(start: Date, end: Date, timeZone: string, allDay: boolean): string {
  return `${shortDayAt(start, timeZone)}, ${timeLine(start, end, timeZone, allDay)}`;
}

const MONTH = (timeZone: string) => new Intl.DateTimeFormat("en-US", { month: "short", timeZone });
const DAY = (timeZone: string) => new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone });

/**
 * The event's picture (its RSVP cover), with a calendar-leaf date on it.
 * Without a cover: the event's first letter on a tint of its kind's colour
 * (the calendar's), with a faint ticket behind it.
 */
function Cover({
  title,
  cover: stored,
  kind,
  startsAt,
  timeZone,
  className,
}: {
  title: string;
  cover: unknown;
  kind?: EventKind;
  startsAt: Date;
  timeZone: string;
  className?: string;
}) {
  const cover = rsvpCover(stored);
  const token = kind ? KIND_META[kind].token : "--primary";
  return (
    <span
      className={cn("relative block overflow-hidden", className)}
      style={{ background: `color-mix(in oklab, var(${token}) 26%, var(--card))` }}
    >
      {cover ? (
        // eslint-disable-next-line @next/next/no-img-element -- a stored WebP variant
        <img
          src={cover.s960}
          alt=""
          loading="lazy"
          className="absolute inset-0 size-full object-cover transition-transform duration-300 group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
        />
      ) : (
        <span aria-hidden="true" className="absolute inset-0 grid place-items-center">
          <Ticket className="absolute size-32 -rotate-12 opacity-[0.08]" strokeWidth={1.25} />
          <span className="font-heading text-foreground/80 relative text-5xl">
            {title.trim()[0]?.toUpperCase() ?? "B"}
          </span>
        </span>
      )}
      <span className="bg-card text-card-foreground rounded-tile shadow-e1 absolute top-3 left-3 flex w-12 flex-col items-center py-1.5 leading-none">
        <span className="text-muted-foreground text-[11px] font-semibold uppercase">
          {MONTH(timeZone).format(startsAt)}
        </span>
        <span className="numeral mt-0.5 text-lg">{DAY(timeZone).format(startsAt)}</span>
      </span>
    </span>
  );
}

/** Your tickets: a card each, the event's picture beside it like a stub. */
function TicketList({
  tickets,
  showHost,
  covers,
}: {
  tickets: RegistrationRow[];
  showHost: boolean;
  covers: Map<string, unknown>;
}) {
  return (
    <ul className="grid gap-4.5 sm:grid-cols-2 xl:grid-cols-3">
      {tickets.map((r) => {
        const zone = safeTimeZone(r.spaceTimezone);
        return (
          <li
            key={r.registrationId}
            className="bg-card text-card-foreground edge rounded-card flex overflow-hidden"
          >
            <Cover
              title={r.title}
              cover={covers.get(r.eventId)}
              startsAt={r.startsAt}
              timeZone={zone}
              className="w-28 flex-none"
            />
            <span className="border-border flex min-w-0 flex-1 flex-col gap-3 border-l border-dashed p-4">
              <span className="min-w-0">
                <Link
                  href={`/e/${r.rsvpSlug}`}
                  className="line-clamp-2 text-[15px] font-semibold underline-offset-4 hover:underline"
                >
                  {r.title}
                </Link>
                <span className="text-muted-foreground mt-0.5 block text-[13px]">
                  {listWhen(r.startsAt, r.endsAt, zone, r.allDay)}
                  {showHost && r.spaceKind === "CLUB" ? ` · ${r.spaceName}` : ""}
                </span>
              </span>
              <span className="mt-auto">
                {r.status === "WAITLIST" ? (
                  <Badge variant="accent">On the waitlist</Badge>
                ) : (
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`/e/${r.rsvpSlug}/t/${r.ticketCode}`}>
                      <Ticket aria-hidden="true" />
                      Show ticket
                    </Link>
                  </Button>
                )}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
