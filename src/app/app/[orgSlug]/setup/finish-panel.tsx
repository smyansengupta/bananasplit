import { ArrowRight, Check, CircleDashed } from "lucide-react";
import Link from "next/link";

import { PanelSection } from "@/components/setup/setup-ui";
import { Button } from "@/components/ui/button";
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
    <div className="space-y-8">
      <header className="space-y-2">
        <h2 className="text-xl font-semibold tracking-tight">
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
        <ul className="divide-y rounded-lg border">
          {progress.steps.map((view) => {
            const step = setupStep(view.id);
            const ok = view.status === "connected";
            return (
              <li key={view.id} className="flex items-center gap-3 p-3">
                {ok ? (
                  <Check
                    className="text-success size-4 shrink-0"
                    aria-hidden="true"
                    strokeWidth={3}
                  />
                ) : (
                  <CircleDashed
                    className="text-muted-foreground size-4 shrink-0"
                    aria-hidden="true"
                  />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{step.title}</span>
                  <span className="text-muted-foreground block text-xs">
                    {ok ? step.summary : step.ifSkipped}
                  </span>
                </span>
                {ok ? null : (
                  <Link
                    href={`/app/${orgSlug}/setup?step=${view.id}`}
                    className="text-xs whitespace-nowrap underline underline-offset-4"
                  >
                    Set up
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </PanelSection>

      {rows === 0 ? (
        <div className="space-y-4">
          <div className="space-y-2 rounded-lg border border-dashed p-5">
            <p className="text-sm font-medium">Your databases are still empty.</p>
            <p className="text-muted-foreground text-sm">
              Attendance, Signups and the reports built on them need rows before they say anything.
              A club website is the hands-off way to fill them, but it is not the only way — the
              routes below need no integration at all, and the rows you put in behave exactly like
              synced ones.
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
                  className="hover:bg-muted/60 focus-visible:ring-ring group flex items-center gap-3 rounded-lg border p-3 transition-colors focus-visible:ring-2 focus-visible:outline-none"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">Databases</span>
                    <span className="text-muted-foreground block text-xs">
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
                className="hover:bg-muted/60 focus-visible:ring-ring group flex items-center gap-3 rounded-lg border p-3 transition-colors focus-visible:ring-2 focus-visible:outline-none"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">Reports</span>
                  <span className="text-muted-foreground block text-xs">
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

      <footer className="flex flex-wrap items-center gap-3 border-t pt-4">
        <FinishButton orgId={orgId} orgSlug={orgSlug} done={Boolean(progress.completedAt)} />
        <Button asChild variant="outline">
          <Link href={`/app/${orgSlug}/setup/status`}>Connection status</Link>
        </Button>
        <p className="text-muted-foreground text-xs">
          {progress.completedAt
            ? "Setup is closed. Nothing has been deleted; reopen it to bring back the prompt on the overview."
            : "Closing setup only hides the prompt on the overview. Every step stays here."}
        </p>
      </footer>
    </div>
  );
}
