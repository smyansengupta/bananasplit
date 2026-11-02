"use client";

import { Clock } from "@/components/icons";
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

import { Insight, LinkChips } from "./connections";

/**
 * Focus time (the Personal home's card): the viewer's longest free
 * stretch in the next seven days, the free hours of each day as a strip,
 * and the next tasks they have due (src/server/overview/focus-time.ts).
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
    <div className="space-y-3">
      <div>
        <p className="heading text-2xl leading-tight tracking-tight">
          {best
            ? `${dayWordOfKey(best.key, todayKey)}, ${blockHours(best.start, best.end)}`
            : "No free hours"}
        </p>
        <p className="text-muted-foreground mt-1 text-[13px]">
          {best
            ? `Your longest free block this week, ${hoursWord(best.end - best.start)}`
            : "Your next seven days are full."}
        </p>
      </div>

      <ol className="grid grid-cols-7 gap-1.5" aria-label="Free hours each day">
        {week.days.map((d) => {
          const isBest = best?.key === d.key;
          return (
            <li
              key={d.key}
              className="flex min-w-0 flex-col items-center gap-1.5"
              aria-label={`${dayWordOfKey(d.key, todayKey)}: ${hoursWord(d.free)} free`}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "block h-8 w-full rounded-[8px]",
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
                  "text-[11.5px] font-semibold",
                  isBest ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {d.letter}
              </span>
            </li>
          );
        })}
      </ol>

      {block && (
        <Button className="w-full" disabled={pending} onClick={blockOff}>
          Block off {blockWord}
        </Button>
      )}

      {tasks.length > 0 && (
        <div className="space-y-2">
          <Insight tone="good" icon={Clock}>
            Your next {tasks.length === 1 ? "task is" : `${tasks.length} tasks are`} due{" "}
            <b>{andList(tasks.map((t) => midSentence(dayWordOfKey(t.dueKey, todayKey))))}</b>.
            {best && firstDue && firstDue < best.key && " The first is due before this block."}
          </Insight>
          <LinkChips items={data.links} />
        </div>
      )}

      {empty && (
        <p className="text-muted-foreground text-[13px]">
          From your calendar only.{" "}
          <Link
            href={data.availabilityHref}
            className="text-foreground font-semibold underline underline-offset-4"
          >
            Add the hours you&apos;re never free
          </Link>
        </p>
      )}
    </div>
  );
}
