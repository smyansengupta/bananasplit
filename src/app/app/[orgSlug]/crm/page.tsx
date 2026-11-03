import { AmbientButton, AmbientWhy } from "@/components/ambient/ambient-button";
import { CrmHeader } from "@/components/crm/chrome/crm-header";
import { CrmOverlays } from "@/components/crm/overlays/crm-overlays";
import { TodayList } from "@/components/crm/today/today-list";
import { TodayToolbar } from "@/components/crm/today/today-toolbar";
import { formatMoney } from "@/lib/crm/fields";
import { hrefWithOpen } from "@/lib/crm/overlay";
import { POWER_HOUR_KEY, powerHourBackLabel, powerHourMinutes } from "@/lib/crm/power-hour";
import { effectiveTimezone, localDateKey } from "@/lib/tasks/dates";
import { listGoals } from "@/server/crm/goals";
import { onItsOwn } from "@/server/crm/on-its-own";
import { comingUp, TODAY_GROUPS, todayRows, type TodayGroup } from "@/server/crm/today";
import { withOrgTx } from "@/server/db/context";

import { crmShell } from "./shell";

export const metadata = { title: "CRM" };

type Search = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

/**
 * The CRM's Today (docs/features/crm.md, "Redesign"): who needs you and
 * why, in one list grouped as Replies, Due today, To approve and Calls,
 * each row with at most two ambient buttons. Power hour works the list one
 * person at a time (?open=power); Done on its own lists what the CRM did
 * without asking (?open=log). Goals and what's coming up on the right.
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
  const everyone = one(sp.who) === "all";
  const show = one(sp.show) as TodayGroup | undefined;
  const q = one(sp.q)?.toLowerCase();
  const now = new Date();
  const relationships = new Map(
    (shell.access.settings?.relationshipTypes ?? []).map((t) => [t.id, t.label]),
  );

  const data = await withOrgTx(orgId, async ({ db }) => {
    const me = await db.user.findUnique({
      where: { id: shell.user.id },
      select: { timezone: true },
    });
    const tz = effectiveTimezone(me, shell.org);
    const today = await todayRows(db, orgId, shell.user.id, shell.roles, {
      everyone,
      relationships,
      now,
    });
    const goals = await listGoals(db, orgId, localDateKey(now, tz), { current: true, take: 4 });
    const upcoming = await comingUp(db, orgId, shell.user.id, {
      everyone: everyone || !today.mine,
      now,
    });
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
    return {
      tz,
      today,
      goals,
      upcoming,
      logCount: log.length,
      snoozedUntil: snooze?.snoozedUntil ?? null,
    };
  });

  const rows = data.today.rows.filter(
    (r) =>
      (!show || r.group === show) &&
      (!q || r.name.toLowerCase().includes(q) || r.text.toLowerCase().includes(q)),
  );
  const powerRows = data.today.rows.filter(
    (r) => (r.group === "replies" || r.group === "due" || r.group === "calls") && r.person,
  );
  const base = `/app/${orgSlug}/crm`;
  const names = new Map(shell.members.map((m) => [m.id, m.name]));

  return (
    <div>
      <CrmHeader
        orgSlug={orgSlug}
        settings={shell.access.manager}
        toolbar={<TodayToolbar tabs={shell.tabs} logCount={data.logCount} />}
      />
      {!data.today.mine && !everyone && (
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
          }}
        />
        <aside className="flex min-w-0 flex-col gap-4">
          {data.goals.length > 0 && (
            <section className="bg-card ring-foreground/6 space-y-4 rounded-[22px] p-5 ring-1">
              <h2 className="heading text-base">Goals this quarter</h2>
              {data.goals.map((g) => {
                const fmt = (n: number) =>
                  g.metric === "amount_won" ? formatMoney(n) : n.toLocaleString("en-US");
                const who = g.ownerId ? (names.get(g.ownerId) ?? "A member") : null;
                return (
                  <div key={g.id} className="space-y-1.5">
                    <div className="flex items-baseline gap-2 text-sm">
                      <span className="min-w-0 flex-1 truncate font-semibold">
                        {g.name || g.metricLabel}
                        {who && <span className="text-muted-foreground font-normal">, {who}</span>}
                      </span>
                      <span className="text-muted-foreground shrink-0 tabular-nums">
                        {fmt(g.attainment.actual)} of {fmt(g.target)}
                      </span>
                    </div>
                    <div className="bg-muted h-1.5 overflow-hidden rounded-full">
                      <div
                        className={
                          g.attainment.onTrack
                            ? "bg-foreground h-full rounded-full"
                            : "h-full rounded-full bg-(--attention)"
                        }
                        style={{ width: `${Math.min(100, Math.round(g.attainment.share * 100))}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </section>
          )}
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
                      ? `Starts in ${Math.round(mins / 60)} hours`
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
        </aside>
      </div>
      <CrmOverlays shell={shell} orgSlug={orgSlug} searchParams={sp} />
    </div>
  );
}
