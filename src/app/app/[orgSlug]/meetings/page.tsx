import { ArrowUpRight, MapPin, Plus, Ticket, Video } from "@/components/icons";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { hasMeetingLogo, MeetingLogo } from "@/components/meeting-logos";
import { VideoConnections } from "@/components/meetings/video-connections";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/user-avatar";
import { Button } from "@/components/ui/button";
import { TickMeter } from "@/components/ui/meters";
import { shortDayAt } from "@/components/calendar/day-label";

import type {
  CalendarSyncState,
  ConferenceProvider,
  MeetingFormat,
} from "@/generated/prisma/enums";
import { getUserIdentity } from "@/lib/auth/email-verification";
import { isPlatformAdmin } from "@/lib/auth/org-creation";
import { can } from "@/lib/auth/permissions";
import { safeTimeZone } from "@/lib/calendar/dates";
import { newEventHref } from "@/lib/calendar/range";
import { sectionLabel } from "@/lib/nav/sidebar";
import { rsvpCover } from "@/lib/rsvp/cover";
import { tagStyle, tagToken } from "@/lib/calendar/tags";
import { until } from "@/lib/relative-time";
import { timeLine } from "@/lib/rsvp/when";
import { cn } from "@/lib/utils";
import { getOrgContextBySlug, withOrgTx } from "@/server/db/context";

import { MeetingCardActions } from "./meeting-card-actions";
import { MeetingsCreateActions } from "./meetings-create-actions";
import { userPublicSelect } from "@/server/members";
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

