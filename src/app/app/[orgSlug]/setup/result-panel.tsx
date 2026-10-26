import {
  ArrowRight,
  BarChart3,
  CalendarDays,
  Check,
  ClipboardCheck,
  FileSpreadsheet,
  PenLine,
  Users,
  Vote,
  type IconComponent,
} from "@/components/icons";
import Link from "next/link";

import { LazyAttendanceLineChart } from "@/components/reports/charts/lazy";
import { formatCount, formatDecimal, shortDate } from "@/components/reports/format";
import { Stat, StatRow } from "@/components/reports/stat";
import { PanelSection } from "@/components/setup/setup-ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { AttendanceReport } from "@/server/reports/types";
import { setupStep, type SetupStepId } from "@/server/setup/catalog";
import { countsSentence, totalRows, type DataSummary } from "@/server/setup/summary";

import { TestButton } from "./step-controls";
import { SyncWatcher } from "./sync-watcher";
import type { SetupStepView } from "./view";

/**
 * What a step looks like once it works: the thing it was for, already done.
 *
 * The rule for every one of these is the same — never hand back an empty
 * screen. The website step shows the rows that just arrived and links into
 * them; the calendar step says which calendar it will write to and offers
 * the import; the email step offers a test message; the Claude step points
 * at the importer the key exists for.
 */

/** The line that says it works: a filled circle (done) and the sentence. */
function Done({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2.5 text-sm font-semibold">
      <span
        aria-hidden="true"
        className="bg-block-goal text-block-goal-foreground grid size-6 shrink-0 place-items-center rounded-full"
      >
        <Check className="size-3.5" strokeWidth={3} />
      </span>
      <span>{children}</span>
    </p>
  );
}

/** One "now worth opening" destination. */
function Destination({
  href,
  icon: Icon,
  label,
  detail,
}: {
  href: string;
  icon: IconComponent;
  label: string;
  detail: string;
}) {
  return (
    <li>
      <Link
        href={href}
        className="group rounded-tile bg-muted/60 hover:bg-muted focus-visible:outline-foreground flex h-full items-center gap-3 p-3.5 transition-colors outline-none focus-visible:outline-2"
      >
        {/* The IconChip look (sm), drawn here: this panel renders on the server. */}
        <span className="bg-card ring-foreground/6 grid size-9 shrink-0 place-items-center rounded-full shadow-[var(--edge-highlight)] ring-1">
          <Icon className="size-[18px]" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{label}</span>
          <span className="text-muted-foreground mt-0.5 block text-[13px]">{detail}</span>
        </span>
        <ArrowRight
          className="text-muted-foreground size-4 shrink-0 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
          aria-hidden="true"
        />
      </Link>
    </li>
  );
}

function NextStepLink({ orgSlug, nextStep }: { orgSlug: string; nextStep: SetupStepId | null }) {
  const href = `/app/${orgSlug}/setup?step=${nextStep ?? "finish"}`;
  return (
    <Button asChild>
      <Link href={href}>
        {nextStep ? `Next: ${setupStep(nextStep).title}` : "Finish setup"}
        <ArrowRight data-icon="inline-end" aria-hidden="true" />
      </Link>
    </Button>
  );
}

// ---------------------------------------------------------------- Website data

