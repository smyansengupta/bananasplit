import { notFound } from "next/navigation";

import { BackLink } from "@/components/back-link";
import { CrmAvatar } from "@/components/crm/card/crm-card";
import { QuietButton } from "@/components/crm/reports/quiet-button";
import {
  choiceTone,
  Figure,
  HeatTable,
  MonthColumns,
  Progress,
  SERIES,
  StackBar,
} from "@/components/crm/reports/report-bits";
import { ChartColumn, Database } from "@/components/icons";
import { BarList } from "@/components/reports/bar-list";
import { RangePicker } from "@/components/reports/range-picker";
import { ReportCard, ReportEmpty } from "@/components/reports/report-card";
import { ReportsBody, ReportsFrame } from "@/components/reports/reports-frame";
import { InsightsCard, type CardLine } from "@/components/reports/saved/insights-card";
import { PageTabs } from "@/components/ui/page-tabs";
import {
  durationWords,
  heatGrid,
  monthLabel,
  parseReportPath,
  rangeWords,
  type CrmReportOn,
} from "@/lib/crm/crm-reports";
import { formatMoney } from "@/lib/crm/fields";
import { CRM_DB_KEYS } from "@/lib/crm/templates";
import { orgTimeZone } from "@/server/crm/forecast";
import {
  dealsFigure,
  dealsReport,
  outreachReport,
  peopleReport,
  type ReportCtx,
} from "@/server/crm/crm-reports";
import { defaultDealPipeline } from "@/server/crm/deals-tab";
import { resolveReportRange } from "@/server/reports/range";
import { withOrgTx } from "@/server/db/context";

import { crmShell } from "../../shell";

export const metadata = { title: "CRM reports" };

const SOURCES: Record<CrmReportOn, { title: string; back: string; backLabel: string }> = {
  deals: { title: "Deals", back: "/deals", backLabel: "Deals" },
  people: { title: "People", back: "/people", backLabel: "People" },
  outreach: { title: "Outreach", back: "/outreach", backLabel: "Outreach" },
};

/**
 * The CRM's reports (docs/features/crm.md, "Redesign"): Deals (one
 * pipeline, /crm/reports/deals/<id>), People and Outreach, over the range
 * the date pills pick, laid out like the app's report page: Insights on
 * top, then cards, each with ↗ to its rows and when it was worked out.
 */
