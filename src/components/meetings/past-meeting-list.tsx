import Link from "next/link";

import { MapPin, NotebookText, Users, Video } from "@/components/icons";
import { hasMeetingLogo, MeetingLogo } from "@/components/meeting-logos";
import { TypePill, type MeetingRow } from "@/components/meetings/meeting-card";
import { kindStyle } from "@/components/calendar/kinds";
import { CONFERENCE_LABELS } from "@/lib/meetings/conference-status";
import type { MeetingType } from "@/lib/meetings/meeting-types";
import { FORMAT_LABEL } from "@/lib/meetings/shape";
import { cn } from "@/lib/utils";

import { PastMeetingBrowser, type PastMonth } from "./past-meeting-browser";

/**
 * Past meetings, as a list (docs/features/meetings.md), in the columns of
 * the workspace plan: Date, Meeting, Type, Where, Came and After. Coming-up meetings
 * are cards because there is something to do with them (join, reply, sign
 * up); once one has happened, what's left is a record, so it drops into a
 * plain list grouped by month, newest first, in the same panel and row
 * shape as the Tasks List view.
 *
 * Each row: the date, the full title (it wraps, never cut off), its type,
 * where it was, how many came (check-ins, falling back to sign-ups), and
 * its notes: straight to the note when there is one, to the meeting's
 * notes when there are several. The row opens the meeting's page.
 */

export interface PastMeetingFacts {
  /** Check-ins (Event.attendanceCount), the real count of who came. */
  checkedIn: number;
  /** Sign-ups (GOING) or invitees who said yes, when nobody checked in. */
  signedUp: number;
  /** Everyone invited (EventAttendee), the last fallback for "of N". */
  invited?: number;
  /** The meeting's notes, newest first. */
  notes: { id: string; title?: string | null }[];
  /** Who hosted it, by name. */
  host?: string | null;
}

export function PastMeetingList({
  meetings,
  timeZone,
  orgSlug,
  typeOf,
  facts,
}: {
  meetings: MeetingRow[];
  timeZone: string;
  orgSlug: string;
  typeOf: (e: MeetingRow) => MeetingType | null;
  facts: (e: MeetingRow) => PastMeetingFacts;
}) {
  const months: PastMonth[] = groupByMonth(meetings, timeZone).map((m) => ({
    key: m.key,
    label: m.label,
    rows: m.items.map((e) => {
      const f = facts(e);
      const type = typeOf(e);
      return {
        id: e.id,
        // What the search box matches: title, type, place and host.
        text: [e.title, type?.name ?? e.meetingType, e.location, f.host]
          .filter(Boolean)
          .join(" ")
          .toLowerCase(),
        type: type?.name ?? null,
        node: (
          <PastRow
            key={e.id}
            event={e}
            timeZone={timeZone}
            href={`/app/${orgSlug}/meetings/${e.id}`}
            notesHref={(id) => `/app/${orgSlug}/notes/${id}`}
            type={type}
            facts={f}
          />
        ),
      };
    }),
  }));
  return (
    <PastMeetingBrowser
      months={months}
      total={meetings.length}
      types={[...new Set(months.flatMap((m) => m.rows.map((r) => r.type)))].filter(
        (t): t is string => Boolean(t),
      )}
      header={<ColumnHeads />}
    />
  );
}

/** The columns' names, above the rows on a wide screen. */
function ColumnHeads() {
  return (
    <div
      aria-hidden="true"
      className={cn(
        COLUMNS,
        "text-muted-foreground px-3 pt-1 pb-2 text-[12px] font-semibold max-md:hidden",
      )}
    >
      <span>Date</span>
      <span>Meeting</span>
      <span>Type</span>
      <span>Where</span>
      <span>Came</span>
      <span className="text-end">After</span>
    </div>
  );
}

/** Date, Meeting, Type, Where, Came, After: one grid, rows and heads alike. */
const COLUMNS =
  "md:grid md:grid-cols-[3.5rem_minmax(0,1fr)_8.5rem_10rem_6.5rem_12rem] md:items-center md:gap-4";

