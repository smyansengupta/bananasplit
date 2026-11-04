import { CalendarCheck, Users } from "@/components/icons";

import { intervalParts } from "@/components/calendar/poll-format";
import {
  pickDistinctWindows,
  rankSlotsByAvailability,
} from "@/components/calendar/poll-grid-utils";
import { avatarTint } from "@/components/user-avatar";
import { TickMeter } from "@/components/ui/meters";
import type { PollView } from "@/lib/polls/poll-view";
import { cn } from "@/lib/utils";

/**
 * The top of a find-a-time poll: the answer first. The best times that
 * don't overlap, as cards (the best one a green Progress block), each with
 * how many can make it, who, and who only "if needed"; then everyone who
 * has answered. The grid to mark your own times and the heat map follow
 * below (PollResponder). Nothing until someone answers.
 */
export function PollResultsHero({ poll }: { poll: PollView }) {
  const labelOf = new Map(poll.responses.map((r) => [r.respondentKey, r.label]));
  const respondents = labelOf.size;
  if (respondents === 0) return null;
  const best = pickDistinctWindows(
    rankSlotsByAvailability(poll.slots, poll.responses, poll.durationMinutes),
    3,
  );
  const zone = poll.timezone;

  return (
    <section aria-labelledby="poll-best" className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="poll-best" className="heading text-[17px]">
          {poll.scheduled ? "Scheduled" : "Best times"}
        </h2>
        <span className="text-muted-foreground flex items-center gap-1.5 text-[13px]">
          <Users className="size-3.5" aria-hidden="true" />
          {respondents === 1 ? "1 person answered" : `${respondents} people answered`}
        </span>
      </div>

      {poll.scheduled ? (
        <div className="bg-block-goal text-block-goal-foreground rounded-block flex items-center gap-4 p-6">
          <CalendarCheck className="size-6 flex-none" aria-hidden="true" />
          <div>
            <p className="display-title text-[23px]">
              {intervalParts(poll.scheduled.startsAt, poll.scheduled.endsAt, zone).day}
            </p>
            <p className="text-[15px] text-(--block-goal-meta)">
              {intervalParts(poll.scheduled.startsAt, poll.scheduled.endsAt, zone).time}
            </p>
          </div>
        </div>
      ) : best.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No time works for anyone yet. More answers will show one.
        </p>
      ) : (
        <ul className="grid list-none gap-4.5 p-0 md:grid-cols-3">
          {best.map((window, i) => {
            const when = intervalParts(window.slot.startsAt, window.endsAt, zone);
            const ifNeeded = new Set(window.ifNeededKeys);
            const sure = window.respondentKeys.filter((k) => !ifNeeded.has(k));
            const first = i === 0;
            return (
              <li
                key={window.slot.id}
                className={cn(
                  "rounded-block flex flex-col gap-3 p-5",
                  first
                    ? "bg-block-goal text-block-goal-foreground [--meta:var(--block-goal-meta)] md:col-span-1"
                    : "bg-card edge [--meta:var(--muted-foreground)]",
                )}
              >
                <div>
                  <p className="text-[13px] font-medium text-(--meta)">
                    {first ? "Best time" : `Option ${i + 1}`}
                  </p>
                  <p className="display-title mt-1 text-[22px]">{when.day}</p>
                  <p className="text-[15px] text-(--meta)">{when.time}</p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <p className="text-[14px] tabular-nums">
                    <span className="numeral text-[20px]">{window.score}</span>
                    <span className="text-(--meta)"> of {respondents} can make it</span>
                  </p>
                  {respondents <= 60 && (
                    <TickMeter
                      total={respondents}
                      filled={window.score}
                      height={8}
                      color={first ? "currentColor" : "var(--success)"}
                      label={`${window.score} of ${respondents} can make it`}
                    />
                  )}
                </div>
                <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                  {sure.map((k) => (
                    <NameChip key={k} name={labelOf.get(k) ?? "Someone"} />
                  ))}
                  {[...ifNeeded].map((k) => (
                    <NameChip key={k} name={labelOf.get(k) ?? "Someone"} ifNeeded />
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function NameChip({ name, ifNeeded = false }: { name: string; ifNeeded?: boolean }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return (
    <li
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full bg-[color-mix(in_oklab,currentColor_10%,transparent)] py-0.5 pr-2.5 pl-0.5 text-[12px] font-medium",
        ifNeeded && "opacity-75",
      )}
      title={ifNeeded ? `${name}, if needed` : name}
    >
      <span
        aria-hidden="true"
        className={cn(
          "grid size-6 place-items-center rounded-full text-[10px] font-bold",
          avatarTint(name),
        )}
      >
        {initials || "?"}
      </span>
      {name}
      {ifNeeded && <span className="opacity-80">(if needed)</span>}
    </li>
  );
}