/** What a card calls each kind of call. */
const CONFERENCE_LABELS: Record<ConferenceProvider, string> = {
  NONE: "",
  MEET: "Google Meet",
  ZOOM: "Zoom",
  TEAMS: "Microsoft Teams",
  OTHER: "Online",
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
  /** The event's own Featured flag: these get the wide card. */
  featured: boolean;
  tag: { name: string; color: string | null } | null;
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

  const [{ events, counts, attendees }, registrations, connections] =
    await Promise.all([
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
            featured: true,
            tag: { select: { name: true, color: true } },
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
        // Who was invited from the club and what they said, so a card can
        // show the people rather than a blank picture.
        const attendees = await db.eventAttendee.findMany({
          where: { organizationId: org.id, eventId: { in: events.map((e) => e.id) } },
          select: { eventId: true, rsvp: true, user: { select: userPublicSelect } },
        });
        return { events, counts, attendees };
      }),
      myRsvpRegistrations(user.id, MY_TICKETS),
      canManage ? loadMeetingConnections(org.id) : Promise.resolve([]),
    ]);

  const countOf = (eventId: string, status: string) =>
    counts.find((c) => c.eventId === eventId && c.status === status)?._count._all ?? 0;

  /**
   * Who is on a meeting: the faces of the people going, then the numbers.
   * A meeting nobody was invited to has none, and the card leaves the row
   * out rather than saying "0 going".
   */
  const FACES = 5;
  const crowdOf = (eventId: string) => {
    const rows = attendees.filter((a) => a.eventId === eventId);
    if (rows.length === 0) return null;
    const going = rows.filter((a) => a.rsvp === "YES");
    const maybe = rows.filter((a) => a.rsvp === "MAYBE").length;
    const awaited = rows.filter((a) => a.rsvp === "PENDING").length;
    // The people who said yes lead; with none yet, show who was asked.
    const faces = (going.length > 0 ? going : rows).slice(0, FACES).map((a) => a.user);
    return { faces, going: going.length, maybe, awaited, invited: rows.length };
  };
  const myRsvp = (eventId: string) =>
    attendees.find((a) => a.eventId === eventId && a.user.id === user.id)?.rsvp ?? null;
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
        <Link href={newEventHref(orgSlug, { rsvp: true, from: "meetings" })}>
          <Plus aria-hidden="true" />
          New event
        </Link>
      </Button>
    ) : null;

  // The header's pair: the event flow on the left, a meeting on the right.
  const createActions = canManage ? <MeetingsCreateActions orgSlug={orgSlug} /> : null;

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

  // Hosts land on the event itself — the sign-up page is a section of it,
  // and a card that only opened the sign-up page left no way to the event.
  const hrefOf = (e: PageRow) =>
    canManage || !e.rsvpSlug ? `/app/${orgSlug}/calendar/${e.id}` : `/e/${e.rsvpSlug}`;

  /**
   * The sign-up line, under the crowd: how full the page is for a host,
   * where you stand for everyone else.
   *
   * The meter runs the width of the card rather than sitting in a 160px
   * stub beside the head count, because how full a page is is the thing a
   * host came to this list to read, and a bar you have to squint at is
   * worth less than the number already above it.
   */
  const statusOf = (e: PageRow) => {
    const going = countOf(e.id, "GOING");
    const waiting = countOf(e.id, "WAITLIST");
    const mine = ticketFor.get(e.id);
    // No sign-up page means nobody to count here: the club's own invitees
    // are on the card already (crowdOf), so this says nothing at all rather
    // than "No sign-up page" on every internal meeting.
    if (!e.rsvpSlug) return null;
    if (canManage) {
      const full = e.rsvpCapacity ? going >= e.rsvpCapacity : false;
      return (
        <span className="flex min-w-0 flex-col gap-1.5">
          <span className="flex items-baseline justify-between gap-3 text-[13px] tabular-nums">
            <span className="text-muted-foreground">
              {e.rsvpCapacity ? "Signed up" : "Sign-ups"}
              {waiting > 0 ? ` · ${waiting} waitlisted` : ""}
            </span>
            <span className="numeral text-[15px]">
              {going}
              {e.rsvpCapacity ? (
                <span className="text-muted-foreground font-normal"> / {e.rsvpCapacity}</span>
              ) : null}
            </span>
          </span>
          {e.rsvpCapacity && e.rsvpCapacity <= 60 ? (
            <TickMeter
              total={e.rsvpCapacity}
              filled={going}
              height={8}
              color={full ? "var(--warning)" : "var(--success)"}
              label={`${going} of ${e.rsvpCapacity} spots taken`}
              className="w-full"
            />
          ) : null}
        </span>
      );
    }
    return (
      <span className="flex">
        {mine ? (
          <Badge variant={mine.status === "WAITLIST" ? "accent" : "success"}>
            {mine.status === "WAITLIST" ? "On the waitlist" : "You're going"}
          </Badge>
        ) : (
          <Badge variant="outline">RSVP</Badge>
        )}
      </span>
    );
  };

  /**
   * One meeting.
   *
   * WHAT A CARD IS FOR. A list of meetings is read at a glance and acted on
   * once: which one is next, what kind it is, where to be, who is coming.
   * The old card said all of that in one grey column of 13px text, so every
   * card looked like every other card and the page had no shape to scan.
   *
   * So the card is built around the event's own TYPE COLOUR (its tag:
   * --kind, from the palette in lib/calendar/tags.ts). The colour arrives
   * twice — the wash behind the date tile and the dot on the type chip —
   * and nowhere does it carry meaning on its own: the type is written
   * beside the dot, the date beside the tile. A bar of it across the top
   * of every card was tried and taken out again; it read as decoration.
   *
   * The rest is a fixed rhythm, so a card is read the same way every time:
   *   type + how soon · date tile + title + when · where · who
   * with the last row pinned to the bottom (mt-auto) so a two-line title
   * and a one-line title still end level across a row of cards.
   *
   * Past meetings keep the shape and lose the colour (saturate-0, dimmed):
   * they read as finished without being a different card.
   */
  const card = (e: PageRow, featured = false, first = false) => {
    const hasCover = Boolean(rsvpCover(e.rsvpCover));
    const crowd = crowdOf(e.id);
    const mine = myRsvp(e.id);
    const soon = e.startsAt > now ? until(e.startsAt, now) : null;
    const over = e.endsAt <= now;
    return (
      <li key={e.id} className={cn(featured && "sm:col-span-2")}>
        <MeetingCardActions
          title={e.title}
          openLabel={canManage ? "Open its guest list" : "Open"}
          openHref={hrefOf(e)}
          signUpHref={e.rsvpSlug ? `/e/${e.rsvpSlug}` : null}
          calendarHref={`/app/${orgSlug}/calendar/${e.id}`}
        >
          <Link
            href={hrefOf(e)}
            style={tagStyle(e.tag?.color)}
            className={cn(
              "group bg-card text-card-foreground edge rounded-card focus-glow hover:shadow-e2 relative flex h-full flex-col overflow-hidden transition-[transform,box-shadow] duration-200 ease-(--ease-ink) hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0",
              over && "opacity-80 saturate-0 hover:opacity-100 hover:saturate-100",
            )}
          >
            <span
              className={cn("flex min-h-0 flex-1", featured ? "flex-col sm:flex-row" : "flex-col")}
            >
              {hasCover ? (
                <Cover
                  title={e.title}
                  cover={e.rsvpCover}
                  tag={e.tag}
                  startsAt={e.startsAt}
                  timeZone={timeZone}
                  className={
                    featured
                      ? "aspect-[16/10] sm:aspect-auto sm:min-h-56 sm:w-[44%]"
                      : "aspect-[16/9]"
                  }
                />
              ) : (
                // A featured event with no picture gets the panel instead: the
                // date large, on a wash of its own type's colour. Two columns
                // of white with a 14px date tile in them is a two-column gap.
                featured && <DatePanel startsAt={e.startsAt} timeZone={timeZone} />
              )}
              <span
                className={cn(
                  "flex min-w-0 flex-1 flex-col gap-3.5",
                  featured ? "p-6 sm:p-7" : "p-5",
                )}
              >
                {/* The type, and how soon it is: the two things you sort by. */}
                <span className="flex items-center justify-between gap-3">
                  {/* No type, nothing to say: the chip goes rather than
                      labelling the card "No type". */}
                  {e.tag ? <TypeChip tag={e.tag} /> : <span />}
                  {soon ? (
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-1 text-[11.5px] font-semibold whitespace-nowrap",
                        first
                          ? "bg-(--kind) text-card [text-shadow:none]"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {soon}
                    </span>
                  ) : (
                    <span className="text-muted-foreground text-[11.5px] font-medium">Finished</span>
                  )}
                </span>

                <span className="flex min-w-0 items-start gap-3.5">
                  {!hasCover && !featured && <DateTile startsAt={e.startsAt} timeZone={timeZone} />}
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    {/*
                      Only a wide card says "Next up" in words: on a normal
                      card the line would push its title a row below every
                      other title in the grid, and the lit countdown pill
                      above already says the same thing.
                    */}
                    {featured && first && (
                      <span className="text-muted-foreground text-[11.5px] font-semibold tracking-wide uppercase">
                        Next up
                      </span>
                    )}
                    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <span
                        className={cn(
                          "display-title min-w-0 break-words",
                          featured ? "text-2xl" : "line-clamp-2 text-[16.5px]",
                        )}
                      >
                        {e.title}
                      </span>
                      {e.rsvpSlug && !e.rsvpEnabled && (
                        <Badge variant="secondary" title="Its sign-up page is turned off">
                          Sign-ups off
                        </Badge>
                      )}
                      {mine === "YES" && <Badge variant="success">You&apos;re going</Badge>}
                      {mine === "MAYBE" && <Badge variant="outline">You said maybe</Badge>}
                    </span>
                    <span className="text-muted-foreground block text-[13px]">
                      {listWhen(e.startsAt, e.endsAt, timeZone, e.allDay)}
                    </span>
                  </span>
                </span>

                {/* Where, who, and the head count, under one hairline. */}
                <span className="border-border/70 mt-auto flex flex-col gap-2.5 border-t pt-3.5">
                  {shapeLine(e)}
                  <span className="flex items-end justify-between gap-3">
                    {crowd ? <Crowd {...crowd} /> : <span />}
                    <ArrowUpRight
                      className="text-muted-foreground group-hover:text-foreground mb-0.5 size-4 flex-none transition-colors"
                      aria-hidden="true"
                    />
                  </span>
                  {statusOf(e)}
                </span>
              </span>
            </span>
          </Link>
        </MeetingCardActions>
      </li>
    );
  };

  /**
   * What kind of meeting this is, in one line: where it is, or what you join.
   * An online meeting still waiting for its link says so rather than showing
   * nothing, because the job that makes it runs just after the save.
   */
  const shapeLine = (e: PageRow) => {
    const integration = conferenceIntegration(e.conferenceProvider);
    const waiting =
      e.format !== "IN_PERSON" && !e.conferenceUrl && e.conferenceSyncState === "PENDING";
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

  /**
   * A grid of event cards. An IMPORTANT event takes two columns: that is
   * the event's own Featured switch (More details > On the website), the
   * same flag the club website reads, so the thing a club has already said
   * is its big one is the big one here too.
   *
   * ONLY A COMING-UP LIST WIDENS ANYTHING (`feature`). Past is the one
   * section nobody is scanning for what to do next, and a finished event
   * given two columns and a poster-size date was the biggest thing on a
   * page of live ones.
   *
   * The next event up takes the wide card when nothing else in the list is
   * featured, so the top of the page always has something leading it;
   * `first` is what lights its countdown pill either way.
   *
   * The grid is NOT grid-flow-dense. Dense packing fills the hole a
   * two-column card leaves at the end of a row with whatever card comes
   * next that fits, which in a list ordered by start time means painting a
   * later meeting above an earlier one. A gap at the end of a row is worth
   * less than the order being true.
   */
  const pageList = (items: PageRow[], feature = false) => {
    const anyFeatured = feature && items.some((e) => e.featured);
    return (
      <ul className="grid gap-4.5 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((e, i) => {
          const lead = feature && i === 0;
          const wide = feature && (e.featured || (lead && !anyFeatured && items.length > 1));
          return card(e, wide, lead);
        })}
      </ul>
    );
  };
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
        actions={createActions}
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

