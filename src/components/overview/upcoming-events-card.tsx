import {
  CalendarDays,
  CircleCheck,
  CircleQuestionMark,
  CircleX,
  Mail,
  MapPin,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

import { KIND_META, RSVP_META } from "@/components/calendar/kinds";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { RSVPStatus } from "@/generated/prisma/enums";
import type { CalendarEventSummary } from "@/app/app/[orgSlug]/calendar/queries";
import { formatEventWhen } from "@/lib/calendar/format";

const RSVP_ICON: Record<RSVPStatus, LucideIcon> = {
  PENDING: Mail,
  YES: CircleCheck,
  NO: CircleX,
  MAYBE: CircleQuestionMark,
};

/** The next few events, with the viewer's own RSVP where they were invited. */
export function UpcomingEventsCard({
  orgSlug,
  events,
  rsvps,
  zones,
  now,
  className,
  title = "Coming up",
  icon: Icon = CalendarDays,
  empty,
  bare = false,
}: {
  orgSlug: string;
  events: readonly CalendarEventSummary[];
  rsvps: ReadonlyMap<string, RSVPStatus>;
  zones: { viewer: string; org: string };
  now: Date;
  className?: string;
  title?: string;
  icon?: LucideIcon;
  /** What to show with nothing coming up, with a next step. */
  empty?: React.ReactNode;
  /** Inside a board widget, which has its own frame and title. */
  bare?: boolean;
}) {
  if (bare) {
    return (
      <div className="space-y-1">
        {events.length === 0 ? (
          (empty ?? <p className="text-muted-foreground text-sm">Nothing on the calendar yet.</p>)
        ) : (
          <ul className="divide-y">
            {events.map((event) => {
              const rsvp = rsvps.get(event.id);
              const RsvpIcon = rsvp ? RSVP_ICON[rsvp] : null;
              return (
                <li key={event.id}>
                  <Link
                    href={`/app/${orgSlug}/calendar/${event.id}`}
                    className="hover:bg-accent/50 -mx-2 block space-y-0.5 rounded-md px-2 py-2"
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">{event.title}</span>
                      {rsvp && RsvpIcon && (
                        <span className="text-muted-foreground inline-flex shrink-0 items-center gap-1 text-xs">
                          <RsvpIcon className="size-3.5" aria-hidden="true" />
                          {RSVP_META[rsvp].short}
                        </span>
                      )}
                    </span>
                    <span className="text-muted-foreground block text-xs">
                      {formatEventWhen(event, zones, now)}
                    </span>
                    <span className="text-muted-foreground flex min-w-0 items-center gap-1 text-xs">
                      <span className="shrink-0">{KIND_META[event.kind].label}</span>
                      {event.location && (
                        <>
                          <span aria-hidden="true">·</span>
                          <MapPin className="size-3 shrink-0" aria-hidden="true" />
                          <span className="truncate">{event.location}</span>
                        </>
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        <Link href={`/app/${orgSlug}/calendar`} className="text-muted-foreground block pt-1 text-xs hover:underline">
          Open the calendar
        </Link>
      </div>
    );
  }
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Icon className="text-muted-foreground size-4" aria-hidden="true" />
          {title}
        </CardTitle>
        <CardAction>
          <Link
            href={`/app/${orgSlug}/calendar`}
            className="text-muted-foreground text-sm hover:underline"
          >
            Calendar
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          (empty ?? <p className="text-muted-foreground text-sm">Nothing on the calendar yet.</p>)
        ) : (
          <ul className="divide-y">
            {events.map((event) => {
              const rsvp = rsvps.get(event.id);
              const RsvpIcon = rsvp ? RSVP_ICON[rsvp] : null;
              return (
                <li key={event.id}>
                  <Link
                    href={`/app/${orgSlug}/calendar/${event.id}`}
                    className="hover:bg-accent/50 -mx-2 block space-y-0.5 rounded-md px-2 py-2"
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">{event.title}</span>
                      {rsvp && RsvpIcon && (
                        <span className="text-muted-foreground inline-flex shrink-0 items-center gap-1 text-xs">
                          <RsvpIcon className="size-3.5" aria-hidden="true" />
                          {RSVP_META[rsvp].short}
                        </span>
                      )}
                    </span>
                    <span className="text-muted-foreground block text-xs">
                      {formatEventWhen(event, zones, now)}
                    </span>
                    <span className="text-muted-foreground flex min-w-0 items-center gap-1 text-xs">
                      <span className="shrink-0">{KIND_META[event.kind].label}</span>
                      {event.location && (
                        <>
                          <span aria-hidden="true">·</span>
                          <MapPin className="size-3 shrink-0" aria-hidden="true" />
                          <span className="truncate">{event.location}</span>
                        </>
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
