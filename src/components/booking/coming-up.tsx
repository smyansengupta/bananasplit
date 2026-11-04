"use client";

import Link from "next/link";

import { takeBookingAction } from "@/app/app/[orgSlug]/meetings/booking/actions";
import { AmbientButton, type AmbientAction } from "@/components/ambient/ambient-button";
import { kindStyle } from "@/components/calendar/kinds";
import { EmptyState } from "@/components/empty-state";
import { CalendarClock, Ellipsis, MapPin, Video } from "@/components/icons";
import { DateTile, TypePill } from "@/components/meetings/date-tile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserAvatar } from "@/components/user-avatar";
import type { BookingRow } from "@/server/booking/view";

import { CARD_GRID } from "./people-grid";

/**
 * Coming up: what's been booked, drawn like Meetings' cards. The date tile,
 * the guest (the one link, stretched over the card, to the meeting's page),
 * when, which link, the host's face. The next one's tile is filled. The page
 * has worked out the words and the ambient buttons, so the first paint and
 * the browser agree. One action at most on a card, Take it before Join; the
 * rest is in its menu. Each one is on Meetings and the Calendar too: it's a
 * real meeting.
 */
export function ComingUp({
  orgId,
  orgSlug,
  items,
  timeZone,
  onCancel,
}: {
  orgId: string;
  orgSlug: string;
  items: readonly BookingRow[];
  timeZone: string;
  onCancel: (b: BookingRow) => void;
}) {
  return (
    <section aria-labelledby="booked" className="@container space-y-3">
      <h2 id="booked" className="heading flex items-center gap-2 text-[17px]">
        Coming up {items.length > 0 && <Badge variant="secondary">{items.length}</Badge>}
      </h2>
      {items.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="Nothing booked yet"
          description="Share a link. What people book goes straight onto the calendar and into Meetings."
        />
      ) : (
        <ul className={CARD_GRID}>
          {items.map((b, i) => (
            <BookingCard
              key={b.id}
              orgId={orgId}
              booking={b}
              href={`/app/${orgSlug}/meetings/${b.eventId}`}
              timeZone={timeZone}
              first={i === 0}
              onCancel={onCancel}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function BookingCard({
  orgId,
  booking: b,
  href,
  timeZone,
  first,
  onCancel,
}: {
  orgId: string;
  booking: BookingRow;
  href: string;
  timeZone: string;
  first: boolean;
  onCancel: (b: BookingRow) => void;
}) {
  const guest = b.guestName.split(" ")[0];
  const [action] = b.ambient.flatMap(({ kind, reason }): AmbientAction[] => {
    if (kind === "join") {
      return b.joinUrl
        ? [
            {
              key: kind,
              label: "Join",
              icon: Video,
              tone: "solid",
              reason,
              href: b.joinUrl,
              external: true,
              ariaLabel: `Join with ${b.guestName}`,
            },
          ]
        : [];
    }
    return [
      {
        key: kind,
        label: "Take it",
        tone: "solid",
        reason,
        ariaLabel: `Take the meeting with ${b.guestName}`,
        run: () => takeBookingAction(orgId, b.id),
        done: `It's yours. ${guest} has been told.`,
      },
    ];
  });
  return (
    <li>
      <div
        style={kindStyle("OTHER")}
        className="group bg-card text-card-foreground edge rounded-card hover:shadow-e2 has-[[data-card-link]:focus-visible]:outline-foreground relative flex h-full flex-col gap-4 overflow-hidden p-5 transition-shadow duration-200 has-[[data-card-link]:focus-visible]:outline-2 has-[[data-card-link]:focus-visible]:outline-offset-2"
      >
        <div className="flex min-w-0 items-start gap-4">
          <DateTile startsAt={b.startsAt} timeZone={timeZone} lit={first} />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Link
              href={href}
              data-card-link=""
              className="display-title block min-w-0 text-[17px] leading-snug break-words underline-offset-4 group-hover:underline after:absolute after:inset-0 focus-visible:outline-none"
            >
              {b.guestName}
            </Link>
            <span className="text-muted-foreground text-[13px]">{b.when}</span>
            <span className="bg-muted text-muted-foreground w-fit rounded-full px-2 py-0.5 text-[12px] font-semibold whitespace-nowrap first-letter:uppercase">
              {b.soon}
            </span>
          </div>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="relative z-10 -me-1.5 -mt-1"
                aria-label={`More for ${b.guestName}`}
                title="More"
              >
                <Ellipsis className="size-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {b.joinUrl && action?.key !== "join" && (
                <DropdownMenuItem asChild>
                  <a href={b.joinUrl} target="_blank" rel="noreferrer">
                    Join
                  </a>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem variant="destructive" onSelect={() => onCancel(b)}>
                Cancel the meeting
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="text-muted-foreground flex min-w-0 flex-wrap items-center gap-x-3.5 gap-y-2 text-[13px]">
          <TypePill name={b.linkTitle} />
          {b.place && (
            <span className="inline-flex min-w-0 items-center gap-1.5">
              {b.place.online ? (
                <Video className="size-3.5 shrink-0" aria-hidden="true" />
              ) : (
                <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
              )}
              <span className="min-w-0 break-words">{b.place.label}</span>
            </span>
          )}
          {!b.verified && (
            <Badge variant="outline" title={b.waiting ?? undefined}>
              Unconfirmed
            </Badge>
          )}
          {b.needsHost && <Badge variant="destructive">Needs a host</Badge>}
        </div>

        <div className="border-border/70 mt-auto flex min-h-[3.0625rem] flex-wrap items-center justify-between gap-3 border-t pt-4">
          <span className="flex min-w-0 items-center gap-2">
            <UserAvatar user={b.host} size="sm" />
            <span className="text-muted-foreground min-w-0 text-[13px] leading-snug break-words">
              {b.mine ? "You're hosting" : `With ${b.host.name}`}
            </span>
          </span>
          {action && <AmbientButton action={action} className="relative z-10" />}
        </div>
      </div>
    </li>
  );
}
