import { KIND_INK } from "@/components/calendar/kinds";
import { cn } from "@/lib/utils";

/**
 * The date tile and type pill Meetings' cards are built from, on their own
 * so Meeting links' Coming up (a client component) draws the same ones
 * without bringing the whole card. Both need `--kind` set by a parent.
 */

export const MONTH = (timeZone: string) => new Intl.DateTimeFormat("en-US", { month: "short", timeZone });
export const DAY = (timeZone: string) => new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone });
export const WEEKDAY = (timeZone: string) =>
  new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone });

/** A 15% wash of the meeting type's colour, behind its month and its pill. */
export const KIND_WASH = "color-mix(in oklab, var(--kind) 15%, var(--card))";
/**
 * The type's colour as text on that wash. An organization picks its own
 * colours, a bright yellow among them, so it is pulled toward the text
 * colour to stay readable in both modes.
 */
export const KIND_TEXT = "color-mix(in oklab, var(--kind) 62%, var(--foreground))";

/**
 * The date as a tile: the month in the type's colour, the day in the
 * display face, the weekday. `lit` is the next meeting: the tile filled
 * solid in its colour.
 */
export function DateTile({
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

/** The meeting's type: its name on a wash of its colour, with a dot. */
export function TypePill({ name }: { name: string }) {
  return (
    <span
      style={{ background: KIND_WASH }}
      className="text-foreground inline-flex min-w-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] leading-5 font-semibold"
    >
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-(--kind)" />
      <span className="min-w-0 truncate">{name}</span>
    </span>
  );
}
