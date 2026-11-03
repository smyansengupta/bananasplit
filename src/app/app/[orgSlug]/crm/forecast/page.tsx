import { ChartLine } from "@/components/icons";
import Link from "next/link";

import { CrmTabs } from "@/components/crm/crm-tabs";
import { ForecastCall, ForecastItems, ForecastStats, GoalList, SnapshotChart, type GoalRow } from "@/components/crm/forecast";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { safeTimeZone } from "@/lib/calendar/dates";
import { formatMoney, FORECAST_LABELS } from "@/lib/crm/fields";
import { crmRecordHref } from "@/lib/crm/href";
import { parsePeriodKey, periodOf, shiftPeriod, snapshotChanges, type Figures } from "@/lib/crm/forecast";
import { localDateKey } from "@/lib/tasks/dates";
import { pipelineForecast, snapshotsFor, takeSnapshot } from "@/server/crm/forecast";
import { listGoals } from "@/server/crm/goals";
import { withOrgTx } from "@/server/db/context";

import { crmShell } from "../shell";

export const metadata = { title: "Forecast" };

/**
 * The CRM's Forecast tab (docs/features/crm.md, module 8): per pipeline and
 * period (a quarter or a year), money and people, weighted, by category
 * and by trend; members mark their items, managers make their own call;
 * goals with attainment; and how the forecast moved, week by week.
 */
