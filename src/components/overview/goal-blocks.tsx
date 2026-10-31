import { ArrowUpRight, Plus } from "@/components/icons";
import Link from "next/link";

import { BlockCard } from "@/components/ui/block-card";

/**
 * The Overview's sign-ups block (tone "goal": progress toward something):
 * the next event with a sign-up page and a capacity, its seats drawn as a
 * grid of seats with the taken ones filled (redesign guide 8.4). With no
 * such event it is a quiet ticket and the way to add one. A new
 * organization's first steps are their own card (getting-started.tsx).
 */

function OpenCircle({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      aria-label={label}
      className="grid size-8 place-items-center rounded-full ring-1 ring-current/25 transition-transform hover:ring-current/50 active:scale-[0.94]"
    >
      <ArrowUpRight className="size-4" aria-hidden="true" />
    </Link>
  );
}

/** At most this many seats are drawn; past it each one stands for a few. */
const MAX_SEATS = 48;

/** A ticket stub, drawn in the text colour, for the empty state. */
function TicketArt() {
  return (
    <svg viewBox="0 0 120 72" aria-hidden="true" className="text-muted-foreground h-16 w-auto">
      <path
        d="M10 6h100a4 4 0 0 1 4 4v14a10 10 0 0 0 0 24v14a4 4 0 0 1-4 4H10a4 4 0 0 1-4-4V48a10 10 0 0 0 0-24V10a4 4 0 0 1 4-4Z"
        className="fill-muted stroke-current"
        strokeOpacity={0.35}
        strokeWidth={1.5}
      />
      <path d="M84 12v48" className="stroke-current" strokeOpacity={0.4} strokeDasharray="3 4" />
      <rect x="20" y="22" width="44" height="6" rx="3" className="fill-current" opacity={0.35} />
      <rect x="20" y="34" width="30" height="5" rx="2.5" className="fill-current" opacity={0.2} />
      <rect x="20" y="45" width="36" height="5" rx="2.5" className="fill-current" opacity={0.2} />
      <circle cx="98" cy="36" r="6" className="fill-current" opacity={0.25} />
    </svg>
  );
}

export function RsvpGoalBlock({
  event,
  when,
  taken,
  href,
  createHref,
}: {
  event: { title: string; capacity: number } | null;
  /** "Sat, Oct 24". */
  when: string | null;
  /** Seats taken, or null when the page hides its count. */
  taken: number | null;
  href: string | null;
  /** Where an officer adds a sign-up page (none for members). */
  createHref: string | null;
}) {
  if (!event || !href) {
    return (
      <div className="bg-card ring-foreground/6 rounded-card edge flex h-full min-h-48 flex-col items-center justify-center gap-3 p-6 text-center ring-1">
        <TicketArt />
        <div className="space-y-1">
          <p className="heading text-[15px]">No sign-ups open</p>
          <p className="text-muted-foreground mx-auto max-w-[24ch] text-[13px]">
            Events with a capacity show their seats filling up here.
          </p>
        </div>
        {createHref && (
          <Link
            href={createHref}
            className="bg-foreground text-background inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold transition-opacity hover:opacity-90"
          >
            <Plus className="size-3.5" aria-hidden="true" />
            Add a sign-up page
          </Link>
        )}
      </div>
    );
  }
  const capacity = Math.max(1, event.capacity);
  const per = Math.ceil(capacity / MAX_SEATS);
  const seats = Math.ceil(capacity / per);
  const filled = taken === null ? 0 : Math.min(seats, Math.round(Math.min(taken, capacity) / per));
  const left = taken === null ? null : Math.max(0, capacity - taken);
  return (
    <BlockCard
      tone="goal"
      title={event.title}
      href={href}
      kicker={when}
      action={<OpenCircle href={href} label={`Open ${event.title}`} />}
      className="h-full min-h-0"
    >
      {taken !== null ? (
        <>
          <p className="mt-4 flex items-baseline gap-1.5">
            <b className="numeral text-[34px] leading-none">{taken}</b>
            <span className="text-[14px] text-(--meta)">of {capacity} seats</span>
          </p>
          <div
            role="img"
            aria-label={`${taken} of ${capacity} seats taken${per > 1 ? `, each dot is ${per} seats` : ""}`}
            className="mt-3 grid grid-cols-[repeat(12,minmax(0,1fr))] gap-1"
          >
            {Array.from({ length: seats }, (_, i) => (
              <span
                key={i}
                className={
                  i < filled
                    ? "aspect-square rounded-[4px] bg-current"
                    : "aspect-square rounded-[4px] bg-current/18"
                }
              />
            ))}
          </div>
          <p className="mt-2.5 text-[13px] font-semibold">
            {left === 0 ? "Full" : `${left} ${left === 1 ? "seat" : "seats"} left`}
          </p>
        </>
      ) : (
        <p className="mt-4 text-[14px] text-(--meta)">{capacity} seats</p>
      )}
    </BlockCard>
  );
}
