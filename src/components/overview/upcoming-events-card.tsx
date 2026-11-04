import {
  CircleCheck,
  CircleQuestionMark,
  CircleX,
  Mail,
  Users,
  type IconComponent,
} from "@/components/icons";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import { KIND_META, RSVP_META } from "@/components/calendar/kinds";
import { Button } from "@/components/ui/button";
import type { EventKind, RSVPStatus } from "@/generated/prisma/enums";
import type { CalendarEventSummary } from "@/app/app/[orgSlug]/calendar/queries";
import { formatEventWhen } from "@/lib/calendar/format";

import { FaceStack } from "./bits";
import { LinkChips, type ItemRef } from "./connections";
import type { PersonFace } from "@/lib/overview/types";

/**
 * Home's Meetings and Events (the plan's mockups): the next few of each,
 * with the viewer's own RSVP where they were invited, and what each one is
 * tied to as chips. A meeting says whether its agenda is written and how
 * many action items from the last one are still open; an event shows its
 * sign-ups against the room. Each list ends with one finding, when the
 * data has one (the page works it out).
 */

const RSVP_ICON: Record<RSVPStatus, IconComponent> = {
  PENDING: Mail,
  YES: CircleCheck,
  NO: CircleX,
  MAYBE: CircleQuestionMark,
};

/** What the page knows about one meeting or event, beyond the calendar's summary. */
export interface EventExtras {
  chips: readonly ItemRef[];
  /** Members going, with a few faces. */
  going: number;
  faces: readonly PersonFace[];
  /** A meeting: its agenda's items, or null when nobody has written one. Absent when unknown. */
  agendaItems?: number | null;
  /** An event: seats taken on its RSVP page, against its capacity. */
  seats?: { taken: number; capacity: number | null };
  /** An event: about how many should come, from past check-in rates. */
  expected?: number;
}

function RsvpMark({ rsvp }: { rsvp: RSVPStatus | undefined }) {
  if (!rsvp) return null;
  const Icon = RSVP_ICON[rsvp];
  return (
    <span className="text-muted-foreground inline-flex shrink-0 items-center gap-1 text-xs">
      <Icon className="size-3.5" aria-hidden="true" />
      {RSVP_META[rsvp].short}
    </span>
  );
}

function kindVars(kind: EventKind): CSSProperties {
  return { ["--kind" as string]: `var(${KIND_META[kind].token})` };
}

export function MeetingsList({
  orgSlug,
  meetings,
  extras,
  rsvps,
  zones,
  now,
  canEdit,
  empty,
  insight,
}: {
  orgSlug: string;
  meetings: readonly CalendarEventSummary[];
  extras: ReadonlyMap<string, EventExtras>;
  rsvps: ReadonlyMap<string, RSVPStatus>;
  zones: { viewer: string; org: string };
  now: Date;
  /** Whoever may edit meetings gets "Write agenda" where there's none. */
  canEdit: boolean;
  empty: ReactNode;
  insight?: ReactNode;
}) {
  if (meetings.length === 0) return <>{empty}</>;
  return (
    <div className="space-y-4">
      <ul className="divide-border/70 divide-y">
        {meetings.map((m) => {
          const extra = extras.get(m.id);
          const href = `/app/${orgSlug}/meetings/${m.id}`;
          const noAgenda = extra?.agendaItems === null;
          return (
            <li key={m.id} className="relative flex items-start gap-3.5 py-3.5 first:pt-0">
              <span
                aria-hidden="true"
                style={kindVars(m.kind)}
                className="grid size-9 shrink-0 place-items-center rounded-[11px] bg-[color-mix(in_oklab,var(--kind)_14%,var(--card))] text-(--kind)"
              >
                <Users className="size-4" />
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <Link
                    href={href}
                    className="text-[15px] font-semibold break-words hover:underline"
                  >
                    {m.title}
                  </Link>
                  <span className="flex shrink-0 items-center gap-2">
                    <RsvpMark rsvp={rsvps.get(m.id)} />
                    {extra && extra.faces.length > 0 && (
                      <FaceStack people={extra.faces} total={extra.going} />
                    )}
                  </span>
                </div>
                <p className="text-muted-foreground text-[13px]">
                  {formatEventWhen(m, zones, now)}
                  {m.location ? `, ${m.location}` : ""}
                </p>
                {extra?.agendaItems != null && extra.agendaItems > 0 && (
                  <p className="text-[13px] font-semibold">
                    Agenda written, {extra.agendaItems} {extra.agendaItems === 1 ? "item" : "items"}
                  </p>
                )}
                {noAgenda && (
                  <p className="text-tint-danger-foreground flex flex-wrap items-center gap-2 text-[13px] font-medium">
                    No agenda yet.
                    {canEdit && (
                      <Button asChild size="xs" variant="outline">
                        <Link href={href}>Write agenda</Link>
                      </Button>
                    )}
                  </p>
                )}
                {extra && <LinkChips items={extra.chips} className="pt-1" />}
              </div>
            </li>
          );
        })}
      </ul>
      {insight}
    </div>
  );
}

