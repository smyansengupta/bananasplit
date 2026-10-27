"use client";

import {
  ArrowUpRight,
  CalendarCheck2,
  EyeOff,
  MoreHorizontal,
  RotateCcw,
} from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { ContextActions } from "@/components/context-actions";
import { BlockCard } from "@/components/ui/block-card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { tagColorOf, tagToken } from "@/lib/calendar/tags";
import type { UpNextSlot } from "@/lib/overview/up-next";
import { cn } from "@/lib/utils";
import type { UpNextBlock } from "@/server/overview/up-next";

import { FaceStack, OpenLink } from "./bits";

/** An event type's colour for a block card, or null for the quiet card. */
function accentOf(color: string | null | undefined): string | null {
  const name = tagColorOf(color);
  return name ? `var(${tagToken(name)})` : null;
}

/**
 * Up next (redesign guide 9): a row of up to four block cards, what needs
 * you first. On a phone the row scrolls sideways, a card and a bit at a
 * time. A bare board widget: it draws its own heading.
 */
export function UpNext({
  slots,
  calendarHref,
  /**
   * Hiding a card, bound to one space by the page. Passed in rather than
   * imported, so rendering this component does not drag the server-action
   * stack (and next-auth with it) into everything that shows an Up next.
   * Without it there is no Hide at all: a dismissal is a row in one org, and
   * the Personal dashboard's Up next gathers cards from every space.
   */
  onHide,
  onShowAll,
  /** How many cards this member has hidden, so they can be put back. */
  hiddenCount = 0,
}: {
  slots: readonly UpNextSlot<UpNextBlock>[];
  calendarHref: string;
  onHide?: (kind: string, refId: string) => Promise<unknown>;
  onShowAll?: () => Promise<unknown>;
  hiddenCount?: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const hide = (kind: string, id: string) =>
    start(async () => {
      await onHide?.(kind, id);
      router.refresh();
    });
  const showAll = () =>
    start(async () => {
      await onShowAll?.();
      router.refresh();
    });

  return (
    <section aria-labelledby="up-next-heading">
      <div className="mb-4 flex items-center gap-2.5">
        <h2 id="up-next-heading" className="heading text-[17px]">
          Up next
        </h2>
        <span className="text-muted-foreground text-sm max-md:hidden">The next 7 days</span>
        <span className="flex-1" />
        {onShowAll && hiddenCount > 0 && (
          <button
            type="button"
            onClick={showAll}
            disabled={pending}
            className="text-muted-foreground hover:text-foreground focus-glow inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[13px] transition-colors outline-none disabled:opacity-50"
          >
            <RotateCcw className="size-3.5" aria-hidden="true" />
            Show {hiddenCount} hidden
          </button>
        )}
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
            // Right-click a card for the same two things its "…" offers.
            <ContextActions
              key={`${item.kind}:${item.id}`}
              heading={item.title}
              items={[
                { label: "Open", icon: ArrowUpRight, href: item.href },
                onHide && {
                  label: "Hide this",
                  icon: EyeOff,
                  disabled: pending,
                  onSelect: () => hide(item.kind, item.id),
                },
              ]}
            >
              <BlockCard
                tone={item.tone}
                // tagColorOf, not the raw value: tagToken turns anything it
                // does not know into --muted-foreground, which would paint a
                // grey card instead of leaving it the quiet near-black.
                accent={accentOf(item.accent)}
                kicker={item.kicker}
                title={item.title}
                subtitle={item.subtitle}
                href={item.href}
                figure={moreAlerts > 0 ? `+${moreAlerts}` : item.figure}
                figureLabel={moreAlerts > 0 ? `more due today or overdue` : item.figureLabel}
                aside={<FaceStack people={item.faces} total={item.facesTotal} />}
                action={
                  !onHide ? (
                    <Link
                      href={item.href}
                      aria-label={`Open ${item.title}`}
                      className="grid size-8 place-items-center rounded-full ring-1 ring-current/25 transition-transform hover:ring-current/50 active:scale-[0.94]"
                    >
                      <ArrowUpRight className="size-4" aria-hidden="true" />
                    </Link>
                  ) : (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        aria-label={`What to do with ${item.title}`}
                        className="grid size-8 place-items-center rounded-full ring-1 ring-current/25 transition-transform hover:ring-current/50 focus-visible:outline-none active:scale-[0.94]"
                      >
                        <MoreHorizontal className="size-4" aria-hidden="true" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-52">
                        <DropdownMenuItem asChild>
                          <Link href={item.href}>
                            <ArrowUpRight aria-hidden="true" />
                            Open
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={pending}
                          onSelect={() => hide(item.kind, item.id)}
                        >
                          <EyeOff aria-hidden="true" />
                          Hide this
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )
                }
                className={cn(
                  "min-h-[13.75rem] w-[82%] shrink-0 snap-start max-sm:min-h-44 sm:w-auto",
                  "max-md:w-full",
                  index > 0 && "max-md:hidden",
                )}
              />
            </ContextActions>
          ))}
        </div>
      )}
    </section>
  );
}
