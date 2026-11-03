"use client";

import { ArrowUpRight, CalendarCheck2, Check, EyeOff, RotateCcw, X } from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";

import { ContextActions } from "@/components/context-actions";
import { BlockCard } from "@/components/ui/block-card";
import { toast } from "@/components/ui/toaster";
import type { UpNextSlot } from "@/lib/overview/up-next";
import type { EventKind, RSVPStatus, TaskStatus } from "@/generated/prisma/enums";
import { KIND_META } from "@/components/calendar/kinds";
import { cn } from "@/lib/utils";
import type { UpNextBlock } from "@/server/overview/up-next";

import { FaceStack, OpenLink } from "./bits";
import { LinkChip } from "./connections";

/** An event kind's colour for its block card; nothing for anything else. */
function accentOf(kind: EventKind | null | undefined): string | null {
  // OTHER has no colour of its own, so its card stays the quiet near-black
  // rather than being painted in the neutral ink.
  if (!kind || kind === "OTHER") return null;
  return `var(${KIND_META[kind].fill})`;
}

/**
 * Up next (redesign guide 9): a row of up to four block cards, what needs
 * you first. On a phone the row scrolls sideways, a card and a bit at a
 * time. A bare board widget: it draws its own heading.
 *
 * Each card does its one job right there: a task has Done, an invitation
 * waiting on you has Going and Can't go. The x hides a card for you, with
 * Undo in the toast. Clicking the card itself still opens the thing. Under
 * the title, one line says why it matters, and chips open what it's linked
 * to (the event a task is for, a meeting's notes).
 */
/** A card's action button, on the card's own colours. */
const ACT =
  "relative z-10 inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold ring-1 ring-current/25 transition-[box-shadow,transform] hover:ring-current/60 active:scale-[0.97] disabled:opacity-60";

/**
 * A card's last row: its action buttons, then (right-aligned) its figure in
 * words ("12 going", "2 of 3 subtasks done") and its avatars. Every kind
 * uses it, so the cards keep one shape and stay short.
 */