export default async function CrmForecastPage({ params, searchParams }: PageProps<"/app/[orgSlug]/crm/forecast">) {
  const { orgSlug } = await params;
  const sp = (await searchParams) as Record<string, string | undefined>;
  const { gate, shell } = await crmShell(orgSlug);
  if (!shell) return gate;
  const base = `/app/${orgSlug}/crm/forecast`;
  const pipelines = shell.pipelines;
  if (pipelines.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="Forecast" tabs={<CrmTabs tabs={shell.tabs} />} />
        <Card>
          <EmptyState icon={ChartLine} title="No pipelines yet" description="Add a pipeline in CRM settings and its forecast shows here." />
        </Card>
      </div>
    );
  }
  const pipeline = pipelines.find((p) => p.id === sp.pipeline) ?? pipelines[0]!;
  const tz = safeTimeZone(shell.org.timezone ?? "UTC");
  const today = localDateKey(new Date(), tz);
  const period = parsePeriodKey(sp.period) ?? periodOf("quarter", today);
  const mine = sp.who === "mine";
  const people = sp.as === "people" || !pipeline.hasAmount;
  const orgId = shell.org.id;
  const names = new Map(shell.members.map((m) => [m.id, m.name]));

  const data = await withOrgTx(orgId, async ({ db }) => {
    const f = await pipelineForecast(db, orgId, pipeline.id, period, today, mine ? shell.user.id : null);
    const deals = await db.crmDeal.findMany({
      where: { organizationId: orgId, id: { in: f.items.map((i) => i.id) } },
      select: { id: true, title: true, ownerId: true, stage: { select: { name: true } } },
    });
    let snaps = await snapshotsFor(db, orgId, pipeline.id, period);
    // The first visit to a current period takes its first snapshot, so the line has a start.
    if (snaps.length === 0 && today >= period.start && today <= period.end) {
      await takeSnapshot(db, orgId, pipeline.id, period, today);
      snaps = await snapshotsFor(db, orgId, pipeline.id, period);
    }
    const goals = (await listGoals(db, orgId, today, { take: 50 })).filter(
      (g) => g.periodStart <= period.end && g.periodEnd >= period.start && (!g.pipelineId || g.pipelineId === pipeline.id),
    );
    const changedIds = snaps.length >= 2 ? snapshotChanges(snaps[snaps.length - 2]!.data, snaps[snaps.length - 1]!.data) : null;
    const titles = changedIds
      ? await db.crmDeal.findMany({
          where: {
            organizationId: orgId,
            id: { in: [...changedIds.added, ...changedIds.removed, ...changedIds.category.map((c) => c.id), ...changedIds.amount.map((c) => c.id)] },
          },
          select: { id: true, title: true },
        })
      : [];
    return { f, deals, snaps, goals, changedIds, titles };
  });

  const { f } = data;
  const show = (x: Figures) => (people ? `${Math.round(x.count * 10) / 10}` : formatMoney(x.amount));
  const dealById = new Map(data.deals.map((d) => [d.id, d]));
  const titleOf = new Map(data.titles.map((t) => [t.id, t.title]));
  const href = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams();
    const next = { pipeline: pipeline.id, period: period.key, who: mine ? "mine" : null, as: sp.as ?? null, ...patch };
    for (const [k, v] of Object.entries(next)) if (v) q.set(k, v);
    return `${base}?${q.toString()}`;
  };
  const prev = shiftPeriod(period, -1);
  const next = shiftPeriod(period, 1);
  const noun = pipeline.itemNounPlural;
  const goalRows: GoalRow[] = data.goals.map((g) => {
    const money = g.metric === "amount_won";
    const fmt = (n: number) => (money ? formatMoney(n) : n.toLocaleString("en-US"));
    return {
      id: g.id,
      label: `${g.metricLabel}, ${g.ownerId ? (names.get(g.ownerId) ?? "a member") : "the team"}`,
      metric: g.metric,
      period: g.periodLabel,
      actual: fmt(g.attainment.actual),
      target: fmt(g.target),
      share: g.attainment.share,
      pace: g.attainment.pace,
      onTrack: g.attainment.onTrack,
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Forecast"
        description={`What's likely to come in from ${pipeline.name}, ${period.label}.`}
        tabs={<CrmTabs tabs={shell.tabs} />}
      />
      <div className="flex flex-wrap items-center gap-2">
        {pipelines.length > 1 && (
          <Segmented label="Pipeline" value={pipeline.id} options={pipelines.map((p) => ({ value: p.id, label: p.name, href: href({ pipeline: p.id }) }))} />
        )}
        <Segmented
          label="Period"
          value={period.kind}
          options={[
            { value: "quarter", label: "Quarter", href: href({ period: periodOf("quarter", period.kind === "year" ? (today.startsWith(period.key) ? today : period.start) : period.start).key }) },
            { value: "year", label: "Year", href: href({ period: periodOf("year", period.start).key }) },
          ]}
        />
        <span className="flex items-center gap-1">
          <Button variant="outline" size="sm" asChild>
            <Link href={href({ period: prev.key })} aria-label={`Back to ${prev.label}`}>
              {prev.label}
            </Link>
          </Button>
          <span className="px-2 text-sm font-semibold">{period.label}</span>
          <Button variant="outline" size="sm" asChild>
            <Link href={href({ period: next.key })} aria-label={`On to ${next.label}`}>
              {next.label}
            </Link>
          </Button>
        </span>
        {pipeline.hasAmount && (
          <Segmented
            label="Count"
            value={people ? "people" : "money"}
            options={[
              { value: "money", label: "Money", href: href({ as: null }) },
              { value: "people", label: pipeline.itemNounPlural.charAt(0).toUpperCase() + pipeline.itemNounPlural.slice(1), href: href({ as: "people" }) },
            ]}
          />
        )}
        <Segmented
          label="Whose"
          value={mine ? "mine" : "all"}
          options={[
            { value: "all", label: "Everyone's", href: href({ who: null }) },
            { value: "mine", label: "Mine", href: href({ who: "mine" }) },
          ]}
        />
      </div>

      <ForecastStats
        stats={[
          { key: "won", value: show(f.forecast.won), label: people ? `${noun.charAt(0).toUpperCase()}${noun.slice(1)} won` : "Won" },
          { key: "commit", value: show(f.forecast.commit), label: "Commit, with what's won" },
          { key: "best", value: show(f.forecast.bestCase), label: "Best case" },
          { key: "weighted", value: show(f.forecast.weighted), label: "Weighted by stage" },
          ...(f.trend.enough ? [{ key: "trend" as const, value: show(f.trend.expected), label: "Trend from your history" }] : []),
        ]}
      />
      <p className="text-muted-foreground text-sm">
        {show(f.forecast.pipeline)} in all open{people ? ` ${noun}` : ""} expected this period, with what&apos;s won.
        {f.forecast.undated > 0 && ` ${f.forecast.undated} open ${f.forecast.undated === 1 ? pipeline.itemNoun : noun} with no expected date counted here.`}{" "}
        {f.trend.enough
          ? f.trend.basis
          : `The trend shows once ${noun} have closed for a while (${f.trend.closed} in the four quarters before).`}
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="gap-3 p-5 sm:p-6">
          <h2 className="heading text-lg">By member</h2>
          {f.byOwner.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nothing open in this period.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground text-left text-xs">
                  <tr>
                    <th className="pb-2 font-medium">Member</th>
                    <th className="pb-2 text-right font-medium">Won</th>
                    <th className="pb-2 text-right font-medium">Commit</th>
                    <th className="pb-2 text-right font-medium">Best case</th>
                    <th className="pb-2 text-right font-medium">Pipeline</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {f.byOwner.map((o) => (
                    <tr key={o.ownerId ?? "none"} className="border-t">
                      <td className="py-2">{o.ownerId ? (names.get(o.ownerId) ?? "A former member") : "Nobody"}</td>
                      <td className="py-2 text-right">{people ? o.wonCount : formatMoney(o.won)}</td>
                      <td className="py-2 text-right">{people ? o.commitCount : formatMoney(o.commit)}</td>
                      <td className="py-2 text-right">{people ? o.bestCaseCount : formatMoney(o.bestCase)}</td>
                      <td className="py-2 text-right">{people ? o.pipelineCount : formatMoney(o.pipeline)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {shell.access.manager && !mine && (
            <div className="space-y-2 border-t pt-3">
              <h3 className="font-semibold">Your call</h3>
              <p className="text-muted-foreground text-sm">
                {f.call
                  ? `${f.call.amount ? `${formatMoney(f.call.amount)}, ` : ""}${f.call.count} ${noun}, set by ${names.get(f.call.by) ?? "a manager"}${f.call.note ? `: "${f.call.note}"` : "."}`
                  : "Put your own number over the roll-up when you know better."}
              </p>
              <ForecastCall
                orgId={orgId}
                pipelineId={pipeline.id}
                periodKey={period.key}
                hasAmount={pipeline.hasAmount}
                current={f.call ? { amount: f.call.amount, count: f.call.count, note: f.call.note, at: f.call.at.toISOString() } : null}
              />
            </div>
          )}
        </Card>

        <Card className="gap-3 p-5 sm:p-6">
          <h2 className="heading text-lg">Goals</h2>
          <GoalList
            orgId={orgId}
            goals={goalRows}
            manager={shell.access.manager}
            members={shell.members}
            pipelineId={pipeline.id}
            periods={[periodOf("quarter", today), periodOf("year", today), shiftPeriod(periodOf("quarter", today), 1)].map((p) => ({ key: p.key, label: p.label }))}
          />
        </Card>
      </div>

      <Card className="gap-3 p-5 sm:p-6">
        <h2 className="heading text-lg">Open {noun} this period</h2>
        <p className="text-muted-foreground text-sm">Mark each one: Commit if it will come in, Best case if it might.</p>
        <ForecastItems
          orgId={orgId}
          rows={f.items.slice(0, 200).map((i) => {
            const d = dealById.get(i.id);
            return {
              id: i.id,
              title: d?.title ?? "An item",
              href: crmRecordHref(orgSlug, "deal", i.id),
              stage: d?.stage.name ?? "",
              amount: i.amountCents ? formatMoney(i.amountCents) : null,
              expected: i.expectedOn,
              owner: i.ownerId ? (names.get(i.ownerId) ?? null) : null,
              category: i.category,
              canEdit: true,
            };
          })}
        />
      </Card>

      <Card className="gap-3 p-5 sm:p-6">
        <h2 className="heading text-lg">How the forecast moved</h2>
        <SnapshotChart
          money={!people}
          points={data.snaps.map((s) => ({
            at: s.at.toISOString(),
            won: people ? s.data.won.count : s.data.won.amount,
            weighted: people ? s.data.weighted.count : s.data.weighted.amount,
            commit: people ? s.data.commit.count : s.data.commit.amount,
            bestCase: people ? s.data.bestCase.count : s.data.bestCase.amount,
          }))}
        />
        {data.snaps.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted-foreground text-left text-xs">
                <tr>
                  <th className="pb-2 font-medium">Week of</th>
                  <th className="pb-2 text-right font-medium">Won</th>
                  <th className="pb-2 text-right font-medium">Commit</th>
                  <th className="pb-2 text-right font-medium">Best case</th>
                  <th className="pb-2 text-right font-medium">Weighted</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {data.snaps
                  .slice()
                  .reverse()
                  .slice(0, 13)
                  .map((s) => (
                    <tr key={s.id} className="border-t">
                      <td className="py-2">{s.at.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: tz })}</td>
                      <td className="py-2 text-right">{show(s.data.won)}</td>
                      <td className="py-2 text-right">{show(s.data.commit)}</td>
                      <td className="py-2 text-right">{show(s.data.bestCase)}</td>
                      <td className="py-2 text-right">{show(s.data.weighted)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
        {data.changedIds && (
          <div className="space-y-1 text-sm">
            <h3 className="font-semibold">Since the week before</h3>
            {data.changedIds.added.length + data.changedIds.removed.length + data.changedIds.category.length + data.changedIds.amount.length === 0 ? (
              <p className="text-muted-foreground">Nothing changed.</p>
            ) : (
              <ul className="text-muted-foreground list-disc space-y-0.5 ps-5">
                {data.changedIds.added.slice(0, 8).map((id) => (
                  <li key={`a${id}`}>{titleOf.get(id) ?? "An item"} came into the period.</li>
                ))}
                {data.changedIds.removed.slice(0, 8).map((id) => (
                  <li key={`r${id}`}>{titleOf.get(id) ?? "An item"} left it (closed, moved out, or left out).</li>
                ))}
                {data.changedIds.category.slice(0, 8).map((c) => (
                  <li key={`c${c.id}`}>
                    {titleOf.get(c.id) ?? "An item"} went from {FORECAST_LABELS[c.from]} to {FORECAST_LABELS[c.to]}.
                  </li>
                ))}
                {data.changedIds.amount.slice(0, 8).map((c) => (
                  <li key={`m${c.id}`}>
                    {titleOf.get(c.id) ?? "An item"} changed from {c.from ? formatMoney(c.from) : "no amount"} to {c.to ? formatMoney(c.to) : "no amount"}.
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