function DataResult({
  orgId,
  orgSlug,
  summary,
  attendance,
  endpoint,
}: {
  orgId: string;
  orgSlug: string;
  summary: DataSummary;
  attendance: AttendanceReport | null;
  endpoint: string | null;
}) {
  const rows = totalRows(summary.counts);
  const { counts, links } = summary;
  const points = attendance?.sessions ?? [];

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Done>Connected to your website, read-only.</Done>
        {endpoint ? (
          <p className="text-muted-foreground pl-8.5 font-mono text-xs break-all">{endpoint}</p>
        ) : null}
      </div>

      {summary.syncing ? (
        <SyncWatcher orgId={orgId} startingRows={rows} />
      ) : rows === 0 ? (
        <div className="space-y-4">
          <div className="rounded-tile bg-muted/60 space-y-1.5 p-5">
            <p className="heading text-[15px]">
              The connection works, but there is nothing to pull yet.
            </p>
            <p className="text-muted-foreground text-sm">
              The export answered and reported zero sessions and zero check-ins. That is exactly
              what a brand-new club website looks like — rows will appear here by themselves after
              your first session. If you expected data, check that you applied{" "}
              <span className="font-mono">suite-export.sql</span> to the live project rather than a
              staging copy.
            </p>
          </div>
          <EmptyRoutes orgSlug={orgSlug} links={links} />
        </div>
      ) : (
        <>
          <p className="text-base">
            Your databases now hold <span className="font-semibold">{countsSentence(counts)}</span>.
          </p>

          <StatRow className="sm:grid-cols-4">
            <Stat
              label="Check-ins"
              value={formatCount(counts.checkIns)}
              href={links.attendance}
              detail="every scan and code"
            />
            <Stat
              label="Signups"
              value={formatCount(counts.signups)}
              href={links.signups}
              detail="interest forms"
            />
            <Stat
              label="Sessions"
              value={formatCount(counts.sessions)}
              href={links.sessions}
              detail="on the calendar"
            />
            <Stat
              label="People"
              value={formatCount(counts.people)}
              href={links.people}
              detail="who came at least once"
            />
          </StatRow>

          {points.length >= 2 ? (
            <section className="rounded-tile bg-muted/40 space-y-2 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h3 className="heading text-[15px]">Attendance over time</h3>
                <Link
                  href={`/app/${orgSlug}/databases/reports`}
                  className="text-muted-foreground hover:text-foreground text-[13px] font-medium underline-offset-4 hover:underline"
                >
                  All reports
                </Link>
              </div>
              <p className="text-muted-foreground text-[13px]">
                {formatCount(attendance?.totalCheckIns ?? 0)} check-ins across the{" "}
                {formatCount(attendance?.totalSessions ?? 0)} sessions that had any
                {attendance?.average === null || attendance?.average === undefined
                  ? ""
                  : `, ${formatDecimal(attendance.average)} on average`}
                {attendance?.peak
                  ? `. Best turnout: ${attendance.peak.title}, ${shortDate(attendance.peak.localDate)}`
                  : ""}
                .
              </p>
              <LazyAttendanceLineChart
                points={points.map((s) => ({
                  id: s.id,
                  title: s.title,
                  kind: s.kind,
                  localDate: s.localDate,
                  checkIns: s.checkIns,
                }))}
              />
            </section>
          ) : null}

          <PanelSection title="Now worth opening">
            <ul className="grid gap-2 sm:grid-cols-2">
              {links.attendance ? (
                <Destination
                  href={links.attendance}
                  icon={ClipboardCheck}
                  label="Attendance"
                  detail={`${formatCount(counts.checkIns)} check-ins, filterable and exportable`}
                />
              ) : null}
              {links.people ? (
                <Destination
                  href={links.people}
                  icon={Users}
                  label="People"
                  detail="Sessions, stamps and who has stopped coming"
                />
              ) : null}
              <Destination
                href={`/app/${orgSlug}/databases/reports`}
                icon={BarChart3}
                label="Reports"
                detail="Attendance, retention, signups and stamp cards"
              />
              {counts.ballots > 0 && links.ballots ? (
                <Destination
                  href={links.ballots}
                  icon={Vote}
                  label="Ballots"
                  detail={`${formatCount(counts.ballots)} imported. Add a poll definition for real labels`}
                />
              ) : null}
            </ul>
          </PanelSection>
        </>
      )}

      <div className="flex flex-wrap items-center gap-3 pt-2">
        <NextStepLink orgSlug={orgSlug} nextStep="calendar" />
        <TestButton orgId={orgId} step="data" label="Test again" variant="ghost" />
        <Link
          href={`/app/${orgSlug}/setup/status`}
          className="text-muted-foreground hover:text-foreground focus-glow ml-auto rounded-full text-[13px] font-medium underline-offset-4 hover:underline"
        >
          Connection status
        </Link>
      </div>
    </div>
  );
}

/** The routes that keep a dataless org out of a dead end. */
export function EmptyRoutes({ orgSlug, links }: { orgSlug: string; links: DataSummary["links"] }) {
  return (
    <PanelSection title="Get data in another way">
      <ul className="grid gap-2 sm:grid-cols-2">
        {links.attendance ? (
          <Destination
            href={`${links.attendance}/import`}
            icon={FileSpreadsheet}
            label="Import a CSV"
            detail="Up to 5,000 rows, previewed before anything is saved"
          />
        ) : null}
        {links.sessions ? (
          <Destination
            href={links.sessions}
            icon={PenLine}
            label="Add rows by hand"
            detail="New session, then Add check-in on that session"
          />
        ) : null}
        <Destination
          href={`/app/${orgSlug}/calendar`}
          icon={CalendarDays}
          label="Schedule a session"
          detail="Sessions and calendar events are the same records"
        />
      </ul>
    </PanelSection>
  );
}

// ---------------------------------------------------------------- Calendar

