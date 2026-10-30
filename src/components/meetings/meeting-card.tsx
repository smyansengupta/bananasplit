import Link from "next/link";

import { shortDayAt } from "@/components/calendar/day-label";
import { KIND_INK, kindStyle } from "@/components/calendar/kinds";
import { MapPin, Ticket, TriangleAlert, Video } from "@/components/icons";
import { hasMeetingLogo, MeetingLogo } from "@/components/meeting-logos";
import { CopyLinkButton } from "@/components/meetings/copy-link-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TickMeter } from "@/components/ui/meters";
import { UserAvatar, type UserAvatarUser } from "@/components/user-avatar";
import type {
  CalendarSyncState,
  ConferenceProvider,
  EventKind,
  MeetingFormat,
  RegistrationStatus,
  RSVPStatus,
} from "@/generated/prisma/enums";
import { CONFERENCE_LABELS, type ConferenceStatus } from "@/lib/meetings/conference-status";
import type { MeetingType } from "@/lib/meetings/meeting-types";
import { FORMAT_LABEL } from "@/lib/meetings/shape";
import { until } from "@/lib/relative-time";
import { rsvpCover } from "@/lib/rsvp/cover";
import { timeLine } from "@/lib/rsvp/when";
import { cn } from "@/lib/utils";

/**
 * What the Meetings list reads of an event. The host's start link
 * (`conferenceHostUrl`) is deliberately not here: the list never loads it,
 * so it cannot reach a card (docs/features/meetings.md).
 */
export interface MeetingRow {
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
  meetingType: string | null;
  hostUserId: string | null;
  featured: boolean;
  conferenceProvider: ConferenceProvider;
  conferenceManaged: boolean;
  conferenceUrl: string | null;
  conferenceSyncState: CalendarSyncState;
  conferenceSyncError: string | null;
}

/**
 * Who is on a meeting, from its invitees (EventAttendee): the faces of the
 * people going (or, before anyone has said yes, of the people asked), then
 * the numbers. The page works it out; a meeting nobody was invited to has
 * none, and the card leaves the row out rather than saying "0 going".
 */
export interface MeetingCrowd {
  faces: (UserAvatarUser & { id: string })[];
  going: number;
  maybe: number;
  awaited: number;
  invited: number;
}

/** The OrgIntegration behind an event's provider, for its logo. */
function conferenceIntegration(provider: ConferenceProvider): string | null {
  if (provider === "MEET") return "GOOGLE_MEET";
  if (provider === "ZOOM") return "ZOOM";
  if (provider === "TEAMS") return "MICROSOFT_TEAMS";
  return null;
}

/** A call's Join button fills in this long before it starts. */
const JOIN_EARLY_MS = 15 * 60_000;

/**
 * One meeting on the Meetings list (docs/features/meetings.md).
 *
 * The card reads top to bottom the same way every time: when (the date
 * tile, or the date on the picture), the title in full (it wraps, never cut
 * off), then one line of your part in it, its type and where it is, and a
 * footer of who is coming with the button to join. The footer is pinned to
 * the bottom (mt-auto), so cards in a row end level whatever their titles'
 * lengths.
 *
 * The meeting type's colour (--kind) shows on the date tile's month and on
 * the type's pill, which has its name in it. The next meeting's tile and
 * countdown fill solid in that colour, so the page has one place the eye
 * lands first. Past meetings keep the shape and lose the colour.
 *
 * The card is a plain container, and its title is the one link to the
 * meeting's page. That link is stretched over the whole card with an overlay,
 * so the card still clicks through; Join, Copy link and RSVP sit above the
 * overlay, as siblings of the title rather than inside it, because a link or
 * a button inside a link is invalid and unreliable for keyboards and screen
 * readers.
 *
 * Its server-rendered shell has one client child, the copy button.
 */
