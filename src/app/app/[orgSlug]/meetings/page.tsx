import { Plus, Ticket, Video } from "@/components/icons";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { Cover, listWhen, MeetingCard, type MeetingRow } from "@/components/meetings/meeting-card";
import { VideoConnections } from "@/components/meetings/video-connections";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getUserIdentity } from "@/lib/auth/email-verification";
import { isPlatformAdmin } from "@/lib/auth/org-creation";
import { can } from "@/lib/auth/permissions";
import { safeTimeZone } from "@/lib/calendar/dates";
import { newRsvpEventHref } from "@/lib/calendar/range";
import { conferenceStatus } from "@/lib/meetings/conference-status";
import { sectionLabel } from "@/lib/nav/sidebar";
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

/** Your sign-ups read for this page (the lookup's own ceiling). */
const MY_TICKETS = 50;

/**
 * Meetings, its own sidebar section in Personal and in every organization:
 * - Your tickets: events you're going to or waitlisted for. In Personal,
 *   every one of them; in an organization, its own.
 * - Owners and admins (and you, in Personal): every meeting, coming up first,
 *   with its shape, its join link and sign-ups at a glance.
 * - Everyone else in an organization: its meetings with a call to join or a
 *   page taking sign-ups, still to come.
 * Every card opens the meeting's page (`/meetings/{id}`); Join and Copy link
 * are on the card for the one thing most people come here to do.
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
      const rows: MeetingRow[] = await db.event.findMany({
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
          conferenceManaged: true,
          conferenceUrl: true,
          conferenceSyncState: true,
          conferenceSyncError: true,
          // Not conferenceHostUrl: it starts the meeting as host, and nothing
          // on this list needs it. The meeting's page hands it to editors.
        },
      });
      // The stored error can name an account or a setting that is not for
      // everyone, so only people who can edit a meeting get it on the card.
      const events: MeetingRow[] = canManage
        ? rows
        : rows.map((e) => ({ ...e, conferenceSyncError: null }));
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

  // Every card opens the meeting's own page: hosts manage sign-ups from there,
  // and everyone else finds the join details and the sign-up link there.
  const hrefOf = (e: MeetingRow) => `/app/${orgSlug}/meetings/${e.id}`;

  const card = (e: MeetingRow, featured = false) => (
    <MeetingCard
      key={e.id}
      event={e}
      canManage={canManage}
      status={conferenceStatus(e, canManage)}
      href={hrefOf(e)}
      timeZone={timeZone}
      featured={featured}
      going={countOf(e.id, "GOING")}
      waiting={countOf(e.id, "WAITLIST")}
      mine={ticketFor.get(e.id)?.status ?? null}
    />
  );

  /** A grid of event cards, like Files; the first upcoming one is the wide "Next up". */
  const pageList = (items: MeetingRow[], feature = false) => (
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
