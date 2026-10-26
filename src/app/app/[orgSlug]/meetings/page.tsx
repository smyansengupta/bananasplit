import { ArrowUpRight, MapPin, Plus, Ticket, Video } from "@/components/icons";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { hasMeetingLogo, MeetingLogo } from "@/components/meeting-logos";
import { VideoConnections } from "@/components/meetings/video-connections";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TickMeter } from "@/components/ui/meters";
import { shortDayAt } from "@/components/calendar/day-label";
import { KIND_META } from "@/components/calendar/kinds";
import type {
  CalendarSyncState,
  ConferenceProvider,
  EventKind,
  MeetingFormat,
} from "@/generated/prisma/enums";
import { getUserIdentity } from "@/lib/auth/email-verification";
import { isPlatformAdmin } from "@/lib/auth/org-creation";
import { can } from "@/lib/auth/permissions";
import { safeTimeZone } from "@/lib/calendar/dates";
import { newRsvpEventHref } from "@/lib/calendar/range";
import { CONFERENCE_LABELS } from "@/lib/meetings/conference-status";
import { sectionLabel } from "@/lib/nav/sidebar";
import { rsvpCover } from "@/lib/rsvp/cover";
import { timeLine } from "@/lib/rsvp/when";
import { cn } from "@/lib/utils";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";
import { myRsvpRegistrations, type RegistrationRow } from "@/server/rsvp/my-registrations";
import { loadMeetingConnections } from "@/server/conference/connections";
import {
  CONFERENCE_CALLBACK_MESSAGES,
  type ConferenceCallbackError,
} from "@/server/conference/connect";

/** Outcomes the connect routes add that are not callback errors. */
const CONNECT_NOTICES: Record<string, string> = {
  not_configured: "That provider isn't set up on this platform yet.",
  rate_limited: "Too many connection attempts. Try again in an hour.",
};

