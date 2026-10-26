import { Check, Clock, KeyRound } from "@/components/icons";
import Link from "next/link";
import type { ReactNode } from "react";

import { ClickPath, Consequences, PanelSection, Prerequisite } from "@/components/setup/setup-ui";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { setupStep, type SetupStepId } from "@/server/setup/catalog";

import { ResumeButton, SkipButton, TestButton } from "./step-controls";
import { CalendarForm, ClaudeForm, DataSourceForm } from "./step-forms";
import type { SetupStepView } from "./view";

/**
 * One step, not yet connected: why it is worth five minutes, what it costs,
 * where the credential lives, and the field to paste it into.
 *
 * The order is the order a person decides in — is this worth it, will it
 * hurt, how do I do it, do it — so nobody pastes a key before reading what
 * it grants. The consequences are never behind a disclosure.
 *
 * Two cards on the setup page (what it is, then the form with the step's
 * one primary action); embedded in another page's card (Databases) the
 * same sections run flat, one after the other.
 */
/** A card on the setup page; flat sections when embedded in another card. */
function Surface({
  embedded,
  children,
  className,
}: {
  embedded: boolean;
  children: ReactNode;
  className?: string;
}) {
  if (embedded) return <div className={cn("space-y-7", className)}>{children}</div>;
  return (
    <Card className="max-sm:[--card-spacing:--spacing(4.5)]">
      <CardContent className={cn("space-y-7", className)}>{children}</CardContent>
    </Card>
  );
}

export function StepPanel({
  orgId,
  orgSlug,
  view,
  nextStep,
  googleConfigured,
  embedded = false,
}: {
  orgId: string;
  orgSlug: string;
  view: SetupStepView;
  nextStep: SetupStepId | null;
  googleConfigured: boolean;
  /** Shown inside another page (Databases): no skip controls, no page header size. */
  embedded?: boolean;
}) {
  const step = setupStep(view.id);
  const reconnecting = view.status === "error" || view.status === "needs_reauth";

  return (
    <div className={embedded ? "space-y-7" : "space-y-4.5"}>
      <Surface embedded={embedded}>
        <header className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <h2 className={embedded ? "heading text-[17px]" : "display-title text-2xl"}>
              {step.title}
            </h2>
            <Badge variant="secondary">
              <Clock aria-hidden="true" />
              About {step.minutes} minute{step.minutes === 1 ? "" : "s"}
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm">{step.summary}</p>
        </header>

        {view.status === "skipped" ? (
          <p className="rounded-tile bg-muted/60 text-muted-foreground p-3 text-sm">
            You passed over this one. Nothing has been lost — connect it now and it stops counting
            as skipped, or put it back on the list at the bottom of this page.
          </p>
        ) : null}

        {reconnecting && view.lastError ? (
          <div
            role="alert"
            className="rounded-tile bg-tint-danger text-tint-danger-foreground space-y-1 p-3 text-sm"
          >
            <p className="font-semibold">This stopped working.</p>
            <p>{view.lastError}</p>
          </div>
        ) : null}

        <PanelSection title="What this turns on">
          <ul className="space-y-2">
            {step.unlocks.map((line) => (
              <li key={line} className="flex gap-2.5 text-sm">
                <Check
                  className="text-success mt-0.5 size-4 shrink-0"
                  strokeWidth={2.5}
                  aria-hidden="true"
                />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </PanelSection>

        {step.prerequisite ? <Prerequisite>{step.prerequisite}</Prerequisite> : null}

        <Consequences items={step.consequences} />

        <PanelSection title="Where to find it">
          <ClickPath items={step.where} />
        </PanelSection>
      </Surface>

      <Surface embedded={embedded} className="space-y-6">
        {/* A credential is stored but has not proved itself: someone saved it
            and came back later, or it broke. Offer the test before the form,
            so nobody re-pastes a key that was fine all along. */}
        {view.hasSecret ? (
          <section className="rounded-tile bg-muted/60 flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
            <KeyRound className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
            <div className="min-w-0 flex-1 space-y-0.5">
              <h3 className="heading text-sm">There is already a credential here</h3>
              <p className="text-muted-foreground text-sm">
                {view.last4 ? (
                  <>
                    Saved, ending <span className="font-mono">{view.last4}</span>.{" "}
                  </>
                ) : (
                  "One is saved. "
                )}
                Test it before pasting a new one — it may only have needed the thing you just fixed
                elsewhere.
              </p>
            </div>
            <TestButton
              orgId={orgId}
              step={view.id}
              label={view.id === "calendar" ? "Test and refresh calendars" : "Test connection"}
            />
          </section>
        ) : null}

        <PanelSection
          title={
            view.id === "calendar"
              ? view.hasSecret
                ? "Or connect a different account"
                : "Connect the account"
              : view.hasSecret
                ? "Or replace the credential"
                : "Paste it here"
          }
          className="space-y-4"
        >
          {view.id === "data" ? <DataSourceForm orgId={orgId} view={view} /> : null}
          {view.id === "calendar" ? (
            <CalendarForm orgId={orgId} view={view} configured={googleConfigured} />
          ) : null}
          {view.id === "claude" ? <ClaudeForm orgId={orgId} view={view} /> : null}
        </PanelSection>
      </Surface>

      <footer
        className={cn(
          "flex flex-wrap items-center gap-x-4 gap-y-2",
          embedded ? "pt-1" : "px-2 sm:px-6",
        )}
      >
        {embedded ? null : view.status === "skipped" ? (
          <ResumeButton orgId={orgId} step={view.id} />
        ) : (
          <SkipButton orgId={orgId} orgSlug={orgSlug} step={view.id} nextStep={nextStep} />
        )}
        {!embedded && (
          <p className="text-muted-foreground max-w-md min-w-0 flex-1 text-[13px]">
            {step.ifSkipped}
          </p>
        )}
        <Link
          href={`/app/${orgSlug}/settings/integrations/${step.settingsSegment}`}
          className="text-muted-foreground hover:text-foreground focus-glow ml-auto rounded-full text-[13px] font-medium underline-offset-4 hover:underline"
        >
          Full settings for this
        </Link>
      </footer>
    </div>
  );
}
