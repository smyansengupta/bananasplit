"use client";

import { CirclePause, PencilLine, Send, ShieldCheck, Sparkles, type IconComponent } from "@/components/icons";
import Link from "next/link";

import { DayBars } from "@/components/ui/meters";
import { IconChip, Stat } from "@/components/ui/stat";
import { cn } from "@/lib/utils";
import type { OnItsOwnKind, OnItsOwnWeek } from "@/server/crm/on-its-own";

/**
 * Done on its own, on Today's right under Goals and Coming up: the week at
 * a glance (how much the CRM did for you, a small bar for each day) and the
 * latest few by kind (an email, a change, something it held back). See all
 * opens the full list with its Undo buttons (?open=log).
 */

export interface TodayLogEntry {
  id: string;
  kind: OnItsOwnKind;
  /** "2:14 PM", "Yesterday", "Oct 31". */
  when: string;
  text: string;
}

export const LOG_KINDS: Record<OnItsOwnKind, { icon: IconComponent; label: string }> = {
  sent: { icon: Send, label: "Email" },
  changed: { icon: PencilLine, label: "Change" },
  held: { icon: CirclePause, label: "Held back" },
};

/** The chip for one thing it did, by kind: held back wears the attention colour. */
export function LogKindChip({ kind }: { kind: OnItsOwnKind }) {
  return (
    <span role="img" aria-label={LOG_KINDS[kind].label} className="shrink-0">
      <IconChip
        icon={LOG_KINDS[kind].icon}
        className={cn(kind === "held" && "bg-[color-mix(in_oklab,var(--attention)_22%,var(--card))]")}
      />
    </span>
  );
}

/** The week's headline figure and its seven bars, on Today and in the full list. */
export function LogWeek({ week, height }: { week: OnItsOwnWeek; height?: number }) {
  const onlyHeld = week.done === 0;
  const thing = (n: number) => (n === 1 ? "thing" : "things");
  return (
    <div className="space-y-4">
      {onlyHeld ? (
        <Stat
          icon={ShieldCheck}
          value={week.held}
          label={`${thing(week.held)} held back for you this week`}
        />
      ) : (
        <Stat icon={Sparkles} value={week.done} label={`${thing(week.done)} done for you this week`} />
      )}
      <DayBars
        height={height}
        label={`${week.done} done and ${week.held} held back over the last seven days`}
        valueLabel="Done"
        extraLabel="Held back"
        days={week.days.map((d) => ({
          key: d.key,
          label: d.label,
          title: d.title,
          value: d.done,
          extra: d.held,
          current: d.today,
        }))}
      />
    </div>
  );
}

export function TodayLog({
  entries,
  week,
  seeAllHref,
  automationsHref,
}: {
  entries: readonly TodayLogEntry[];
  week: OnItsOwnWeek;
  seeAllHref: string;
  automationsHref: string;
}) {
  const quiet = week.done === 0 && week.held === 0;
  return (
    <section className="bg-card ring-foreground/6 space-y-4 rounded-[22px] p-5 ring-1">
      <div className="flex items-baseline gap-2">
        <h2 className="heading min-w-0 flex-1 text-base">Done on its own</h2>
        {!quiet && (
          <Link
            href={seeAllHref}
            scroll={false}
            className="text-muted-foreground hover:text-foreground focus-glow rounded-md text-sm font-medium outline-none"
          >
            See all
          </Link>
        )}
      </div>
      {quiet ? (
        <p className="text-muted-foreground text-sm">
          <Link
            href={automationsHref}
            className="text-foreground focus-glow rounded-sm font-medium underline underline-offset-3 outline-none"
          >
            Turn on an automation
          </Link>{" "}
          and its work adds up here.
        </p>
      ) : (
        <>
          <LogWeek week={week} />
          <ul className="space-y-3">
            {entries.map((e) => (
              <li key={e.id} className="flex items-start gap-3 text-sm">
                <LogKindChip kind={e.kind} />
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 leading-snug">{e.text}</span>
                  <span className="text-muted-foreground mt-0.5 block text-xs tabular-nums">
                    {e.when}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