function CalendarResult({
  orgId,
  orgSlug,
  view,
}: {
  orgId: string;
  orgSlug: string;
  view: SetupStepView;
}) {
  const calendars = (Array.isArray(view.config.calendars) ? view.config.calendars : []) as {
    id: string;
    summary: string;
  }[];
  const nameOf = (id: unknown) =>
    typeof id === "string" && id ? (calendars.find((c) => c.id === id)?.summary ?? id) : null;
  const publicName = nameOf(view.config.publicCalendarId);
  const internalName = nameOf(view.config.internalCalendarId);
  const account = typeof view.config.accountEmail === "string" ? view.config.accountEmail : null;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Done>Google Calendar is connected{account ? ` as ${account}` : ""}.</Done>
      </div>
      <dl className="rounded-tile bg-muted/60 grid gap-x-6 gap-y-2 p-4 text-sm sm:grid-cols-[11rem_1fr]">
        <dt className="text-muted-foreground">Public events go to</dt>
        <dd>{publicName ?? "Nowhere — pick a calendar below"}</dd>
        <dt className="text-muted-foreground">Internal events go to</dt>
        <dd>{internalName ?? "Nowhere. They stay in the portal only."}</dd>
      </dl>
      <p className="text-muted-foreground text-sm">
        From now on, a session you create here appears on that calendar within a minute. The portal
        only changes the events it mirrors, and reads other events only if you run the import from
        the public calendar.
      </p>
      <PanelSection title="Now worth opening">
        <ul className="grid gap-2 sm:grid-cols-2">
          <Destination
            href={`/app/${orgSlug}/calendar`}
            icon={CalendarDays}
            label="Calendar"
            detail="Schedule a session and watch it appear in Google"
          />
          <Destination
            href={`/app/${orgSlug}/settings/integrations/google-calendar`}
            icon={ArrowRight}
            label="Import existing events"
            detail="A dry run first; nothing is written until you apply it"
          />
        </ul>
      </PanelSection>
      <div className="flex flex-wrap items-center gap-3 pt-2">
        <NextStepLink orgSlug={orgSlug} nextStep="claude" />
        <TestButton
          orgId={orgId}
          step="calendar"
          label="Test and refresh calendars"
          variant="ghost"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Email

function ClaudeResult({
  orgId,
  orgSlug,
  view,
}: {
  orgId: string;
  orgSlug: string;
  view: SetupStepView;
}) {
  const model = typeof view.config.model === "string" ? view.config.model : "the default model";
  return (
    <div className="space-y-6">
      <Done>The key works and can use {model}.</Done>
      <p className="text-muted-foreground text-sm">
        Nothing has been billed yet, and nothing will be until someone uploads an org chart. Each
        upload is one API call on your club&apos;s own workspace.
      </p>
      <PanelSection title="Now worth opening">
        <ul className="grid gap-2 sm:grid-cols-2">
          <Destination
            href={`/app/${orgSlug}/org-chart`}
            icon={Users}
            label="Org chart"
            detail="Upload last year's chart and let it be read for you"
          />
        </ul>
      </PanelSection>
      <div className="flex flex-wrap items-center gap-3 pt-2">
        <NextStepLink orgSlug={orgSlug} nextStep={null} />
        <TestButton orgId={orgId} step="claude" label="Test again" variant="ghost" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Switch

export function ResultPanel({
  orgId,
  orgSlug,
  view,
  summary,
  attendance,
  editHref,
}: {
  orgId: string;
  orgSlug: string;
  view: SetupStepView;
  summary: DataSummary;
  attendance: AttendanceReport | null;
  editHref: string;
}) {
  const step = setupStep(view.id);
  return (
    <Card className="animate-in fade-in slide-in-from-bottom-2 duration-500 ease-out motion-reduce:animate-none max-sm:[--card-spacing:--spacing(4.5)]">
      <CardContent className="space-y-7">
        <header className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className="display-title text-2xl">{step.title}</h2>
            <Link
              href={editHref}
              className="text-muted-foreground hover:text-foreground focus-glow rounded-full text-[13px] font-medium underline-offset-4 hover:underline"
            >
              Change the credential
            </Link>
          </div>
        </header>
        {view.id === "data" ? (
          <DataResult
            orgId={orgId}
            orgSlug={orgSlug}
            summary={summary}
            attendance={attendance}
            endpoint={summary.sync?.endpoint ?? null}
          />
        ) : null}
        {view.id === "calendar" ? (
          <CalendarResult orgId={orgId} orgSlug={orgSlug} view={view} />
        ) : null}
        {view.id === "claude" ? <ClaudeResult orgId={orgId} orgSlug={orgSlug} view={view} /> : null}
      </CardContent>
    </Card>
  );
}