export function MeetingCard({
  event: e,
  canManage,
  status,
  href,
  timeZone,
  type,
  hosting = false,
  featured = false,
  first = false,
  past = false,
  now,
  going,
  waiting,
  mine,
  myRsvp,
  crowd,
}: {
  event: MeetingRow;
  /** Hosts see the head count; everyone else sees their own sign-up. */
  canManage: boolean;
  /** `conferenceStatus(e, canManage)`, worked out by the page. */
  status: ConferenceStatus;
  /** The meeting's page. */
  href: string;
  timeZone: string;
  /** Its meeting type (Event.meetingType) and that type's colour, if it has one. */
  type: MeetingType | null;
  /** You are its host (Event.hostUserId). */
  hosting?: boolean;
  /** Two columns wide: a Featured meeting, or the next one when none is. */
  featured?: boolean;
  /** The next meeting: its date and countdown are filled in its colour. */
  first?: boolean;
  /** Already over: nothing left to join, so no Join and no Copy link. */
  past?: boolean;
  /** The page's clock, for "in 2 hours". */
  now: Date;
  going: number;
  waiting: number;
  /** Your own sign-up, if you have one. */
  mine: RegistrationStatus | null;
  /** What you answered as an invitee, if you were invited. */
  myRsvp: RSVPStatus | null;
  /** Who is coming, or null when nobody was invited. */
  crowd: MeetingCrowd | null;
}) {
  const integration = conferenceIntegration(e.conferenceProvider);
  const hasCover = Boolean(rsvpCover(e.rsvpCover));
  const live = e.startsAt <= now && !past;
  const lit = first && !past;
  const joinable = Boolean(e.conferenceUrl) && !past;
  const joinNow = joinable && e.startsAt.getTime() - now.getTime() <= JOIN_EARLY_MS;
  const rsvp = !canManage && e.rsvpEnabled && e.rsvpSlug && !mine && !past;
  const counts = signups();
  const part = yourPart();

  /**
   * Your part in it. The list is the whole organization's, so a meeting you
   * host or were asked to says so, first on its line; one you weren't asked
   * to says nothing. An invite you haven't answered is the one to act on.
   */
  function yourPart() {
    if (hosting) return <Badge variant="info">You&apos;re hosting</Badge>;
    if (myRsvp === "PENDING")
      return past ? (
        <Badge variant="secondary">You were invited</Badge>
      ) : (
        <Badge variant="accent" title="You were invited and haven't answered yet">
          Invited, reply needed
        </Badge>
      );
    if (myRsvp === "YES") return <Badge variant="success">Invited, you&apos;re going</Badge>;
    if (myRsvp === "MAYBE") return <Badge variant="outline">Invited, you said maybe</Badge>;
    if (myRsvp === "NO") return <Badge variant="secondary">Invited, you declined</Badge>;
    return null;
  }

  /**
   * What kind of call this is, and where it is, as parts of the details
   * line. A pasted link (provider OTHER) says Online. A call still being made,
   * or one that failed, says so rather than showing nothing. With nothing
   * else to say, the format does.
   */
  function shapeLine() {
    const parts: React.ReactNode[] = [];
    if (e.conferenceUrl) {
      parts.push(
        <span key="call" className="inline-flex items-center gap-1.5">
          {integration && hasMeetingLogo(integration) ? (
            <MeetingLogo provider={integration} className="size-3.5" />
          ) : (
            <Video className="size-3.5" aria-hidden="true" />
          )}
          {e.conferenceProvider === "OTHER"
            ? FORMAT_LABEL.ONLINE
            : CONFERENCE_LABELS[e.conferenceProvider]}
        </span>,
      );
    }
    if (status.kind === "pending") {
      parts.push(
        <span key="status" className="inline-flex items-center gap-1.5">
          {integration && <MeetingLogo provider={integration} className="size-3.5 opacity-60" />}
          {status.line}
        </span>,
      );
    } else if (status.kind === "failed") {
      parts.push(
        <span
          key="status"
          className="text-tint-danger-foreground inline-flex items-center gap-1.5 font-medium"
        >
          <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
          {status.line}
        </span>,
      );
    }
    const place = e.location?.trim();
    if (place) {
      parts.push(
        <span key="place" className="inline-flex min-w-0 items-start gap-1.5">
          <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 break-words">{place}</span>
        </span>,
      );
    }
    if (parts.length === 0) parts.push(<span key="format">{FORMAT_LABEL[e.format]}</span>);
    return parts;
  }

  /** A host's sign-up count, with a meter when the cap is small enough to draw spot by spot. */
  function signups() {
    // No sign-up page means nobody to count here: the organization's own
    // invitees are on the card already (the crowd).
    if (!canManage || !e.rsvpSlug) return null;
    const full = e.rsvpCapacity ? going >= e.rsvpCapacity : false;
    return (
      <span className="flex min-w-0 flex-col gap-1.5">
        <span className="flex items-baseline justify-between gap-3 text-[13px] tabular-nums">
          <span className="text-muted-foreground">
            Signed up{waiting > 0 ? `, ${waiting} waitlisted` : ""}
          </span>
          <span className="font-semibold">
            {going}
            {e.rsvpCapacity ? (
              <span className="text-muted-foreground font-normal"> of {e.rsvpCapacity}</span>
            ) : null}
          </span>
        </span>
        {e.rsvpCapacity && e.rsvpCapacity <= 60 ? (
          <TickMeter
            total={e.rsvpCapacity}
            filled={going}
            height={6}
            color={full ? "var(--warning)" : "var(--success)"}
            label={`${going} of ${e.rsvpCapacity} spots taken`}
            className="w-full"
          />
        ) : null}
      </span>
    );
  }

  // Above the title's overlay, so these are what a click lands on. Each is
  // named for its meeting: a list of these would otherwise read "Join, Copy
  // link, Join, Copy link" to a screen reader.
  const actions = joinable ? (
    <span className="relative z-10 flex flex-wrap justify-end gap-2">
      <CopyLinkButton url={e.conferenceUrl!} title={e.title} />
      <Button size="sm" variant={joinNow ? "default" : "outline"} asChild>
        <a
          href={e.conferenceUrl!}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Join ${e.title}`}
        >
          {integration && hasMeetingLogo(integration) ? (
            <MeetingLogo provider={integration} className="size-3.5" />
          ) : (
            <Video aria-hidden="true" />
          )}
          Join
        </a>
      </Button>
    </span>
  ) : rsvp ? (
    <Button size="sm" variant="outline" asChild>
      <Link href={`/e/${e.rsvpSlug}`} className="relative z-10">
        RSVP
      </Link>
    </Button>
  ) : null;

  return (
    <li className={cn(featured && "lg:col-span-2")}>
      <div
        style={type ? { ["--kind" as string]: type.color } : kindStyle(e.kind)}
        className={cn(
          "group bg-card text-card-foreground edge rounded-card hover:shadow-e2 relative flex h-full overflow-hidden transition-shadow duration-200",
          // The title's own outline would sit on the title; the card carries it.
          "has-[[data-card-link]:focus-visible]:outline-foreground has-[[data-card-link]:focus-visible]:outline-2 has-[[data-card-link]:focus-visible]:outline-offset-2",
          featured ? "flex-col sm:flex-row" : "flex-col",
          past && "opacity-80 saturate-0 hover:opacity-100 hover:saturate-100",
        )}
      >
        {hasCover ? (
          <Cover
            title={e.title}
            cover={e.rsvpCover}
            startsAt={e.startsAt}
            timeZone={timeZone}
            className={
              featured ? "aspect-[16/9] sm:aspect-auto sm:min-h-60 sm:w-[46%]" : "aspect-[16/8]"
            }
          />
        ) : (
          featured && <DatePanel startsAt={e.startsAt} timeZone={timeZone} lit={lit} />
        )}

        <div className={cn("flex min-w-0 flex-1 flex-col gap-4", featured ? "p-6 sm:p-7" : "p-5")}>
          <div className="flex min-w-0 items-start gap-4">
            {!hasCover && !featured && (
              <DateTile startsAt={e.startsAt} timeZone={timeZone} lit={lit} />
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Link
                href={href}
                data-card-link=""
                className={cn(
                  "display-title block min-w-0 break-words underline-offset-4 group-hover:underline after:absolute after:inset-0 focus-visible:outline-none",
                  featured ? "text-[26px] leading-tight" : "text-[17px] leading-snug",
                )}
              >
                {e.title}
              </Link>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px]">
                <span className="text-muted-foreground">
                  {hasCover || featured
                    ? listWhen(e.startsAt, e.endsAt, timeZone, e.allDay)
                    : timeLine(e.startsAt, e.endsAt, timeZone, e.allDay)}
                </span>
                {live ? (
                  <Badge variant="success">Happening now</Badge>
                ) : !past ? (
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[12px] font-semibold whitespace-nowrap first-letter:uppercase",
                      lit ? "bg-(--kind)" : "bg-muted text-muted-foreground",
                    )}
                    style={lit ? { color: KIND_INK } : undefined}
                  >
                    {until(e.startsAt, now)}
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          <div className="text-muted-foreground flex flex-wrap items-center gap-x-3.5 gap-y-2 text-[13px]">
            {part}
            {type && <TypePill name={type.name} />}
            {shapeLine()}
            {mine && (
              <Badge variant={mine === "WAITLIST" ? "accent" : "success"}>
                {mine === "WAITLIST" ? "On the waitlist" : "You're signed up"}
              </Badge>
            )}
            {canManage && e.rsvpSlug && !e.rsvpEnabled && (
              <Badge variant="secondary" title="Its sign-up page is turned off">
                Sign-ups off
              </Badge>
            )}
          </div>

          {(crowd || counts || actions) && (
            <div className="border-border/70 mt-auto flex flex-col gap-3 border-t pt-4">
              {(crowd || actions) && (
                <div className="flex min-h-8 flex-wrap items-center justify-between gap-3">
                  {crowd ? <Crowd {...crowd} /> : <span />}
                  {actions}
                </div>
              )}
              {counts}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

/** "Today, 6:00 – 7:00 PM EDT", "Wed, Oct 14, ...": the day as the app says it. */
export function listWhen(start: Date, end: Date, timeZone: string, allDay: boolean): string {
  return `${shortDayAt(start, timeZone)}, ${timeLine(start, end, timeZone, allDay)}`;
}

const MONTH = (timeZone: string) => new Intl.DateTimeFormat("en-US", { month: "short", timeZone });
const DAY = (timeZone: string) => new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone });
const WEEKDAY = (timeZone: string) =>
  new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone });

/** A 15% wash of the meeting type's colour, behind its month and its pill. */
const KIND_WASH = "color-mix(in oklab, var(--kind) 15%, var(--card))";
/**
 * The type's colour as text on that wash. An organization picks its own
 * colours, a bright yellow among them, so it is pulled toward the text
 * colour to stay readable in both modes.
 */
const KIND_TEXT = "color-mix(in oklab, var(--kind) 62%, var(--foreground))";

/**
 * The date as a tile: the month in the type's colour, the day in the
 * display face, the weekday. `lit` is the next meeting: the tile filled
 * solid in its colour.
 */
function DateTile({ startsAt, timeZone, lit }: { startsAt: Date; timeZone: string; lit: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={lit ? { background: "var(--kind)", color: KIND_INK } : { background: KIND_WASH }}
      className="rounded-tile flex w-[3.75rem] shrink-0 flex-col items-center justify-center py-2.5 leading-none"
    >
      <span className="text-[12px] font-semibold" style={lit ? undefined : { color: KIND_TEXT }}>
        {MONTH(timeZone).format(startsAt)}
      </span>
      <span className="numeral my-1 text-[24px]">{DAY(timeZone).format(startsAt)}</span>
      <span className={cn("text-[12px] font-medium", lit ? "opacity-80" : "text-muted-foreground")}>
        {WEEKDAY(timeZone).format(startsAt)}
      </span>
    </span>
  );
}

/**
 * The wide card's left side when the meeting has no picture: the date at
 * poster size on a wash of its type's colour (solid for the next one).
 */
function DatePanel({
  startsAt,
  timeZone,
  lit,
}: {
  startsAt: Date;
  timeZone: string;
  lit: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      style={lit ? { background: "var(--kind)", color: KIND_INK } : { background: KIND_WASH }}
      className="flex shrink-0 flex-col items-center justify-center gap-1.5 px-8 py-8 leading-none sm:w-[34%] sm:py-12"
    >
      <span className="text-[15px] font-semibold" style={lit ? undefined : { color: KIND_TEXT }}>
        {MONTH(timeZone).format(startsAt)}
      </span>
      <span className="numeral text-6xl sm:text-7xl">{DAY(timeZone).format(startsAt)}</span>
      <span className={cn("text-[15px] font-medium", lit ? "opacity-80" : "text-muted-foreground")}>
        {WEEKDAY(timeZone).format(startsAt)}
      </span>
    </span>
  );
}

/** The meeting's type: its name on a wash of its colour, with a dot. */
function TypePill({ name }: { name: string }) {
  return (
    <span
      style={{ background: KIND_WASH }}
      className="text-foreground inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] leading-5 font-semibold"
    >
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-(--kind)" />
      {name}
    </span>
  );
}

/**
 * Who is coming: the faces of the people who said yes (or, before anyone
 * has, of the people asked), and then the count in words. A meeting is
 * people, and a list that doesn't say who is on them makes you open each one
 * to find out.
 */
function Crowd({ faces, going, maybe, awaited, invited }: MeetingCrowd) {
  const line = [
    going > 0 ? `${going} going` : `${invited} invited`,
    maybe > 0 && `${maybe} maybe`,
    going > 0 && awaited > 0 && `${awaited} yet to answer`,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="flex shrink-0">
        {faces.map((u) => (
          <UserAvatar key={u.id} user={u} size="xs" className="ring-card -me-1.5 ring-2" />
        ))}
      </span>
      <span className="text-muted-foreground min-w-0 ps-2 text-[13px] leading-snug">{line}</span>
    </span>
  );
}

/**
 * The event's picture (its RSVP cover), with a calendar-leaf date on it.
 * Without a cover: a wash of its type's colour (--kind, set by the card;
 * the primary on a ticket), with its first letter and a faint ticket.
 */
export function Cover({
  title,
  cover: stored,
  startsAt,
  timeZone,
  className,
}: {
  title: string;
  cover: unknown;
  startsAt: Date;
  timeZone: string;
  className?: string;
}) {
  const cover = rsvpCover(stored);
  return (
    <span
      className={cn("relative block overflow-hidden", className)}
      style={{ background: "color-mix(in oklab, var(--kind, var(--primary)) 15%, var(--card))" }}
    >
      {cover ? (
        // eslint-disable-next-line @next/next/no-img-element -- a stored WebP variant
        <img
          src={cover.s960}
          alt=""
          loading="lazy"
          className="absolute inset-0 size-full object-cover transition-transform duration-300 group-hover:scale-[1.02] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
        />
      ) : (
        <span aria-hidden="true" className="absolute inset-0 grid place-items-center">
          <Ticket className="absolute size-24 -rotate-12 opacity-[0.08]" strokeWidth={1.25} />
          <span className="font-heading text-foreground/80 relative text-4xl">
            {title.trim()[0]?.toUpperCase() ?? "B"}
          </span>
        </span>
      )}
      <span className="bg-card text-card-foreground rounded-tile shadow-e1 absolute top-3 left-3 flex w-12 flex-col items-center py-1.5 leading-none">
        <span className="text-muted-foreground text-[11px] font-semibold">
          {MONTH(timeZone).format(startsAt)}
        </span>
        <span className="numeral mt-0.5 text-lg">{DAY(timeZone).format(startsAt)}</span>
      </span>
    </span>
  );
}
