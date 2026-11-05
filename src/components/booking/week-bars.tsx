import { minuteLabel } from "@/lib/booking/hours";
import { weekWindow, type WeekDay } from "@/lib/booking/week";
import { cn } from "@/lib/utils";

/**
 * A link's week as a picture, in Find a time's colours: the next seven days
 * across, the day running down, green where they're free. The same scale for
 * all seven days, so a short day looks short. `days` null is a week nobody
 * can see yet (a link that's off): seven empty bars.
 *
 * `large` is the Personal page's: taller, with each day's name and, where
 * there's room, its hours in words.
 */

const TRACK = "color-mix(in oklab, var(--foreground) 7%, transparent)";
const FREE = "color-mix(in oklab, var(--success) 62%, var(--card))";
const FREE_TODAY = "color-mix(in oklab, var(--success) 88%, var(--card))";

const EMPTY = ["a", "b", "c", "d", "e", "f", "g"];

export function WeekBars({
  days,
  label,
  large = false,
  className,
}: {
  days: readonly WeekDay[] | null;
  /** The week in words, for a screen reader. */
  label?: string;
  large?: boolean;
  className?: string;
}) {
  const height = large ? "h-24" : "h-11";
  if (!days) {
    return (
      <span aria-hidden="true" className={cn("grid grid-cols-7 gap-1.5", className)}>
        {EMPTY.map((k) => (
          <span key={k} className={cn("rounded-[5px]", height)} style={{ background: TRACK }} />
        ))}
      </span>
    );
  }
  const { from, to } = weekWindow(days);
  const pct = (min: number) => ((Math.min(Math.max(min, from), to) - from) / (to - from)) * 100;
  return (
    <span
      role="img"
      aria-label={label ?? "When they're free this week"}
      className={cn("grid grid-cols-7", large ? "gap-2" : "gap-1.5", className)}
    >
      {days.map((d) => (
        <span key={d.key} className="flex min-w-0 flex-col items-center gap-1">
          <span
            className={cn("relative block w-full overflow-hidden rounded-[5px]", height)}
            style={{ background: TRACK }}
          >
            {d.ranges.map(([start, end]) => (
              <span
                key={start}
                className="absolute inset-x-0 rounded-[4px]"
                style={{
                  top: `${pct(start)}%`,
                  height: `${pct(end) - pct(start)}%`,
                  background: d.today ? FREE_TODAY : FREE,
                }}
              />
            ))}
          </span>
          <span
            className={cn(
              "leading-none",
              large ? "text-[12px]" : "text-[11px]",
              d.today ? "text-foreground font-semibold" : "text-muted-foreground font-medium",
            )}
          >
            {large ? d.name.slice(0, 3) : d.name[0]}
          </span>
          {large && (
            <span className="text-muted-foreground text-center text-[11.5px] leading-tight max-md:hidden">
              {d.ranges.length === 0
                ? "Not free"
                : d.ranges.map(([start, end]) => (
                    <span key={start} className="block">
                      {minuteLabel(start)} to {minuteLabel(end)}
                    </span>
                  ))}
            </span>
          )}
        </span>
      ))}
    </span>
  );
}