/** The OrgIntegration behind an event's provider, for its logo. */
function conferenceIntegration(provider: ConferenceProvider): string | null {
  if (provider === "MEET") return "GOOGLE_MEET";
  if (provider === "ZOOM") return "ZOOM";
  if (provider === "TEAMS") return "MICROSOFT_TEAMS";
  return null;
}

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
  format: MeetingFormat;
  location: string | null;
  conferenceProvider: ConferenceProvider;
  conferenceUrl: string | null;
  conferenceSyncState: CalendarSyncState;
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
export default async function MeetingsPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/meetings">) {
  const { orgSlug } = await params;
  // How a connect attempt went, as the callback left it on the URL.
  const sp = await searchParams;
  const connectCode = typeof sp.conference === "string" ? sp.conference : null;
  const ctx = await getOrgContextBySlug(orgSlug);
  const { organization: org, user } = ctx;
  const personal = org.kind === "PERSONAL";
  const canManage = can(ctx, "events.write");
  // Connecting a video account is the same right as any other integration:
  // owners and admins, not everyone who can make an event.
  const canConnectVideo = can(ctx, "integrations.write");
  // Switching a provider on is platform setup, not club setup: only the
  // people who run Bananasplit are told what is missing.
  const platformAdmin = isPlatformAdmin(await getUserIdentity(user.id));
  const timeZone = safeTimeZone(org.timezone);
  const now = new Date();

  const [{ events, counts }, registrations, connections] = await Promise.all([
    withOrgTx(org.id, async ({ db }) => {
      const events: PageRow[] = await db.event.findMany({
        where: {
          organizationId: org.id,
          deletedAt: null,
          mergedIntoId: null,
          // Hosts work from the whole list. Everyone else sees what they can
          // act on: something to join, or a page open for sign-ups, still to
          // come. Row policies have already limited this to what they may see.
          ...(canManage
            ? {}
            : {
                endsAt: { gt: now },
                OR: [{ rsvpEnabled: true }, { conferenceUrl: { not: null } }],
              }),
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
          format: true,
          location: true,
          conferenceProvider: true,
          conferenceUrl: true,
          conferenceSyncState: true,
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
    canManage ? loadMeetingConnections(org.id) : Promise.resolve([]),
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
    // No sign-up page means nobody to count. Offer to open one instead of
    // showing "0 going" on every meeting in the list.
    if (!e.rsvpSlug) {
      return canManage ? (
        <span className="text-muted-foreground text-[13px]">No sign-up page</span>
      ) : null;
    }
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
              {e.rsvpSlug && !e.rsvpEnabled && (
                <Badge variant="secondary" title="Its sign-up page is turned off">
                  Sign-ups off
                </Badge>
              )}
            </span>
            <span className="text-muted-foreground block text-[13px]">
              {listWhen(e.startsAt, e.endsAt, timeZone, e.allDay)}
            </span>
            {shapeLine(e)}
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

  /**
   * What kind of meeting this is, in one line: where it is, or what you join.
   * An online meeting still waiting for its link says so rather than showing
   * nothing, because the job that makes it runs just after the save.
   */
  const shapeLine = (e: PageRow) => {
    const integration = conferenceIntegration(e.conferenceProvider);
    const waiting =
      e.format !== "IN_PERSON" &&
      !e.conferenceUrl &&
      e.conferenceSyncState === "PENDING";
    const place = e.location?.trim();
    const parts: React.ReactNode[] = [];

    if (e.conferenceUrl) {
      parts.push(
        <span key="call" className="inline-flex items-center gap-1.5">
          {integration && hasMeetingLogo(integration) ? (
            <MeetingLogo provider={integration} className="size-3.5" />
          ) : (
            <Video className="size-3.5" aria-hidden="true" />
          )}
          {CONFERENCE_LABELS[e.conferenceProvider]}
        </span>,
      );
    } else if (waiting) {
      parts.push(
        <span key="call" className="text-muted-foreground inline-flex items-center gap-1.5">
          {integration && <MeetingLogo provider={integration} className="size-3.5 opacity-60" />}
          Getting the link…
        </span>,
      );
    }
    if (place) {
      parts.push(
        <span key="place" className="inline-flex min-w-0 items-center gap-1.5">
          <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{place}</span>
        </span>,
      );
    }
    if (parts.length === 0) return null;
    return (
      <span className="text-muted-foreground flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px]">
        {parts}
      </span>
    );
  };

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
        title={sectionLabel(ctx.settings?.sidebar, "meetings")}
        description={
          // The live line once there is something to count; until then, what this is.
          summary ||
          (personal
            ? "Calls, meet-ups and event pages anyone can RSVP to, plus everything you've signed up for."
            : canManage
              ? "Set up a call, an in-person meeting, or an event with a sign-up page."
              : "What's coming up that you can join or sign up for.")
        }
        actions={newEvent("create")}
      />

      {canManage && (
        <VideoConnections
          orgId={org.id}
          connections={connections}
          canConnect={canConnectVideo}
          platformAdmin={platformAdmin}
          notice={
            connectCode
              ? connectCode === "connected"
                ? { ok: true, text: "Connected. Online meetings get a link automatically." }
                : {
                    ok: false,
                    text:
                      CONNECT_NOTICES[connectCode] ??
                      CONFERENCE_CALLBACK_MESSAGES[connectCode as ConferenceCallbackError] ??
                      "That didn't connect. Try again.",
                  }
              : null
          }
        />
      )}

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
            icon={Video}
            title="No meetings yet"
            description={
              <>
                Set one up and pick its shape: an online call, somewhere to be in person, or an
                event with a sign-up page. Connect Google Meet, Zoom or Teams and the join link is
                made for you.
              </>
            }
            action={newEvent("secondary")}
          />
        ) : (
          <EmptyState
            icon={Ticket}
            title="Nothing coming up"
            description="Meetings you can join, and events taking sign-ups, show here."
          />
        )
      ) : canManage ? (
        <>
          {upcoming.length > 0 && (
            <section className="space-y-3" aria-labelledby="upcoming-heading">
              <h2 id="upcoming-heading" className="heading flex items-center gap-2 text-[17px]">
                {personal ? "Your meetings" : "Coming up"}
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
