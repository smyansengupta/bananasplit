import { ArrowUpRight, CalendarCheck2 } from "@/components/icons";
import Link from "next/link";

import { BlockCard } from "@/components/ui/block-card";
import type { UpNextSlot } from "@/lib/overview/up-next";
import { cn } from "@/lib/utils";
import type { UpNextBlock } from "@/server/overview/up-next";

import { FaceStack, OpenLink } from "./bits";

/**
 * Up next (redesign guide 9): a row of up to four block cards, what needs
 * you first. On a phone the row scrolls sideways, a card and a bit at a
 * time. A bare board widget: it draws its own heading.
 */
export function UpNext({
  slots,
  calendarHref,
}: {
  slots: readonly UpNextSlot<UpNextBlock>[];
  calendarHref: string;
}) {
  return (
    <section aria-labelledby="up-next-heading">
      <div className="mb-4 flex items-center gap-2.5">
        <h2 id="up-next-heading" className="heading text-[17px]">
          Up next
        </h2>
        <span className="text-muted-foreground text-sm max-md:hidden">The next 7 days</span>
        <span className="flex-1" />
        <OpenLink href={calendarHref} label="Open the calendar" />
      </div>
      {slots.length === 0 ? (
        <div className="bg-muted/60 rounded-block text-muted-foreground flex items-center gap-3 p-5 text-sm">
          <CalendarCheck2 className="size-5 shrink-0" aria-hidden="true" />
          Nothing needs you this week: no deadlines, votes or meetings.
        </div>
      ) : (
        <div className="-mx-1 flex snap-x snap-mandatory [scrollbar-width:none] gap-3.5 overflow-x-auto px-1 pb-1.5 max-sm:-mx-4 max-sm:scroll-px-4 max-sm:px-4 sm:grid sm:grid-cols-2 sm:overflow-visible xl:grid-cols-4 [&::-webkit-scrollbar]:hidden">
          {/* A phone: just the next one, full width (the ↗ opens the rest). */}
          {slots.map(({ item, moreAlerts }, index) => (
            <BlockCard
              key={`${item.kind}:${item.id}`}
              tone={item.tone}
              kicker={item.kicker}
              title={item.title}
              subtitle={item.subtitle}
              href={item.href}
              figure={moreAlerts > 0 ? `+${moreAlerts}` : item.figure}
              figureLabel={moreAlerts > 0 ? `more due today or overdue` : item.figureLabel}
              aside={<FaceStack people={item.faces} total={item.facesTotal} />}
              action={
                <Link
                  href={item.href}
                  aria-label={`Open ${item.title}`}
                  className="grid size-8 place-items-center rounded-full ring-1 ring-current/25 transition-transform hover:ring-current/50 active:scale-[0.94]"
                >
                  <ArrowUpRight className="size-4" aria-hidden="true" />
                </Link>
              }
              className={cn(
                "min-h-[13.75rem] w-[82%] shrink-0 snap-start max-sm:min-h-44 sm:w-auto",
                "max-md:w-full",
                index > 0 && "max-md:hidden",
              )}
            />
          ))}
        </div>
      )}
    </section>
  );
}