function FootRow({
  actions,
  figure,
  figureLabel,
  people,
  total,
}: {
  actions: ReactNode;
  figure?: string;
  figureLabel?: string;
  people: UpNextBlock["faces"];
  total: number;
}) {
  if (!actions && figure === undefined && people.length === 0 && total === 0) return null;
  return (
    <div className="relative z-10 mt-auto flex flex-wrap items-center gap-2 pt-3.5">
      {actions}
      <span className="ms-auto flex min-w-0 items-center gap-2.5">
        {figure !== undefined && (
          <span className="text-[13px] font-medium text-(--meta)">
            <b className="text-current">{figure}</b>
            {figureLabel ? ` ${figureLabel}` : ""}
          </span>
        )}
        <FaceStack people={people} total={total} />
      </span>
    </div>
  );
}

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
  onUnhide,
  onShowAll,
  /** Done on a task card, bound to the space like onHide. */
  onDone,
  /** Going / Can't go on an invitation card, bound to the space like onHide. */
  onRsvp,
  onVote,
  /** How many cards this member has hidden, so they can be put back. */
  hiddenCount = 0,
}: {
  slots: readonly UpNextSlot<UpNextBlock>[];
  calendarHref: string;
  onHide?: (kind: string, refId: string) => Promise<unknown>;
  onUnhide?: (kind: string, refId: string) => Promise<unknown>;
  onShowAll?: () => Promise<unknown>;
  onDone?: (taskId: string, status: TaskStatus) => Promise<unknown>;
  onRsvp?: (eventId: string, rsvp: RSVPStatus) => Promise<unknown>;
  /** Votes on a one-choice poll from its card ([] takes the vote back). */
  onVote?: (pollId: string, optionIds: string[]) => Promise<unknown>;
  hiddenCount?: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  const errorOf = (result: unknown): string | null =>
    result && typeof result === "object" && "error" in result
      ? ((result as { error?: string }).error ?? null)
      : null;

  const hide = (kind: string, id: string) =>
    start(async () => {
      await onHide?.(kind, id);
      router.refresh();
      toast({
        title: "Hidden",
        action: onUnhide
          ? {
              label: "Undo",
              run: async () => {
                await onUnhide(kind, id);
                router.refresh();
              },
            }
          : undefined,
      });
    });

  const done = (item: UpNextBlock) =>
    start(async () => {
      if (!onDone) return;
      setBusy(item.id);
      const before = (item.taskStatus ?? "NOT_STARTED") as TaskStatus;
      const failed = errorOf(await onDone(item.id, "COMPLETED"));
      setBusy(null);
      if (failed) {
        toast({ title: failed, tone: "error" });
        return;
      }
      router.refresh();
      toast({
        title: "Done",
        tone: "success",
        action: {
          label: "Undo",
          run: async () => {
            const undone = errorOf(await onDone(item.id, before));
            if (undone) return undone;
            router.refresh();
          },
        },
      });
    });

  const answer = (item: UpNextBlock, rsvp: RSVPStatus) =>
    start(async () => {
      if (!onRsvp) return;
      setBusy(item.id);
      const failed = errorOf(await onRsvp(item.id, rsvp));
      setBusy(null);
      if (failed) {
        toast({ title: failed, tone: "error" });
        return;
      }
      router.refresh();
      toast({
        title: rsvp === "YES" ? "Going" : "Answered",
        action: {
          label: "Undo",
          run: async () => {
            const undone = errorOf(await onRsvp(item.id, "PENDING"));
            if (undone) return undone;
            router.refresh();
          },
        },
      });
    });

  const vote = (item: UpNextBlock, optionId: string) =>
    start(async () => {
      if (!onVote) return;
      setBusy(item.id);
      const failed = errorOf(await onVote(item.id, [optionId]));
      setBusy(null);
      if (failed) {
        toast({ title: failed, tone: "error" });
        return;
      }
      router.refresh();
      toast({
        title: "Voted",
        action: {
          label: "Undo",
          run: async () => {
            const undone = errorOf(await onVote(item.id, []));
            if (undone) return undone;
            router.refresh();
          },
        },
      });
    });

  /** The card's own job, right on it. */
  const actionsOf = (item: UpNextBlock) => {
    const working = pending && busy === item.id;
    if (item.kind === "task" && onDone) {
      return (
        <button type="button" disabled={working} onClick={() => done(item)} className={ACT}>
          <Check className="size-3.5" aria-hidden="true" />
          Done
        </button>
      );
    }
    if (item.kind === "rsvp" && onRsvp) {
      return (
        <>
          <button
            type="button"
            disabled={working}
            onClick={() => answer(item, "YES")}
            className={cn(ACT, "bg-current/10")}
          >
            Going
          </button>
          <button
            type="button"
            disabled={working}
            onClick={() => answer(item, "NO")}
            className={ACT}
          >
            Can&apos;t go
          </button>
        </>
      );
    }
    if (item.kind === "poll" && onVote && item.choices?.length) {
      return item.choices.map((c) => (
        <button
          key={c.id}
          type="button"
          disabled={working}
          onClick={() => vote(item, c.id)}
          className={ACT}
        >
          {c.label}
        </button>
      ));
    }
    return null;
  };
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
        <OpenLink href={calendarHref} label="Calendar" />
      </div>
      {slots.length === 0 ? (
        <div className="bg-muted/60 rounded-block text-muted-foreground flex items-center gap-3 p-5 text-sm">
          <CalendarCheck2 className="size-5 shrink-0" aria-hidden="true" />
          Nothing this week.
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
                  label: "Hide",
                  icon: EyeOff,
                  disabled: pending,
                  onSelect: () => hide(item.kind, item.id),
                },
              ]}
            >
              <BlockCard
                tone={item.tone}
                live={item.live}
                accent={accentOf(item.eventKind)}
                kicker={item.kicker}
                title={item.title}
                subtitle={item.subtitle}
                href={item.href}
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
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => hide(item.kind, item.id)}
                      aria-label={`Hide ${item.title}`}
                      title="Hide"
                      className="grid size-8 cursor-pointer place-items-center rounded-full ring-1 ring-current/25 transition-transform hover:ring-current/50 active:scale-[0.94] disabled:opacity-60"
                    >
                      <X className="size-4" aria-hidden="true" />
                    </button>
                  )
                }
                className={cn(
                  "min-h-0 w-[82%] shrink-0 snap-start sm:w-auto",
                  item.wide && "sm:col-span-2",
                  "max-md:w-full",
                  index > 0 && "max-md:hidden",
                )}
              >
                {/* The chips sit on the card's own colour, so they take its ink (currentColor), not their kind's. */}
                {item.chips && item.chips.length > 0 && (
                  <span className="relative z-10 mt-3 flex min-w-0 flex-wrap gap-1.5">
                    {item.chips.map((chip) => (
                      <LinkChip
                        key={`${chip.kind}:${chip.href}:${chip.label}`}
                        item={chip}
                        className="border-current/20 bg-current/10 text-current hover:border-current/40 hover:text-current [&_svg]:text-current"
                      />
                    ))}
                  </span>
                )}
                {/* One row at the foot: the card's job on the left, its figure and who's on it on the right. */}
                <FootRow
                  actions={actionsOf(item)}
                  figure={moreAlerts > 0 ? `+${moreAlerts}` : item.figure}
                  figureLabel={moreAlerts > 0 ? "more due today or overdue" : item.figureLabel}
                  people={item.faces}
                  total={item.facesTotal}
                />
              </BlockCard>
            </ContextActions>
          ))}
        </div>
      )}
    </section>
  );
}