const DAY_WEEKDAY = (timeZone: string) =>
  new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone });
const DAY_NUMBER = (timeZone: string) =>
  new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone });

export function EventsList({
  orgSlug,
  events,
  extras,
  rsvps,
  zones,
  now,
  empty,
  insight,
}: {
  orgSlug: string;
  events: readonly CalendarEventSummary[];
  extras: ReadonlyMap<string, EventExtras>;
  rsvps: ReadonlyMap<string, RSVPStatus>;
  zones: { viewer: string; org: string };
  now: Date;
  empty: ReactNode;
  insight?: ReactNode;
}) {
  if (events.length === 0) return <>{empty}</>;
  return (
    <div className="space-y-4">
      <ul className="divide-border/70 divide-y">
        {events.map((e) => {
          const extra = extras.get(e.id);
          const zone = e.allDay ? zones.org : zones.viewer;
          const seats = extra?.seats;
          const pct =
            seats?.capacity && seats.capacity > 0
              ? Math.min(100, (seats.taken / seats.capacity) * 100)
              : null;
          return (
            <li key={e.id} className="flex items-start gap-3.5 py-3.5 first:pt-0">
              <span className="bg-muted/70 rounded-tile flex w-12 shrink-0 flex-col items-center py-2 leading-none">
                <span className="text-muted-foreground text-[11px] font-semibold">
                  {DAY_WEEKDAY(zone).format(e.startsAt)}
                </span>
                <span className="numeral mt-1 text-[20px]">
                  {DAY_NUMBER(zone).format(e.startsAt)}
                </span>
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <Link
                    href={`/app/${orgSlug}/calendar/${e.id}`}
                    className="text-[15px] font-semibold break-words hover:underline"
                  >
                    {e.title}
                  </Link>
                  <RsvpMark rsvp={rsvps.get(e.id)} />
                </div>
                <p className="text-muted-foreground flex flex-wrap gap-x-2 text-[13px]">
                  <span>{formatEventWhen(e, zones, now)}</span>
                  {e.location && <span>{e.location}</span>}
                  <span>{KIND_META[e.kind].label}</span>
                </p>
                {seats && pct !== null ? (
                  <div className="flex items-center gap-2.5 pt-1">
                    <span
                      role="img"
                      aria-label={`${seats.taken} of ${seats.capacity} seats taken`}
                      className="bg-muted-strong block h-1.5 flex-1 overflow-hidden rounded-full"
                    >
                      <span
                        className="block h-full rounded-full bg-(--chart-1)"
                        style={{ width: `${Math.max(pct, seats.taken > 0 ? 3 : 0)}%` }}
                      />
                    </span>
                    <span className="shrink-0 text-[13px] font-semibold tabular-nums">
                      {seats.taken} of {seats.capacity}
                    </span>
                  </div>
                ) : seats ? (
                  <p className="text-[13px] font-semibold">{seats.taken} signed up</p>
                ) : extra && extra.going > 0 ? (
                  <p className="text-[13px] font-semibold">{extra.going} going</p>
                ) : null}
                {extra && (
                  <span className="flex flex-wrap items-center gap-1.5 pt-1">
                    {extra.expected !== undefined && (
                      <span className="bg-tint-info text-tint-info-foreground inline-flex h-6 items-center rounded-full px-2 text-xs font-semibold">
                        About {extra.expected} expected
                      </span>
                    )}
                    <LinkChips items={extra.chips} />
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {insight}
    </div>
  );
}
