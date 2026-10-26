import Link from "next/link";

import { shortDayAt } from "@/components/calendar/day-label";
import { KIND_META } from "@/components/calendar/kinds";
import { ArrowUpRight, MapPin, Ticket, TriangleAlert, Video } from "@/components/icons";
import { hasMeetingLogo, MeetingLogo } from "@/components/meeting-logos";
import { CopyLinkButton } from "@/components/meetings/copy-link-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TickMeter } from "@/components/ui/meters";
import type {
  CalendarSyncState,
  ConferenceProvider,
  EventKind,
  MeetingFormat,
  RegistrationStatus,
} from "@/generated/prisma/enums";
import { CONFERENCE_LABELS, type ConferenceStatus } from "@/lib/meetings/conference-status";
import { FORMAT_LABEL } from "@/lib/meetings/shape";
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
  conferenceProvider: ConferenceProvider;
  conferenceManaged: boolean;
  conferenceUrl: string | null;
  conferenceSyncState: CalendarSyncState;
  conferenceSyncError: string | null;
}

/** The OrgIntegration behind an event's provider, for its logo. */
function conferenceIntegration(provider: ConferenceProvider): string | null {
  if (provider === "MEET") return "GOOGLE_MEET";
  if (provider === "ZOOM") return "ZOOM";
  if (provider === "TEAMS") return "MICROSOFT_TEAMS";
  return null;
}

/**
 * One meeting on the Meetings list (docs/features/meetings.md).
 *
 * The card is a plain container, and its title is the one link to the
 * meeting's page. That link is stretched over the whole card with an overlay,
 * so the card still clicks through; Join and Copy link sit above the overlay,
 * as siblings of the title rather than inside it, because a link or a button
 * inside a link is invalid and unreliable for keyboards and screen readers.
 *
 * Its server-rendered shell has one client child, the copy button.
 */
export function MeetingCard({
  event: e,
  canManage,
  status,
  href,
  timeZone,
  featured = false,
  going,
  waiting,
  mine,
}: {
  event: MeetingRow;
  /** Hosts see the head count; everyone else sees their own sign-up. */
  canManage: boolean;
  /** `conferenceStatus(e, canManage)`, worked out by the page. */
  status: ConferenceStatus;
  /** The meeting's page. */
  href: string;
  timeZone: string;
  /** The first upcoming meeting is the wide "Next up". */
  featured?: boolean;
  going: number;
  waiting: number;
  /** Your own sign-up, if you have one. */
  mine: RegistrationStatus | null;
}) {
  const integration = conferenceIntegration(e.conferenceProvider);
  const place = e.location?.trim();
  const shape = shapeLine();

  /**
   * What kind of call this is, and where it is, in one line. A pasted link
   * (provider OTHER) is not named: the format badge already says Online. A call
   * still being made, or one that failed, says so rather than showing nothing.
   */
  function shapeLine() {
    const parts: React.ReactNode[] = [];
    if (e.conferenceUrl && e.conferenceProvider !== "OTHER") {
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
  }

  /** On the right: the head count for hosts, your own sign-up for everyone else. */
  function signups() {
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
      <Badge variant={mine === "WAITLIST" ? "accent" : "success"}>
        {mine === "WAITLIST" ? "On the waitlist" : "You're going"}
      </Badge>
    ) : (
      <Badge variant="outline">RSVP</Badge>
    );
  }

  return (
    <li className={cn(featured && "sm:col-span-2")}>
      <div
        className={cn(
          "group bg-card text-card-foreground edge rounded-card hover:shadow-e2 relative flex h-full overflow-hidden transition-[transform,box-shadow] duration-200 ease-(--ease-ink) hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0",
          // The title's own outline would sit on the title; the card carries it.
          "has-[[data-card-link]:focus-visible]:outline-foreground has-[[data-card-link]:focus-visible]:outline-2 has-[[data-card-link]:focus-visible]:outline-offset-2",
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
        <div className={cn("flex min-w-0 flex-1 flex-col gap-3", featured ? "p-6" : "p-4.5")}>
          <div className="space-y-1">
            {featured && <span className="eyebrow block">Next up</span>}
            <Link
              href={href}
              data-card-link=""
              className={cn(
                "block min-w-0 font-semibold break-words underline-offset-4 group-hover:underline after:absolute after:inset-0 focus-visible:outline-none",
                featured ? "display-title text-2xl" : "line-clamp-2 text-[15px]",
              )}
            >
              {e.title}
            </Link>
            <span className="text-muted-foreground block text-[13px]">
              {listWhen(e.startsAt, e.endsAt, timeZone, e.allDay)}
            </span>
            <span className="flex flex-wrap items-center gap-1.5 pt-0.5">
              <Badge variant="outline">{FORMAT_LABEL[e.format]}</Badge>
              {e.rsvpEnabled ? (
                <Badge variant="accent">Sign-ups</Badge>
              ) : e.rsvpSlug ? (
                <Badge variant="secondary" title="Its sign-up page is turned off">
                  Sign-ups off
                </Badge>
              ) : null}
            </span>
            {shape}
          </div>
          <div className="mt-auto flex flex-col gap-3">
            <div className="flex items-end justify-between gap-3">
              {signups()}
              <ArrowUpRight
                className="text-muted-foreground group-hover:text-foreground size-4 flex-none transition-colors"
                aria-hidden="true"
              />
            </div>
            {e.conferenceUrl && (
              // Above the title's overlay, so these are what a click lands on.
              <div className="relative z-10 flex flex-wrap gap-2">
                <Button size="sm" asChild>
                  <a href={e.conferenceUrl} target="_blank" rel="noopener noreferrer">
                    <Video aria-hidden />
                    Join
                  </a>
                </Button>
                <CopyLinkButton url={e.conferenceUrl} />
              </div>
            )}
          </div>
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

/**
 * The event's picture (its RSVP cover), with a calendar-leaf date on it.
 * Without a cover: the event's first letter on a tint of its kind's colour
 * (the calendar's), with a faint ticket behind it.
 */
export function Cover({
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
