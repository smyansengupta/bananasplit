import { AmbientButton, AmbientWhy } from "@/components/ambient/ambient-button";
import { CrmHeader } from "@/components/crm/chrome/crm-header";
import { CrmOverlays } from "@/components/crm/overlays/crm-overlays";
import { TodayGoals } from "@/components/crm/today/today-goals";
import { TodayList } from "@/components/crm/today/today-list";
import { TodayLog } from "@/components/crm/today/today-log";
import { TodayToolbar } from "@/components/crm/today/today-toolbar";
import { hrefWithOpen } from "@/lib/crm/overlay";
import {
  POWER_HOUR_KEY,
  powerHourBackLabel,
  powerHourMinutes,
  powerHourSnoozeUntil,
} from "@/lib/crm/power-hour";
import { effectiveTimezone, localDateKey } from "@/lib/tasks/dates";
import { listGoals } from "@/server/crm/goals";
import { dayLabel, onItsOwn } from "@/server/crm/on-its-own";
import { comingUp, TODAY_GROUPS, type TodayGroup } from "@/server/crm/today";
import { withOrgTx } from "@/server/db/context";

import { crmMemberNames, crmShell } from "./shell";
import { todayForShell } from "./today-data";

export const metadata = { title: "CRM" };

type Search = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

/**
 * The CRM's Today (docs/features/crm.md, "Redesign"): who needs you and
 * why, in one list grouped as Replies, Due today, To approve and Calls,
 * each row with at most two ambient buttons. Power hour works the list one
 * person at a time (?open=power). On the right: Goals, what's coming up,
 * and Done on its own (the latest few things the CRM did without asking,
 * See all opens ?open=log).
 * Yours first; everyone's with ?who=all or when nothing is yours.
 */
export default async function CrmTodayPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/crm">) {
  const { orgSlug } = await params;
  const sp = (await searchParams) as Search;
  const { gate, shell } = await crmShell(orgSlug);
  if (!shell) return gate;
  const orgId = shell.org.id;
  // A Personal space is one person's: everything is theirs, so no Mine and Everyone's.
  const personal = shell.access.personal;
  const everyone = personal || one(sp.who) === "all";
  const show = one(sp.show) as TodayGroup | undefined;
  const q = one(sp.q)?.toLowerCase();
  const now = new Date();

  // In parallel, each in its own transaction: the list (shared with Power
  // hour, todayForShell), the right column, what's coming up (which needs
  // to know whether the list is yours) and the card open over the page.
  const todayP = todayForShell(shell, one(sp.who) === "all");
  const sideP = withOrgTx(orgId, async ({ db }) => {
    const me = await db.user.findUnique({
      where: { id: shell.user.id },
      select: { timezone: true },
    });
    const tz = effectiveTimezone(me, shell.org);
    const goals = await listGoals(db, orgId, localDateKey(now, tz), { current: true, take: 4 });
    const log = await onItsOwn(db, orgId, { now, tz });
    const snooze = await db.inboxItemState.findFirst({
      where: {
        organizationId: orgId,
        userId: shell.user.id,
        itemKey: POWER_HOUR_KEY,
        snoozedUntil: { gt: now },
      },
      select: { snoozedUntil: true },
    });
    return { tz, goals, log, snoozedUntil: snooze?.snoozedUntil ?? null };
  });
  const upcomingP = todayP.then((today) =>
    withOrgTx(orgId, ({ db }) =>
      comingUp(db, orgId, shell.user.id, { everyone: everyone || !today.mine, now }),
    ),
  );
  const [today, side, upcoming, overlay] = await Promise.all([
    todayP,
    sideP,
    upcomingP,
    CrmOverlays({ shell, orgSlug, searchParams: sp }),
  ]);
  // Goals name their member only when one is set for someone.
  const names = side.goals.some((g) => g.ownerId) ? await crmMemberNames(orgId) : new Map<string, string>();
  const data = { ...side, today, upcoming };

  const rows = data.today.rows.filter(
    (r) =>
      (!show || r.group === show) &&
      (!q || r.name.toLowerCase().includes(q) || r.text.toLowerCase().includes(q)),
  );
  // Power hour: the people to reach, then drafts waiting for an OK, each person once.
  const powerIds = new Set(data.today.rows.flatMap((r) => (r.person ? [r.person.id] : [])));
  const powerRows = data.today.rows.filter((r) => r.person && powerIds.delete(r.person.id));
  const base = `/app/${orgSlug}/crm`;
  // Done on its own, under Goals and Coming up: the latest five, with when.
  const logEntries = data.log.slice(0, 5).map((e) => {
    const day = dayLabel(e.at, now, data.tz);
    return {
      id: e.id,
      when:
        day === "Today"
          ? e.at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: data.tz })
          : day,
      text: e.text,
      held: e.kind === "held",
    };
  });

  return (
    <div>
      <CrmHeader
        orgSlug={orgSlug}
        toolbar={<TodayToolbar tabs={shell.tabs} personal={personal} />}
      />
      {!personal && !data.today.mine && !everyone && (
        <p className="text-muted-foreground -mt-3 mb-5 text-sm">
          Nothing of yours today, so this is everyone&apos;s.
        </p>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <TodayList
          orgId={orgId}
          groups={TODAY_GROUPS}
          rows={rows}
          power={{
            people: powerRows.length,
            minutes: powerHourMinutes(powerRows.length),
            drafts: powerRows.filter((r) => r.draft).length,
            snoozed: data.snoozedUntil ? powerHourBackLabel(data.snoozedUntil, now, data.tz) : null,
            snoozeWhy: powerHourBackLabel(powerHourSnoozeUntil(now, data.tz), now, data.tz).replace(
              /^Power hour is back/,
              "Snooze brings it back",
            ),
          }}
          hidden={{
            count: data.today.rows.length,
            clearHref: hrefWithOpen(base, { ...sp, show: undefined, q: undefined }, null),
          }}
        />
        <aside className="flex min-w-0 flex-col gap-4">
          <TodayGoals
            canEdit={shell.access.manager}
            goals={data.goals.map((g) => ({
              id: g.id,
              name: g.name,
              metric: g.metric,
              metricLabel: g.metricLabel,
              who: g.ownerId ? (names.get(g.ownerId) ?? "A member") : null,
              actual: g.attainment.actual,
              target: g.target,
              share: g.attainment.share,
              onTrack: g.attainment.onTrack,
            }))}
          />
          {data.upcoming.length > 0 && (
            <section className="bg-card ring-foreground/6 space-y-4 rounded-[22px] p-5 ring-1">
              <h2 className="heading flex items-baseline gap-2 text-base">
                Coming up
                <span className="text-muted-foreground ms-auto text-sm font-normal">
                  {data.upcoming[0]!.at.toLocaleTimeString("en-US", {
                    hour: "numeric",
                    minute: "2-digit",
                    timeZone: data.tz,
                  })}
                </span>
              </h2>
              {data.upcoming.map((m, i) => {
                const mins = Math.round((m.at.getTime() - now.getTime()) / 60_000);
                const soon =
                  mins < 60
                    ? `Starts in ${Math.max(1, mins)} min`
                    : mins < 24 * 60
                      ? `Starts in ${Math.round(mins / 60)} ${Math.round(mins / 60) === 1 ? "hour" : "hours"}`
                      : m.at.toLocaleDateString("en-US", { weekday: "long", timeZone: data.tz });
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
          <TodayLog entries={logEntries} total={data.log.length} seeAllHref={hrefWithOpen(base, sp, "log")} />
        </aside>
      </div>
      {overlay}
    </div>
  );
}