function PastRow({
  event: e,
  timeZone,
  href,
  notesHref,
  type,
  facts,
}: {
  event: MeetingRow;
  timeZone: string;
  href: string;
  notesHref: (noteId: string) => string;
  type: MeetingType | null;
  facts: PastMeetingFacts;
}) {
  // Who came: check-ins out of the sign-ups, else the invitees who said
  // yes, else everyone invited ("34 of 40", with a small bar). Nobody
  // checked in: how many signed up.
  const of = facts.signedUp || facts.invited || 0;
  const came =
    facts.checkedIn > 0
      ? of > 0
        ? { n: facts.checkedIn, of }
        : { n: facts.checkedIn, of: null }
      : null;
  const share = came?.of ? Math.min(1, came.n / came.of) : null;
  const cameText = came
    ? came.of
      ? `${came.n} of ${came.of} came`
      : `${came.n} came`
    : facts.signedUp > 0
      ? `${facts.signedUp} signed up`
      : null;
  const typeName = type?.name ?? e.meetingType?.trim() ?? null;
  const notes = facts.notes;
  // After: the meeting's notes. A note called a recap is the Recap; the
  // newest other note is the Notes.
  const recap = notes.find((n) => /recap/i.test(n.title ?? ""));
  const note = notes.find((n) => n !== recap);
  const integration =
    e.conferenceProvider === "MEET"
      ? "GOOGLE_MEET"
      : e.conferenceProvider === "ZOOM"
        ? "ZOOM"
        : e.conferenceProvider === "TEAMS"
          ? "MICROSOFT_TEAMS"
          : null;
  const place = e.location?.trim();
  const where = e.conferenceUrl ? (
    <span className="inline-flex items-center gap-1.5">
      {integration && hasMeetingLogo(integration) ? (
        <MeetingLogo provider={integration} className="size-3.5" />
      ) : (
        <Video className="size-3.5" aria-hidden="true" />
      )}
      {e.conferenceProvider === "OTHER" || e.conferenceProvider === "NONE"
        ? FORMAT_LABEL.ONLINE
        : CONFERENCE_LABELS[e.conferenceProvider]}
    </span>
  ) : place ? (
    <span className="inline-flex min-w-0 items-start gap-1.5">
      <MapPin className="mt-0.5 size-3.5 shrink-0 md:hidden" aria-hidden="true" />
      <span className="min-w-0 break-words">{place}</span>
    </span>
  ) : null;
  const afterClass =
    "text-muted-foreground hover:text-foreground hover:bg-muted relative z-10 inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] font-semibold transition-colors";
  const afterLink = (href: string, label: string, aria: string) => (
    <Link href={href} className={afterClass} aria-label={aria}>
      <NotebookText className="size-3.5" aria-hidden="true" />
      {label}
    </Link>
  );
  return (
    <li
      style={type ? { ["--kind" as string]: type.color } : kindStyle(e.kind)}
      className={cn(
        COLUMNS,
        "group hover:bg-muted/60 focus-within:bg-muted/60 rounded-field [li+&]:before:bg-border relative flex items-start gap-3.5 px-3 py-3 transition-colors duration-150 [li+&]:before:absolute [li+&]:before:inset-x-3 [li+&]:before:top-0 [li+&]:before:h-px",
      )}
    >
      <DayStamp startsAt={e.startsAt} timeZone={timeZone} />
      <div className="min-w-0 flex-1">
        <Link
          href={href}
          className="block min-w-0 text-[15px] leading-snug font-medium break-words underline-offset-4 after:absolute after:inset-0 hover:underline focus-visible:outline-none"
        >
          {e.title}
        </Link>
        {/* The plan's row: who hosted it, and no time line without a host. */}
        {facts.host && (
          <span className="text-muted-foreground block text-[13px]">Hosted by {facts.host}</span>
        )}
        {/* On a phone the other columns fold under the title. */}
        <span className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] md:hidden">
          {typeName && <TypePill name={typeName} />}
          {where}
          {cameText && (
            <span className="inline-flex items-center gap-1.5 tabular-nums">
              <Users className="size-3.5" aria-hidden="true" />
              {cameText}
            </span>
          )}
        </span>
      </div>
      <span className="max-md:hidden">{typeName && <TypePill name={typeName} />}</span>
      <span className="text-muted-foreground min-w-0 text-[13px] max-md:hidden">{where}</span>
      <span className="text-muted-foreground text-[13px] tabular-nums max-md:hidden">
        {cameText && (
          <span className="flex flex-col gap-1">
            {came?.of ? (
              <span>
                <span className="text-foreground font-semibold">{came.n}</span> of {came.of}
                <span className="sr-only"> came</span>
              </span>
            ) : (
              cameText
            )}
            {share !== null && (
              <span
                aria-hidden="true"
                className="bg-muted block h-1.5 w-20 overflow-hidden rounded-full"
              >
                <span
                  className="block h-full rounded-full bg-(--kind)"
                  style={{ width: `${Math.round(share * 100)}%` }}
                />
              </span>
            )}
          </span>
        )}
      </span>
      <span className="flex shrink-0 flex-wrap justify-end gap-1">
        {note &&
          afterLink(
            notes.length > (recap ? 2 : 1) ? `${href}#notes` : notesHref(note.id),
            "Notes",
            `Notes: ${e.title}`,
          )}
        {recap && afterLink(notesHref(recap.id), "Recap", `Recap: ${e.title}`)}
        {e.recordingUrl && (
          <a
            href={e.recordingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={afterClass}
            aria-label={`Recording: ${e.title}`}
          >
            <Video className="size-3.5" aria-hidden="true" />
            Recording
          </a>
        )}
      </span>
    </li>
  );
}

const DAY = (timeZone: string) =>
  new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone });
const WEEKDAY = (timeZone: string) =>
  new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone });

/** The day and weekday, a small stamp in the meeting type's colour wash. */
function DayStamp({ startsAt, timeZone }: { startsAt: Date; timeZone: string }) {
  return (
    <span
      aria-hidden="true"
      style={{ background: "color-mix(in oklab, var(--kind) 13%, var(--card))" }}
      className="rounded-tile flex w-14 shrink-0 flex-col items-center py-1.5 leading-none"
    >
      <span className="text-[13px] font-semibold whitespace-nowrap tabular-nums">
        {DAY(timeZone).format(startsAt)}
      </span>
      <span className="text-muted-foreground mt-0.5 text-[11px] font-medium">
        {WEEKDAY(timeZone).format(startsAt)}
      </span>
    </span>
  );
}

/** Meetings grouped by calendar month in the org's zone, in the order given. */
export function groupByMonth(meetings: MeetingRow[], timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone });
  const groups: { key: string; label: string; items: MeetingRow[] }[] = [];
  for (const e of meetings) {
    const label = fmt.format(e.startsAt);
    const last = groups[groups.length - 1];
    if (last && last.key === label) last.items.push(e);
    else groups.push({ key: label, label, items: [e] });
  }
  return groups;
}