const WEEKDAY = (timeZone: string) =>
  new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone });

/**
 * The date, as a tile washed in the event type's own colour: the month,
 * the day in the display face, the weekday. It used to be a flat grey
 * block with the month and the day in it, which on a page of a dozen
 * cards was a dozen grey blocks — the one element that could carry the
 * type's colour and did not.
 */
function DateTile({ startsAt, timeZone }: { startsAt: Date; timeZone: string }) {
  return (
    <span
      aria-hidden="true"
      style={{ background: "color-mix(in oklab, var(--kind) 15%, var(--card))" }}
      className="rounded-tile flex w-14 shrink-0 flex-col items-center justify-center py-2.5 leading-none ring-1 ring-(--kind)/25"
    >
      <span className="text-[10.5px] font-semibold tracking-wide text-(--kind) uppercase">
        {MONTH(timeZone).format(startsAt)}
      </span>
      <span className="numeral my-0.5 text-[22px]">{DAY(timeZone).format(startsAt)}</span>
      <span className="text-muted-foreground text-[10.5px] font-medium uppercase">
        {WEEKDAY(timeZone).format(startsAt)}
      </span>
    </span>
  );
}

/**
 * The wide card's left half when the event has no picture: the date at
 * poster size on a wash of its type's colour. This is what makes an
 * important event worth two columns when there is no cover to fill them.
 */
