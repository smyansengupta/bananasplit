"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { MAX_RULES, type Availability } from "@/lib/availability";
import { dayWordOfKey } from "@/lib/overview/format";
import { blockHours, hoursWord } from "@/lib/overview/focus-time";
import { andList } from "@/lib/overview/ownership";
import { runAction } from "@/lib/run-action";
import { cn } from "@/lib/utils";
import type { FocusTimeData } from "@/server/overview/focus-time";
import { saveFocusAvailability } from "@/server/overview/focus-time-actions";

/**
 * Focus time (the Personal home's card): the viewer's longest free
 * stretch in the next seven days, the free hours of each day as a strip,
 * and when their next tasks are due (src/server/overview/focus-time.ts).
 * A narrow card beside This week (ambient.ts), so everything in it is a
 * line or two.
 *
 * Block it off adds the stretch to the viewer's availability as a one-day
 * rule labelled "Focus time" (the same availability the profile saves,
 * through the Personal space's own action), so it counts as busy from then
 * on; at most four hours of it, so a free afternoon doesn't swallow a
 * whole day.
 */

/** The longest Block it off takes. */
const BLOCK_MAX_HOURS = 4;
const FOCUS_LABEL = "Focus time";

/** "today" and "tomorrow" read lower-case mid-sentence; day names keep their capital. */
const midSentence = (word: string) =>
  word === "Today" || word === "Tomorrow" ? word.toLowerCase() : word;

export function FocusTime({ orgId, data }: { orgId: string; data: FocusTimeData }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const { week, todayKey } = data;
  const best = week.best;
  const most = Math.max(1, ...week.days.map((d) => d.free));
  const empty = data.availability.blocks.length === 0 && data.availability.rules.length === 0;

  const block = best ? { ...best, end: Math.min(best.end, best.start + BLOCK_MAX_HOURS) } : null;
  const blockWord = block
    ? `${midSentence(dayWordOfKey(block.key, todayKey))}, ${blockHours(block.start, block.end)}`
    : "";

  const save = async (next: Availability): Promise<string | null> => {
    const result = await runAction(() => saveFocusAvailability(orgId, next));
    // A throw already said so (runAction's toast).
    if (!result) return "";
    return result.ok ? null : result.error;
  };

  const blockOff = () =>
    start(async () => {
      if (!block) return;
      const before = data.availability;
      if (before.rules.length >= MAX_RULES) {
        toast({
          title: `You have ${MAX_RULES} availability rules already`,
          description: "Remove one on your profile to add another.",
          tone: "error",
        });
        return;
      }
      const failed = await save({
        ...before,
        rules: [
          ...before.rules,
          { kind: "date", label: FOCUS_LABEL, date: block.key, start: block.start, end: block.end },
        ],
      });
      if (failed !== null) {
        if (failed) toast({ title: failed, tone: "error" });
        return;
      }
      router.refresh();
      toast({
        title: "Blocked off",
        action: {
          label: "Undo",
          run: async () => {
            const undone = await save(before);
            if (undone !== null) return undone || undefined;
            router.refresh();
          },
        },
      });
    });

  const tasks = data.tasks;
  const firstDue = tasks[0]?.dueKey;
  return (
    <div className="flex h-full flex-col gap-3">
      <div>
        <p className="text-[17px] leading-snug font-semibold">
          {best ? dayWordOfKey(best.key, todayKey) : "No free hours"}
        </p>
        <p className="text-muted-foreground text-[13px] leading-snug">
          {best
            ? `${blockHours(best.start, best.end)}, ${hoursWord(best.end - best.start)} free`
            : "Your next seven days are full."}
        </p>
      </div>

      <ol className="grid grid-cols-7 gap-1" aria-label="Free hours each day">
        {week.days.map((d) => {
          const isBest = best?.key === d.key;
          return (
            <li
              key={d.key}
              className="flex min-w-0 flex-col items-center gap-1"
              aria-label={`${dayWordOfKey(d.key, todayKey)}: ${hoursWord(d.free)} free`}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "block h-5 w-full rounded-[6px]",
                  isBest
                    ? "bg-tint-success-foreground"
                    : d.free === 0
                      ? "bg-muted-strong"
                      : d.free / most >= 0.6
                        ? "bg-tint-success"
                        : "bg-tint-success/70",
                )}
              />
              <span
                aria-hidden="true"
                className={cn(
                  "text-[11px] font-semibold",
                  isBest ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {d.letter}
              </span>
            </li>
          );
        })}
      </ol>

      {tasks.length > 0 && (
        <p className="text-muted-foreground text-[13px] leading-snug">
          {tasks.length === 1 ? "Next task due" : `Next ${tasks.length} due`}{" "}
          <span className="text-foreground">
            {andList(tasks.map((t) => midSentence(dayWordOfKey(t.dueKey, todayKey))))}
          </span>
          {best && firstDue && firstDue < best.key && ", before this block"}
        </p>
      )}

      <div className="mt-auto space-y-2">
        {block && (
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            disabled={pending}
            onClick={blockOff}
            title={`Block off ${blockWord}`}
          >
            Block off {blockHours(block.start, block.end)}
          </Button>
        )}
        {empty && (
          <Link
            href={data.availabilityHref}
            className="text-muted-foreground hover:text-foreground block text-[12.5px] underline underline-offset-4"
          >
            Add the hours you&apos;re never free
          </Link>
        )}
      </div>
    </div>
  );
}
