import { AmbientButton, AmbientWhy } from "@/components/ambient/ambient-button";
import { Skeleton } from "@/components/ui/skeleton";
import { hrefWithOpen } from "@/lib/crm/overlay";
import type { GoalView } from "@/server/crm/goals";
import type { OnItsOwnWeek } from "@/server/crm/on-its-own";
import type { comingUp } from "@/server/crm/today";

import { TodayGoals } from "./today-goals";
import { TodayLog, type TodayLogEntry } from "./today-log";

/**
 * Today's right column: Goals, Coming up and Done on its own. It loads
 * beside the list and arrives on its own, so the list never waits for it.
 */

export interface TodayAsideData {
  tz: string;
  goals: GoalView[];
  names: ReadonlyMap<string, string>;
  upcoming: Awaited<ReturnType<typeof comingUp>>;
  log: { entries: TodayLogEntry[]; week: OnItsOwnWeek };
}

export async function TodayAside({
  data,
  canEdit,
  base,
  sp,
  now,
}: {
  data: Promise<TodayAsideData>;
  canEdit: boolean;
  base: string;
  sp: Record<string, string | string[] | undefined>;
  now: Date;
}) {
  const { tz, goals, names, upcoming, log } = await data;
  return (
    <>
      <TodayGoals
        canEdit={canEdit}
        goals={goals.map((g) => ({
          id: g.id,
          name: g.name,
          metric: g.metric,
          metricLabel: g.metricLabel,
          who: g.ownerId ? (names.get(g.ownerId) ?? "A member") : null,
          actual: g.attainment.actual,
          target: g.target,
          share: g.attainment.share,
          pace: g.attainment.pace,
          onTrack: g.attainment.onTrack,
        }))}
      />
      {upcoming.length > 0 && (
        <section className="bg-card ring-foreground/6 space-y-4 rounded-[22px] p-5 ring-1">
          <h2 className="heading flex items-baseline gap-2 text-base">
            Coming up
            <span className="text-muted-foreground ms-auto text-sm font-normal">
              {upcoming[0]!.at.toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit",
                timeZone: tz,
              })}
            </span>
          </h2>
          {upcoming.map((m, i) => {
            const mins = Math.round((m.at.getTime() - now.getTime()) / 60_000);
            const soon =
              mins < 60
                ? `Starts in ${Math.max(1, mins)} min`
                : mins < 24 * 60
                  ? `Starts in ${Math.round(mins / 60)} ${Math.round(mins / 60) === 1 ? "hour" : "hours"}`
                  : m.at.toLocaleDateString("en-US", { weekday: "long", timeZone: tz });
            return (
              <div
                key={m.id}
                className={i > 0 ? "border-border/60 space-y-2 border-t pt-3" : "space-y-2"}
              >
                <div>
                  <b className="block text-[15px]">{m.subject}</b>
                  {m.personName && (
                    <span className="text-muted-foreground text-sm">
                      {[m.personName, ...m.lines].join(", ")}
                    </span>
                  )}
                </div>
                {m.personId && i === 0 && mins < 24 * 60 ? (
                  <div className="flex flex-nowrap items-center gap-2">
                    <AmbientButton
                      action={{
                        key: "brief",
                        label: "Open the brief",
                        tone: "solid",
                        reason: soon,
                        href: hrefWithOpen(base, sp, { kind: "person", id: m.personId }),
                      }}
                    />
                    <AmbientWhy className="min-w-0 truncate">{soon}</AmbientWhy>
                  </div>
                ) : (
                  <span className="text-muted-foreground text-xs">{soon}</span>
                )}
              </div>
            );
          })}
        </section>
      )}
      <TodayLog
        {...log}
        seeAllHref={hrefWithOpen(base, sp, "log")}
        automationsHref={`${base}/settings/automations`}
      />
    </>
  );
}

/** The column while it loads: Goals and Done on its own, their real titles over the shapes to come. */
export function TodayAsideSkeleton() {
  return (
    <>
      <section
        aria-busy="true"
        className="bg-card ring-foreground/6 space-y-3 rounded-[22px] p-5 ring-1"
      >
        <h2 className="heading text-base">Goals this quarter</h2>
        <div className="-mx-2 flex items-center gap-3.5 p-2">
          <Skeleton className="size-[76px] shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-3/4 rounded-full" />
            <Skeleton className="h-6 w-1/2 rounded-full" />
          </div>
        </div>
      </section>
      <section
        aria-busy="true"
        className="bg-card ring-foreground/6 space-y-4 rounded-[22px] p-5 ring-1"
      >
        <h2 className="heading text-base">Done on its own</h2>
        <Skeleton className="h-11 w-2/3 rounded-2xl" />
        <Skeleton className="h-14 w-full rounded-2xl" />
      </section>
    </>
  );
}
