import { ArrowRight, Check } from "@/components/icons";
import Link from "next/link";

import { PanelSection } from "@/components/setup/setup-ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { setupStep } from "@/server/setup/catalog";
import { totalRows, type DataSummary } from "@/server/setup/summary";

import { EmptyRoutes } from "./result-panel";
import { FinishButton } from "./step-controls";
import type { SetupProgressView } from "./view";

/**
 * The end of the flow — including for a club that connected nothing.
 *
 * Nobody is left at a door marked "connect Supabase": a club with no
 * website gets the two routes that do not need one (CSV import and typing
 * rows in), and the databases and reports behind them. The summary is the
 * truth, not a congratulation: skipped is listed as skipped.
 */
export function FinishPanel({
  orgId,
  orgSlug,
  orgName,
  progress,
  summary,
}: {
  orgId: string;
  orgSlug: string;
  orgName: string;
  progress: SetupProgressView;
  summary: DataSummary;
}) {
  const rows = totalRows(summary.counts);
  const connected = progress.steps.filter((s) => s.status === "connected");
  const outstanding = progress.steps.filter((s) => s.status !== "connected");
  const everything = outstanding.length === 0;

  return (
    <Card className="max-sm:[--card-spacing:--spacing(4.5)]">
      <CardContent className="space-y-7">
        <header className="space-y-2">
          <h2 className="display-title text-2xl">
            {everything
              ? `${orgName} is fully connected.`
              : connected.length > 0
                ? `${connected.length} of ${progress.totalCount} connected.`
                : "Nothing connected yet — and that is still workable."}
          </h2>
          <p className="text-muted-foreground text-sm">
            {everything
              ? "Every service is live and tested. The connection status page is where to look if one of them starts failing."
              : "Nothing here expires. Come back to any step whenever the credential turns up."}
          </p>
        </header>

        <PanelSection title="Where each one stands">
          <ul className="divide-border/70 divide-y">
            {progress.steps.map((view, i) => {
              const step = setupStep(view.id);
              const ok = view.status === "connected";
              return (
                <li key={view.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  {/* Filled circle: done; the step's number while it isn't. */}
                  {ok ? (
                    <span className="bg-block-goal text-block-goal-foreground grid size-7 shrink-0 place-items-center rounded-full">
                      <Check className="size-4" aria-hidden="true" strokeWidth={2.75} />
                      <span className="sr-only">Connected:</span>
                    </span>
                  ) : (
                    <span className="bg-muted text-muted-foreground grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold tabular-nums">
                      {i + 1}
                      <span className="sr-only">Not connected:</span>
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{step.title}</span>
                    <span className="text-muted-foreground mt-0.5 block text-[13px]">
                      {ok ? step.summary : step.ifSkipped}
                    </span>
                  </span>
                  {ok ? null : (
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/app/${orgSlug}/setup?step=${view.id}`}>Set up</Link>
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </PanelSection>

        {rows === 0 ? (
          <div className="space-y-4">
            <div className="rounded-tile bg-muted/60 space-y-1.5 p-5">
              <p className="heading text-[15px]">Your databases are still empty.</p>
              <p className="text-muted-foreground text-sm">
                Attendance, Signups and the reports built on them need rows before they say
                anything. A website is the hands-off way to fill them, but it is not the only way —
                the routes below need no integration at all, and the rows you put in behave exactly
                like synced ones.
              </p>
            </div>
            <EmptyRoutes orgSlug={orgSlug} links={summary.links} />
          </div>
        ) : (
          <PanelSection title="Go and use it">
            <ul className="grid gap-2 sm:grid-cols-2">
              {summary.links.attendance ? (
                <li>
                  <Link
                    href={summary.links.attendance}
                    className="group rounded-tile bg-muted/60 hover:bg-muted focus-visible:outline-foreground flex h-full items-center gap-3 p-3.5 transition-colors outline-none focus-visible:outline-2"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">Databases</span>
                      <span className="text-muted-foreground mt-0.5 block text-[13px]">
                        {rows.toLocaleString()} rows across sessions, check-ins, signups and people
                      </span>
                    </span>
                    <ArrowRight
                      className="text-muted-foreground size-4 shrink-0 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
                      aria-hidden="true"
                    />
                  </Link>
                </li>
              ) : null}
              <li>
                <Link
                  href={`/app/${orgSlug}/databases/reports`}
                  className="group rounded-tile bg-muted/60 hover:bg-muted focus-visible:outline-foreground flex h-full items-center gap-3 p-3.5 transition-colors outline-none focus-visible:outline-2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">Reports</span>
                    <span className="text-muted-foreground mt-0.5 block text-[13px]">
                      Attendance, retention, signups and stamp cards
                    </span>
                  </span>
                  <ArrowRight
                    className="text-muted-foreground size-4 shrink-0 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
                    aria-hidden="true"
                  />
                </Link>
              </li>
            </ul>
          </PanelSection>
        )}

        <footer className="flex flex-wrap items-center gap-3 pt-2">
          <FinishButton orgId={orgId} orgSlug={orgSlug} done={Boolean(progress.completedAt)} />
          <Button asChild variant="outline">
            <Link href={`/app/${orgSlug}/setup/status`}>Connection status</Link>
          </Button>
          <p className="text-muted-foreground min-w-0 flex-1 basis-56 text-[13px]">
            {progress.completedAt
              ? "Setup is closed. Nothing has been deleted; reopen it to bring back the prompt on the overview."
              : "Closing setup only hides the prompt on the overview. Every step stays here."}
          </p>
        </footer>
      </CardContent>
    </Card>
  );
}
