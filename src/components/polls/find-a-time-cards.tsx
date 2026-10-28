import { ArrowUpRight, Users } from "@/components/icons";
import Link from "next/link";

import { intervalParts } from "@/components/calendar/poll-format";
import { PollStatusBadge } from "@/components/polls/poll-status-badge";
import type { PollListItem } from "@/components/polls/poll-list";
import { TickMeter } from "@/components/ui/meters";
import type { PollHeat, PollSummary } from "@/lib/polls/poll-summary";
import { cn } from "@/lib/utils";

/**
 * Find a time as cards, like the RSVP list: each poll's picture is its own
 * results (a small heat map of who's free when, the best time outlined),
 * then the best time in words, how many can make it, and the next options.
 * The first open poll is the wide one.
 */

export interface FindATimeCard {
  item: PollListItem;
  summary: PollSummary;
  timeZone: string;
  durationMinutes: number;
  /** "Oct 22 – 24": the days it offers. */
  span: string | null;
  firstDay: Date | null;
}

const MONTH = (timeZone: string) => new Intl.DateTimeFormat("en-US", { month: "short", timeZone });
const DAY = (timeZone: string) => new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone });

export function FindATimeCards({
  cards,
  feature = false,
}: {
  cards: FindATimeCard[];
  feature?: boolean;
}) {
  return (
    <ul className="grid gap-4.5 sm:grid-cols-2 xl:grid-cols-3">
      {cards.map((c, i) => (
        <Card key={c.item.id} card={c} featured={feature && i === 0 && cards.length > 1} />
      ))}
    </ul>
  );
}

function Card({ card, featured }: { card: FindATimeCard; featured: boolean }) {
  const { item, summary, timeZone } = card;
  const top = summary.best[0];
  const when = top ? intervalParts(top.slot.startsAt, top.endsAt, timeZone) : null;
  const others = summary.best.slice(1, featured ? 3 : 1);
  return (
    <li className={cn(featured && "sm:col-span-2")}>
      <Link
        href={item.href}
        className={cn(
          "group bg-card text-card-foreground edge rounded-card focus-glow hover:shadow-e2 flex h-full overflow-hidden transition-[transform,box-shadow] duration-200 ease-(--ease-ink) hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0",
          featured ? "flex-col sm:flex-row" : "flex-col",
        )}
      >
        <HeatCover
          heat={summary.heat}
          firstDay={card.firstDay}
          timeZone={timeZone}
          className={
            featured ? "aspect-[16/10] sm:aspect-auto sm:min-h-60 sm:w-1/2" : "aspect-[16/9]"
          }
        />
        <span className={cn("flex min-w-0 flex-1 flex-col gap-3", featured ? "p-6" : "p-4.5")}>
          <span className="space-y-1">
            <span className="flex items-start justify-between gap-2">
              <span
                className={cn(
                  "min-w-0 font-semibold break-words",
                  featured ? "display-title text-2xl" : "line-clamp-2 text-[15px]",
                )}
              >
                {item.title}
              </span>
              <PollStatusBadge tone={item.status.tone}>{item.status.label}</PollStatusBadge>
            </span>
            <span className="text-muted-foreground block text-[13px]">
              {[card.span, `${card.durationMinutes} min`].filter(Boolean).join(", ")}
            </span>
          </span>

          {top && when ? (
            <span className="flex flex-col gap-1.5">
              <span className="text-muted-foreground text-[12px] font-medium">Best time</span>
              <span className={cn("font-semibold", featured ? "text-[17px]" : "text-[15px]")}>
                {when.day}, {when.time}
              </span>
              <span className="flex items-center gap-2 text-[13px] tabular-nums">
                <span>
                  <span className="font-semibold">{top.score}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    of {summary.respondents} can make it
                  </span>
                </span>
              </span>
              {summary.respondents <= 60 && (
                <TickMeter
                  total={summary.respondents}
                  filled={top.score}
                  height={8}
                  color="var(--success)"
                  label={`${top.score} of ${summary.respondents} can make it`}
                  className="w-full max-w-48"
                />
              )}
              {others.length > 0 && (
                <span className="text-muted-foreground mt-1 flex flex-col gap-0.5 text-[13px]">
                  {others.map((o) => {
                    const p = intervalParts(o.slot.startsAt, o.endsAt, timeZone);
                    return (
                      <span key={o.slot.id}>
                        Also {p.day}, {p.time}: {o.score} of {summary.respondents}
                      </span>
                    );
                  })}
                </span>
              )}
            </span>
          ) : (
            <span className="text-muted-foreground text-[13px]">
              No answers yet. Share the link and the best time shows here.
            </span>
          )}

          <span className="mt-auto flex items-end justify-between gap-3">
            <span className="text-muted-foreground flex items-center gap-1.5 text-[13px]">
              <Users className="size-3.5" aria-hidden="true" />
              {summary.respondents === 1
                ? "1 person answered"
                : `${summary.respondents} people answered`}
            </span>
            <ArrowUpRight
              className="text-muted-foreground group-hover:text-foreground size-4 flex-none transition-colors"
              aria-hidden="true"
            />
          </span>
        </span>
      </Link>
    </li>
  );
}

/**
 * The poll's picture: its answers as a heat map, days across and times
 * down, greener where more people are free, the best time outlined in the
 * glow. A calendar leaf with the first day sits on top, as on RSVP cards.
 */
function HeatCover({
  heat,
  firstDay,
  timeZone,
  className,
}: {
  heat: PollHeat;
  firstDay: Date | null;
  timeZone: string;
  className?: string;
}) {
  const cols = Math.max(1, heat.days);
  const rows = Math.max(1, heat.times);
  return (
    <span
      className={cn("relative block overflow-hidden", className)}
      style={{ background: "color-mix(in oklab, var(--success) 10%, var(--card))" }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-4 grid gap-[3px] ps-14 pt-1"
        style={{
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
        }}
      >
        {heat.cells.map((value, i) => (
          <span
            key={i}
            className={cn("rounded-[4px]", heat.best[i] && "ring-glow ring-2 ring-offset-0")}
            style={{
              background:
                value === null
                  ? "transparent"
                  : value === 0
                    ? "color-mix(in oklab, var(--foreground) 7%, transparent)"
                    : `color-mix(in oklab, var(--success) ${Math.round(22 + value * 70)}%, var(--card))`,
            }}
          />
        ))}
      </span>
      {firstDay && (
        <span className="bg-card text-card-foreground rounded-tile shadow-e1 absolute top-3 left-3 flex w-12 flex-col items-center py-1.5 leading-none">
          <span className="text-muted-foreground text-[11px] font-semibold uppercase">
            {MONTH(timeZone).format(firstDay)}
          </span>
          <span className="numeral mt-0.5 text-lg">{DAY(timeZone).format(firstDay)}</span>
        </span>
      )}
    </span>
  );
}
