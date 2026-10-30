import Link from "next/link";

import { MapPin, NotebookText, Users, Video } from "@/components/icons";
import { hasMeetingLogo, MeetingLogo } from "@/components/meeting-logos";
import { TypePill, type MeetingRow } from "@/components/meetings/meeting-card";
import { kindStyle } from "@/components/calendar/kinds";
import { CONFERENCE_LABELS } from "@/lib/meetings/conference-status";
import type { MeetingType } from "@/lib/meetings/meeting-types";
import { FORMAT_LABEL } from "@/lib/meetings/shape";
import { timeLine } from "@/lib/rsvp/when";

/**
 * Past meetings, as a list (docs/features/meetings.md). Coming-up meetings
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
  /** The meeting's notes, newest first. */
  notes: { id: string }[];
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
  const months = groupByMonth(meetings, timeZone);
  return (
    <div className="space-y-5">
      {months.map((m) => (
        <section key={m.key} aria-label={m.label} className="space-y-2">
          <h3 className="flex items-baseline gap-2 px-1 text-[15px] font-semibold">
            {m.label}
            <span className="text-muted-foreground font-normal tabular-nums">{m.items.length}</span>
          </h3>
          <ul className="bg-card edge rounded-card p-2 max-sm:p-1.5">
            {m.items.map((e) => (
              <PastRow
                key={e.id}
                event={e}
                timeZone={timeZone}
                href={`/app/${orgSlug}/meetings/${e.id}`}
                notesHref={(id) => `/app/${orgSlug}/notes/${id}`}
                type={typeOf(e)}
                facts={facts(e)}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

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
  const came =
    facts.checkedIn > 0
      ? `${facts.checkedIn} came`
      : facts.signedUp > 0
        ? `${facts.signedUp} signed up`
        : null;
  const notes = facts.notes;
  const integration =
    e.conferenceProvider === "MEET"
      ? "GOOGLE_MEET"
      : e.conferenceProvider === "ZOOM"
        ? "ZOOM"
        : e.conferenceProvider === "TEAMS"
          ? "MICROSOFT_TEAMS"
          : null;
  const place = e.location?.trim();
  return (
    <li
      style={type ? { ["--kind" as string]: type.color } : kindStyle(e.kind)}
      className="group hover:bg-muted/60 focus-within:bg-muted/60 rounded-field [li+&]:before:bg-border relative flex items-start gap-3.5 px-3 py-3 transition-colors duration-150 [li+&]:before:absolute [li+&]:before:inset-x-3 [li+&]:before:top-0 [li+&]:before:h-px"
    >
      <DayStamp startsAt={e.startsAt} timeZone={timeZone} />
      <div className="min-w-0 flex-1">
        <Link
          href={href}
          className="block min-w-0 text-[15px] leading-snug font-medium break-words underline-offset-4 after:absolute after:inset-0 hover:underline focus-visible:outline-none"
        >
          {e.title}
        </Link>
        <span className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
          <span>{timeLine(e.startsAt, e.endsAt, timeZone, e.allDay)}</span>
          {type && <TypePill name={type.name} />}
          {e.conferenceUrl ? (
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
          ) : null}
          {place && (
            <span className="inline-flex min-w-0 items-start gap-1.5">
              <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 break-words">{place}</span>
            </span>
          )}
          {came && (
            <span className="inline-flex items-center gap-1.5 tabular-nums">
              <Users className="size-3.5" aria-hidden="true" />
              {came}
            </span>
          )}
        </span>
      </div>
      {notes.length > 0 && (
        <Link
          href={notes.length === 1 ? notesHref(notes[0]!.id) : `${href}#notes`}
          className="text-muted-foreground hover:text-foreground hover:bg-muted relative z-10 inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] font-semibold transition-colors"
          aria-label={
            notes.length === 1 ? `Notes: ${e.title}` : `${notes.length} notes: ${e.title}`
          }
        >
          <NotebookText className="size-3.5" aria-hidden="true" />
          {notes.length === 1 ? "Notes" : `${notes.length} notes`}
        </Link>
      )}
    </li>
  );
}

const DAY = (timeZone: string) => new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone });
const WEEKDAY = (timeZone: string) =>
  new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone });

/** The day and weekday, a small stamp in the meeting type's colour wash. */
function DayStamp({ startsAt, timeZone }: { startsAt: Date; timeZone: string }) {
  return (
    <span
      aria-hidden="true"
      style={{ background: "color-mix(in oklab, var(--kind) 13%, var(--card))" }}
      className="rounded-tile flex w-11 shrink-0 flex-col items-center py-1.5 leading-none"
    >
      <span className="numeral text-[17px]">{DAY(timeZone).format(startsAt)}</span>
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