export default async function CrmReportsPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/crm/reports/[[...on]]">) {
  const { orgSlug, on: segments } = await params;
  const sp = (await searchParams) as Record<string, string | string[] | undefined>;
  const { gate, shell } = await crmShell(orgSlug);
  if (!shell) return gate;
  const { on, pipelineId } = parseReportPath(segments);
  if (segments && segments.length > 0 && !["deals", "people", "outreach"].includes(segments[0]!)) notFound();
  const orgId = shell.org.id;
  const base = `/app/${orgSlug}/crm`;
  const pipeline =
    on === "deals"
      ? (shell.pipelines.find((p) => p.id === pipelineId) ?? defaultDealPipeline(shell.pipelines))
      : null;
  const names = new Map(shell.members.map((m) => [m.id, m.name]));
  const relationships = new Map((shell.access.settings?.relationshipTypes ?? []).map((t) => [t.id, t.label]));
  const now = new Date();

  const loaded = await withOrgTx(orgId, async ({ db }) => {
    const tz = await orgTimeZone(db, orgId);
    const range = resolveReportRange(sp, tz, now);
    const ctx: ReportCtx = {
      db,
      organizationId: orgId,
      slug: orgSlug,
      tz,
      range: { from: range.from, to: range.to },
      now,
      roles: shell.roles,
      names,
    };
    const dbKey =
      on === "deals" && pipeline?.databaseId
        ? ((await db.databaseDefinition.findFirst({
            where: { id: pipeline.databaseId, organizationId: orgId },
            select: { key: true },
          }))?.key ?? null)
        : on === "people"
          ? CRM_DB_KEYS.people
          : null;
    return {
      tz,
      range,
      dbKey,
      deals: on === "deals" && pipeline ? await dealsReport(ctx, pipeline) : null,
      people: on === "people" ? await peopleReport(ctx, relationships) : null,
      outreach: on === "outreach" ? await outreachReport(ctx) : null,
    };
  });
  const { tz, range } = loaded;
  const asOf = now.toISOString();
  const words = rangeWords(range.preset);
  const source = SOURCES[on];
  const sub =
    on === "deals"
      ? `From the ${pipeline?.name ?? "Deals"} database`
      : on === "people"
        ? "From the People database"
        : "From every outreach plan";
  const dealsHref = pipeline ? `${base}/deals?pipeline=${pipeline.id}` : `${base}/deals`;
  const reportBase = `${base}/reports`;

  const lines: CardLine[] = [];
  let lead: string | null = null;
  let body: React.ReactNode = null;

  if (on === "deals") {
    const r = loaded.deals;
    if (!r) {
      body = <ReportEmpty>No pipelines yet. Add one in CRM settings and its report shows here.</ReportEmpty>;
    } else {
      const fig = (cents: number, count: number) => dealsFigure(r, cents, count);
      const wonFig = fig(r.won.cents, r.won.count);
      if (r.won.goal) {
        const pct = `${Math.round(r.won.goal.share * 100)}%`;
        lead = `${pct} of the way to the ${formatMoney(r.won.goal.target)} goal${
          r.likelyCents > 0 ? `, with ${formatMoney(r.likelyCents)} more likely before it ends` : ""
        }.`;
      } else {
        lead = `${wonFig} won ${words.now}${
          r.won.previousCents !== null && words.before
            ? `, ${r.won.cents >= r.won.previousCents ? "up" : "down"} from ${fig(r.won.previousCents, 0)} ${words.before}`
            : ""
        }.`;
      }
      const late = r.late.map((d) => d.title);
      const noStep = r.noStep.map((d) => d.title);
      if (late.length || noStep.length) {
        const parts = [
          late.length ? `${late.join(" and ")} ${late.length === 1 ? "has" : "have"} waited past ${late.length === 1 ? "its" : "their"} next step` : null,
          noStep.length ? `${noStep.join(" and ")} ${noStep.length === 1 ? "has" : "have"} no next step` : null,
        ].filter(Boolean);
        lines.push({ text: `${parts.join(", and ")}.`, tone: "warn", label: "Open them", href: dealsHref });
      }
      if (r.open.count) {
        lines.push({
          text: `${r.open.withStep} of ${r.open.count} open deals have a next step with a date.`,
          tone: r.open.withStep === r.open.count ? "good" : "info",
          bold: `${r.open.withStep} of ${r.open.count}`,
        });
      }
      const diff = r.won.previousCents !== null ? r.won.cents - r.won.previousCents : null;
      body = (
        <>
          <ReportCard id="won" title="Won" description="Deals that reached Won" viewHref={`${dealsHref}&show=won`} viewLabel="See the rows" computedAt={asOf} tz={tz}>
            <Figure
              value={wonFig}
              detail={
                diff !== null && words.before && r.pipeline.hasAmount
                  ? `${diff >= 0 ? "+" : "-"}${formatMoney(Math.abs(diff))} on ${words.before}`
                  : `${r.won.count} ${r.won.count === 1 ? "deal" : "deals"}`
              }
            />
            {r.won.goal && <Progress share={r.won.goal.share} label={`${Math.round(r.won.goal.share * 100)}% of the goal`} />}
          </ReportCard>
          <ReportCard id="open" title="Still open" description="Not won or lost yet" viewHref={dealsHref} viewLabel="See the rows" computedAt={asOf} tz={tz}>
            <Figure value={fig(r.open.cents, r.open.count)} detail={r.pipeline.hasAmount ? `in ${r.open.count} ${r.open.count === 1 ? "deal" : "deals"}` : "deals"} />
            <p className="text-muted-foreground text-sm">
              {r.open.withStep} of {r.open.count} have a next step with a date.
            </p>
          </ReportCard>
          <ReportCard id="months" title="Won over time" description="By month" viewHref={`${dealsHref}&show=won`} viewLabel="See the rows" computedAt={asOf} tz={tz}>
            <MonthColumns
              label="Won by month"
              color="var(--chart-3)"
              items={r.months.map((m) => ({
                key: m.key,
                label: monthLabel(m.key),
                value: m.cents,
                display: m.cents ? formatMoney(m.cents).replace(/,000$/, "k").replace(/\.00$/, "") : "0",
              }))}
            />
          </ReportCard>
          <ReportCard id="stage" title="By stage" description="Where the money sits now" viewHref={`${dealsHref}&show=all`} viewLabel="See the rows" computedAt={asOf} tz={tz}>
            <BarList
              label="By stage"
              items={r.byStage.map((s) => ({
                key: s.id,
                label: s.name,
                value: r.pipeline.hasAmount ? s.cents : s.count,
                display: fig(s.cents, s.count),
                detail: `${s.count} ${s.count === 1 ? "deal" : "deals"}`,
              }))}
            />
          </ReportCard>
          <ReportCard id="owner" title="By owner" description={`Won ${words.now}`} viewHref={`${dealsHref}&show=won`} viewLabel="See the rows" computedAt={asOf} tz={tz}>
            {r.byOwner.length === 0 ? (
              <ReportEmpty>Nothing won {words.now} yet.</ReportEmpty>
            ) : (
              <BarList
                label="Won by owner"
                items={r.byOwner.map((o) => ({
                  key: o.name,
                  label: o.name,
                  value: r.pipeline.hasAmount ? o.cents : o.count,
                  display: fig(o.cents, o.count),
                }))}
              />
            )}
          </ReportCard>
          <ReportCard id="type" title="By type" description="Open and won deals" viewHref={`${dealsHref}&show=all`} viewLabel="See the rows" computedAt={asOf} tz={tz}>
            {r.byType.length === 0 ? (
              <ReportEmpty>No deals yet.</ReportEmpty>
            ) : (
              <StackBar
                label="Deals by type"
                items={r.byType.map((t, i) => ({
                  key: t.label,
                  label: t.label,
                  value: r.pipeline.hasAmount ? t.cents : t.count,
                  display: fig(t.cents, t.count),
                  color: t.color ? choiceTone(t.color) : SERIES[i % SERIES.length]!,
                }))}
              />
            )}
            {r.byType.length === 1 && r.byType[0]!.label === "No type" && (
              <p className="text-muted-foreground text-sm">Pick a type on a deal&apos;s Details to see them split here.</p>
            )}
          </ReportCard>
        </>
      );
    }
  } else if (on === "people") {
    const r = loaded.people!;
    const bestMonth = [...r.months].sort((a, b) => b.count - a.count)[0];
    lead = `${r.addedInRange} ${r.addedInRange === 1 ? "person" : "people"} joined People ${words.now}${
      bestMonth && bestMonth.count > 0 ? `, the most in ${monthLabel(bestMonth.key)} (${bestMonth.count})` : ""
    }.`;
    if (r.quiet.count) {
      lines.push({
        text: `${r.quiet.count} ${r.quiet.count === 1 ? "person has" : "people have"} gone 60 days or more without a touch.`,
        tone: "warn",
        bold: String(r.quiet.count),
        label: "Open them",
        href: `${base}/people`,
      });
    }
    if (r.everyoneHours !== null || r.fastest.length) {
      lines.push({
        text: r.fastest[0]
          ? `${r.fastest[0].name} writes back fastest, in about ${durationWords(r.fastest[0].hours)}.`
          : `People write back in about ${durationWords(r.everyoneHours!)}.`,
        tone: "info",
      });
    }
    const relItems = r.byRelationship.slice(0, 6).map((x, i) => ({
      key: x.label,
      label: x.label,
      value: x.count,
      display: x.count.toLocaleString("en-US"),
      color: x.label === "No relationship" ? "var(--muted-foreground)" : SERIES[i % SERIES.length]!,
    }));
    body = (
      <>
        <ReportCard id="new" title="New people by month" description="Added to People" viewHref={`${base}/people`} viewLabel="See the rows" computedAt={asOf} tz={tz}>
          <MonthColumns
            label="New people by month"
            color="var(--foreground)"
            items={r.months.map((m) => ({ key: m.key, label: monthLabel(m.key), value: m.count, display: String(m.count) }))}
          />
        </ReportCard>
        <ReportCard id="quiet" title="Going quiet" description="No touch in 60 days or more" viewHref={`${base}/people`} viewLabel="See the rows" computedAt={asOf} tz={tz}>
          <Figure value={r.quiet.count.toLocaleString("en-US")} detail={r.quiet.count === 1 ? "person" : "people"} />
          {r.quiet.people.length > 0 && (
            <ul className="divide-border/60 divide-y text-sm">
              {r.quiet.people.map((p) => (
                <li key={p.id} className="flex items-baseline gap-2 py-2">
                  <b className="min-w-0 flex-1 truncate">{p.name}</b>
                  <span className="text-muted-foreground shrink-0">
                    {[`${p.days} days`, p.relationship?.toLowerCase()].filter(Boolean).join(", ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <QuietButton orgId={orgId} ids={r.quiet.ids} />
        </ReportCard>
        <ReportCard id="relationship" title="By relationship" description="Everyone in People" viewHref={`${base}/people`} viewLabel="See the rows" computedAt={asOf} tz={tz}>
          <Figure value={r.total.toLocaleString("en-US")} detail="people" />
          <StackBar label="People by relationship" items={relItems} />
        </ReportCard>
        <ReportCard id="powner" title="By owner" description="People each member looks after" viewHref={`${base}/people`} viewLabel="See the rows" computedAt={asOf} tz={tz}>
          <BarList
            label="People by owner"
            items={r.byOwner.slice(0, 8).map((o) => ({ key: o.name, label: o.name, value: o.count, display: o.count.toLocaleString("en-US") }))}
          />
        </ReportCard>
        <ReportCard id="fastest" title="Who replies fastest" description="Typical time to reply to us" viewHref={`${base}/people`} viewLabel="See the rows" computedAt={asOf} tz={tz}>
          {r.fastest.length === 0 ? (
            <ReportEmpty>No replies to our email {words.now} yet.</ReportEmpty>
          ) : (
            <ul className="space-y-2.5">
              {r.fastest.map((f) => (
                <li key={f.id} className="flex items-center gap-3 text-sm">
                  <CrmAvatar name={f.name} size={30} />
                  <b className="min-w-0 truncate">{f.name}</b>
                  {f.relationship && <span className="text-muted-foreground truncate">{f.relationship}</span>}
                  <span className="ms-auto shrink-0 font-semibold tabular-nums">{durationWords(f.hours)}</span>
                </li>
              ))}
            </ul>
          )}
          {r.everyoneHours !== null && (
            <p className="text-muted-foreground text-sm">Everyone else: about {durationWords(r.everyoneHours)}.</p>
          )}
        </ReportCard>
      </>
    );
  } else {
    const r = loaded.outreach!;
    const grid = heatGrid(r.cells);
    const rate = r.replyRate?.value ?? null;
    const prevRate = r.replyRate?.previous ?? null;
    const pct = (n: number) => `${Math.round(n * 100)}%`;
    lead =
      rate !== null
        ? `${pct(rate)} of the people emailed replied ${words.now}${
            prevRate !== null ? `, ${rate >= prevRate ? "up" : "down"} from ${pct(prevRate)}` : ""
          }.${grid.best ? ` ${fullDay(grid.best.day)} ${grid.best.part.toLowerCase()}s do best.` : ""}`
        : `${r.sent.total} sent ${words.now}.`;
    if (r.unsubscribes.count && r.unsubscribes.byPlan[0]) {
      const top = r.unsubscribes.byPlan[0];
      lines.push({
        text: `${top.count} of the ${r.unsubscribes.count} unsubscribes came after ${top.name}.`,
        tone: "warn",
        bold: `${top.count} of the ${r.unsubscribes.count}`,
      });
    }
    if (r.sent.bounced) {
      lines.push({ text: `${r.sent.bounced} emails bounced. Check those addresses.`, tone: "warn", bold: String(r.sent.bounced) });
    }
    const diff = r.sent.previous !== null ? r.sent.total - r.sent.previous : null;
    const planMax = Math.max(0, ...r.byPlan.map((p) => p.replied));
    body = (
      <>
        <ReportCard id="sent" title="Sent" description="Emails and texts from every plan" viewHref={`${base}/outreach`} viewLabel="See the rows" computedAt={asOf} tz={tz}>
          <Figure
            value={r.sent.total.toLocaleString("en-US")}
            detail={diff !== null && words.before ? `${diff >= 0 ? "+" : ""}${diff} on ${words.before}` : undefined}
          />
          <p className="text-muted-foreground text-sm">
            {r.sent.emails} emails, {r.sent.texts} texts.{r.sent.bounced ? ` ${r.sent.bounced} bounced.` : ""}
          </p>
        </ReportCard>
        <ReportCard id="rate" title="Reply rate" description="People emailed who wrote back" viewHref={`${base}/outreach`} viewLabel="See the rows" computedAt={asOf} tz={tz}>
          {rate === null ? (
            <ReportEmpty>{r.replyRate?.empty ?? "Nobody was emailed in these dates yet."}</ReportEmpty>
          ) : (
            <>
              <Figure value={pct(rate)} detail={prevRate !== null ? `${rate >= prevRate ? "up" : "down"} from ${pct(prevRate)}` : undefined} />
              <Progress share={rate} label={`${pct(rate)} replied`} />
              <p className="text-muted-foreground text-sm">
                {r.replyRate?.caption}
                {r.emailRate !== null ? ` Emails answered: ${pct(r.emailRate)}.` : ""}
              </p>
            </>
          )}
        </ReportCard>
        <ReportCard id="plans" title="Replies by plan" description={words.now === "so far" ? "All time" : `Sent ${words.now}`} viewHref={`${base}/outreach`} viewLabel="See the rows" computedAt={asOf} tz={tz}>
          {r.byPlan.length === 0 ? (
            <ReportEmpty>No plan has sent anything {words.now} yet.</ReportEmpty>
          ) : (
            <BarList
              label="Replies by plan"
              max={planMax || undefined}
              items={r.byPlan.map((p) => ({
                key: p.name,
                label: p.name,
                value: p.replied,
                display: String(p.replied),
                detail: `${p.sent} sent`,
              }))}
            />
          )}
        </ReportCard>
        <ReportCard id="when" title="Best day and time to send" description="Reply rate by when it went out, your organization's time" computedAt={asOf} tz={tz}>
          <HeatTable grid={grid} />
          {grid.best ? (
            <p className="text-sm">
              <b>
                {fullDay(grid.best.day)}, {grid.best.part.toLowerCase()}:
              </b>{" "}
              <span className="text-muted-foreground">{pct(grid.best.rate)} reply.</span>
            </p>
          ) : (
            <p className="text-muted-foreground text-sm">Too few emails yet to say when works best.</p>
          )}
        </ReportCard>
        <ReportCard id="unsub" title="Unsubscribes" description="Asked not to be emailed" viewHref={`${base}/outreach`} viewLabel="See the rows" computedAt={asOf} tz={tz}>
          <Figure
            value={r.unsubscribes.count.toLocaleString("en-US")}
            detail={r.sent.emails ? `${((r.unsubscribes.count / r.sent.emails) * 100).toFixed(1)}% of sent` : undefined}
          />
          {r.unsubscribes.byPlan.length > 0 && (
            <ul className="divide-border/60 divide-y text-sm">
              {r.unsubscribes.byPlan.slice(0, 4).map((p) => (
                <li key={p.name} className="flex items-baseline gap-2 py-2">
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  <b className="tabular-nums">{p.count}</b>
                </li>
              ))}
            </ul>
          )}
        </ReportCard>
      </>
    );
  }

  const databasesHref = loaded.dbKey ? `/app/${orgSlug}/databases/${loaded.dbKey}` : `/app/${orgSlug}/databases`;
  const sourceTabs = (["deals", "people", "outreach"] as const).map((k) => ({
    href: k === "deals" ? `${reportBase}${pipeline ? `/deals/${pipeline.id}` : ""}` : `${reportBase}/${k}`,
    label: SOURCES[k].title,
    active: k === on,
  }));

  return (
    <ReportsFrame>
      <div className="space-y-7">
        <BackLink href={`${base}${source.back}`} label={source.backLabel} />
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <div className="mr-auto min-w-0">
            <h1 className="page-title">{on === "deals" && pipeline ? pipeline.name : source.title}</h1>
            <p className="text-muted-foreground mt-2 text-[15px]">{sub}</p>
          </div>
          <PageTabs label="Report on" tabs={sourceTabs} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PageTabs
            label="Databases sections"
            tabs={[
              { href: databasesHref, label: "Databases", icon: Database, active: false },
              { href: sourceTabs.find((t) => t.active)!.href, label: "Reports", icon: ChartColumn, active: true },
            ]}
          />
          <RangePicker preset={range.preset} from={range.from} to={range.to} label={range.label} span={range.span} />
        </div>
        <ReportsBody className="space-y-5">
          <InsightsCard subtitle="From this report's numbers" lead={lead} lines={lines} next={null} />
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{body}</div>
        </ReportsBody>
      </div>
    </ReportsFrame>
  );
}

function fullDay(short: string): string {
  return (
    { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday" } as Record<string, string>
  )[short] ?? short;
}