function DatePanel({ startsAt, timeZone }: { startsAt: Date; timeZone: string }) {
  return (
    <span
      aria-hidden="true"
      style={{
        background: "var(--kind)",
        // Black or white, whichever reads on the type's colour: the palette
        // is dark in light mode and light in dark mode (calendar.css does
        // the same thing on a time-grid block).
        color: "oklch(from var(--kind) clamp(0, (0.62 - l) * 1000, 1) 0 0)",
      }}
      className="relative flex shrink-0 flex-col items-center justify-center gap-1 px-8 py-8 leading-none sm:w-[38%] sm:py-12"
    >
      <span className="text-[13px] font-semibold tracking-[0.16em] uppercase opacity-80">
        {MONTH(timeZone).format(startsAt)}
      </span>
      <span className="numeral text-6xl sm:text-7xl">{DAY(timeZone).format(startsAt)}</span>
      <span className="text-[13px] font-medium tracking-[0.16em] uppercase opacity-70">
        {WEEKDAY(timeZone).format(startsAt)}
      </span>
    </span>
  );
}

/** The event's type: its colour as a dot, its name beside it in words. */
function TypeChip({ tag }: { tag: { name: string; color: string | null } }) {
  return (
    <span className="text-muted-foreground inline-flex min-w-0 items-center gap-1.5 text-[11.5px] font-semibold tracking-wide uppercase">
      <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-(--kind)" />
      <span className="truncate">{tag.name}</span>
    </span>
  );
}

/**
 * Who is coming: the faces of the people who said yes (or, before anyone
 * has, of the people asked), and then the count in words. This is what the
 * card had nothing of before — a meeting is people, and a list of meetings
 * that doesn't say who is on them makes you open each one to find out.
 */
function Crowd({
  faces,
  going,
  maybe,
  awaited,
  invited,
}: {
  faces: { id: string; name: string | null; image: string | null; avatar: unknown }[];
  going: number;
  maybe: number;
  awaited: number;
  invited: number;
}) {
  const line = [
    going > 0 ? `${going} going` : `${invited} invited`,
    maybe > 0 && `${maybe} maybe`,
    going > 0 && awaited > 0 && `${awaited} yet to answer`,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="flex shrink-0">
        {faces.map((u) => (
          <UserAvatar key={u.id} user={u} size="xs" className="ring-card -me-1.5 ring-2" />
        ))}
      </span>
      <span className="text-muted-foreground min-w-0 truncate ps-2 text-[13px]">{line}</span>
    </span>
  );
}

/**
 * The event's picture (its RSVP cover), with a calendar-leaf date on it.
 * Without a cover: the event's first letter on a tint of its kind's colour
 * (the calendar's), with a faint ticket behind it.
 */
function Cover({
  title,
  cover: stored,
  tag,
  startsAt,
  timeZone,
  className,
}: {
  title: string;
  cover: unknown;
  tag?: { name: string; color: string | null } | null;
  startsAt: Date;
  timeZone: string;
  className?: string;
}) {
  const cover = rsvpCover(stored);
  const token = tag ? tagToken(tag.color) : "--primary";
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
