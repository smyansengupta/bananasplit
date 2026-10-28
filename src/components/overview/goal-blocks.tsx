import { ArrowUpRight, Ticket } from "@/components/icons";
import Link from "next/link";

import { BlockCard } from "@/components/ui/block-card";
import { Gauge } from "@/components/ui/meters";

/**
 * The Overview's RSVP goal block (tone "goal": progress toward something):
 * seats taken for the next RSVP event (redesign guide 8.4). A new club's
 * first steps are their own card (getting-started.tsx).
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
  /** Where an officer sets up an RSVP page (none for members). */
  createHref: string | null;
}) {
  if (!event || !href) {
    return (
      <div className="bg-muted/60 rounded-block flex h-full min-h-40 flex-col justify-between gap-4 p-5">
        <span className="text-muted-foreground inline-flex items-center gap-2 text-[13px] font-medium">
          <Ticket className="size-4" aria-hidden="true" />
          RSVPs
        </span>
        <p className="text-sm">
          No event with a capacity coming up.
          {createHref && (
            <>
              {" "}
              <Link href={createHref} className="font-semibold underline underline-offset-4">
                Make an RSVP page
              </Link>
            </>
          )}
        </p>
      </div>
    );
  }
  const pct = taken === null ? 0 : (taken / Math.max(1, event.capacity)) * 100;
  return (
    <BlockCard
      tone="goal"
      kicker={`RSVPs · ${when}`}
      action={<OpenCircle href={href} label={`Open ${event.title}`} />}
      className="h-full min-h-0"
    >
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Gauge value={pct} caption="full" size={116} />
        <div className="min-w-0 flex-1 basis-28">
          <h3 className="display-title mb-1.5 text-[21px]">
            <Link href={href} className="after:absolute after:inset-0 after:rounded-[inherit]">
              {event.title}
            </Link>
          </h3>
          <p className="text-sm text-(--meta)">
            {taken === null
              ? `${event.capacity} seats`
              : `${taken} of ${event.capacity} seats taken`}
          </p>
        </div>
      </div>
    </BlockCard>
  );
}
