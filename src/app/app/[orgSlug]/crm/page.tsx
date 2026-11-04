import { Suspense } from "react";
import { CrmHeader } from "@/components/crm/chrome/crm-header";
import { CrmOverlays } from "@/components/crm/overlays/crm-overlays";
import { CrmSendingBanner } from "@/components/crm/settings/sending-paused";
import { CrmStartedSection } from "@/components/crm/today/crm-started-section";
import { TodayAside, TodayAsideSkeleton, type TodayAsideData } from "@/components/crm/today/today-aside";
import { TodayList } from "@/components/crm/today/today-list";
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
import { onItsOwn } from "@/server/crm/on-its-own";
import { loadSendingHealth } from "@/server/crm/sending-health";
import { loadCrmStarted } from "@/server/crm/started";
import { comingUp, TODAY_GROUPS, type TodayGroup } from "@/server/crm/today";
import { withOrgTx } from "@/server/db/context";

import { crmMemberNames, crmShell, crmTeam } from "./shell";
import { todayForShell, todayLog, todayScope } from "./today-data";

export const metadata = { title: "CRM" };

type Search = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

/**
 * The CRM's Today (docs/features/crm.md, "Redesign"): "Get your CRM started"
 * across the top until it's done, then who needs you and why, in one list grouped as Replies, Due today, To approve and Calls,
 * each row with at most two ambient buttons. Power hour works the list one
 * person at a time (?open=power). On the right: Goals, what's coming up,
 * and Done on its own (the latest few things the CRM did without asking,
 * See all opens ?open=log).
 * Yours first; your team's with ?who=team (someone with reports), everyone's
 * with ?who=all or when nothing is yours.
 */
export default async function CrmTodayPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/crm">) {
  const { orgSlug } = await params;
  const sp = (await searchParams) as Search;
  // An owner or admin arrives here before the CRM has its settings: the panel's
  // first step makes them, so there's nothing else to show yet and nothing is written here.
  const { gate, shell } = await crmShell(orgSlug, { setup: true });
  if (!shell) return gate;
  if (!shell.access.settings) {
    return (
      <div>
        <CrmHeader orgSlug={orgSlug} create={false} />
        {/* In a Suspense like the page below, so the first answer doesn't remount the strip. */}
        <Suspense fallback={null}>
          <CrmStartedSection shell={shell} orgSlug={orgSlug} />
        </Suspense>
      </div>
    );
  }
  const orgId = shell.org.id;
  // A Personal space is one person's: everything is theirs, so no Mine and Everyone's.
  const personal = shell.access.personal;
  const who = todayScope(one(sp.who));
  const everyone = personal || who === "all";
  const show = one(sp.show) as TodayGroup | undefined;
  const q = one(sp.q)?.toLowerCase();
  const now = new Date();

  // In parallel, each in its own transaction, and in the order they're
  // needed (the pool takes them first come, first served): the list (shared
  // with Power hour, todayForShell) and the card open over the page, which
  // the page waits for; then what streams in after it.
  const todayP = todayForShell(shell, who);
  const overlayP = CrmOverlays({ shell, orgSlug, searchParams: sp });
  // My team is offered only to someone with people under them, as in Tasks.
  const teamP = personal ? Promise.resolve([]) : crmTeam(orgId, shell.user.id);
  const viewerP = withOrgTx(orgId, async ({ db }) => {
    const me = await db.user.findUnique({
      where: { id: shell.user.id },
      select: { timezone: true },
    });
    const snooze = await db.inboxItemState.findFirst({
      where: {
        organizationId: orgId,
        userId: shell.user.id,
        itemKey: POWER_HOUR_KEY,
        snoozedUntil: { gt: now },
      },
      select: { snoozedUntil: true },
    });
    return { tz: effectiveTimezone(me, shell.org), snoozedUntil: snooze?.snoozedUntil ?? null };
  });
  // The rest start now rather than after the list, and arrive on their own.
  void loadCrmStarted({
    organizationId: orgId,
    userId: shell.user.id,
    access: shell.access,
  }).catch(() => null);
  void loadSendingHealth(orgId).catch(() => null);
  const asideP: Promise<TodayAsideData> = viewerP.then(async ({ tz }) => {
    const [side, upcoming] = await Promise.all([
      withOrgTx(orgId, async ({ db }) => ({
        goals: await listGoals(db, orgId, localDateKey(now, tz), { current: true, take: 4 }),
        log: await onItsOwn(db, orgId, { now, tz }),
      })),
      // Needs to know whether the list is yours.
      todayP.then((today) =>
        withOrgTx(orgId, ({ db }) =>
          comingUp(db, orgId, shell.user.id, { everyone: everyone || !today.mine, now }),
        ),
      ),
    ]);
    // Goals name their member only when one is set for someone.
    const names = side.goals.some((g) => g.ownerId) ? await crmMemberNames(orgId) : new Map<string, string>();
    return { tz, goals: side.goals, names, upcoming, log: todayLog(side.log, now, tz) };
  });
  // Read by TodayAside below; if the page fails first, nobody is left waiting on it.
  asideP.catch(() => null);
  const [today, viewer, overlay, team] = await Promise.all([todayP, viewerP, overlayP, teamP]);
  const data = { ...viewer, today };

  const rows = data.today.rows.filter(
    (r) =>
      (!show || r.group === show) &&
      (!q || r.name.toLowerCase().includes(q) || r.text.toLowerCase().includes(q)),
  );
  // Power hour: the people to reach, then drafts waiting for an OK, each person once.
  const powerIds = new Set(data.today.rows.flatMap((r) => (r.person ? [r.person.id] : [])));
  const powerRows = data.today.rows.filter((r) => r.person && powerIds.delete(r.person.id));
  const base = `/app/${orgSlug}/crm`;

  return (
    <div>
      <CrmHeader
        orgSlug={orgSlug}
        banner={
          <Suspense fallback={null}>
            <CrmSendingBanner orgId={orgId} orgSlug={orgSlug} />
          </Suspense>
        }
        toolbar={<TodayToolbar tabs={shell.tabs} personal={personal} hasTeam={team.length > 0} />}
      />
      <Suspense fallback={null}>
        <CrmStartedSection shell={shell} orgSlug={orgSlug} />
      </Suspense>
      {!personal && !data.today.mine && !everyone && (
        <p className="text-muted-foreground -mt-3 mb-5 text-sm">
          {who === "team"
            ? "Nothing for your team today, so this is everyone's."
            : "Nothing of yours today, so this is everyone's."}
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
          <Suspense fallback={<TodayAsideSkeleton />}>
            <TodayAside data={asideP} canEdit={shell.access.manager} base={base} sp={sp} now={now} />
          </Suspense>
        </aside>
      </div>
      {overlay}
    </div>
  );
}
