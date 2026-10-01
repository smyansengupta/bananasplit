import { Check } from "lucide-react";
import Link from "next/link";

import { ClickPath, Consequences, PanelSection, Prerequisite } from "@/components/setup/setup-ui";
import { setupStep, type SetupStepId } from "@/server/setup/catalog";

import { ResumeButton, SkipButton, TestButton } from "./step-controls";
import { CalendarForm, ClaudeForm, DataSourceForm, EmailForm } from "./step-forms";
import type { SetupStepView } from "./view";

/**
 * One step, not yet connected: why it is worth five minutes, what it costs,
 * where the credential lives, and the field to paste it into.
 *
 * The order is the order a person decides in — is this worth it, will it
 * hurt, how do I do it, do it — so nobody pastes a key before reading what
 * it grants. The consequences are never behind a disclosure.
 */
export function StepPanel({
  orgId,
  orgSlug,
  orgName,
  view,
  nextStep,
  googleConfigured,
  embedded = false,
}: {
  orgId: string;
  orgSlug: string;
  orgName: string;
  view: SetupStepView;
  nextStep: SetupStepId | null;
  googleConfigured: boolean;
  /** Shown inside another page (Databases): no skip controls, no page header size. */
  embedded?: boolean;
}) {
  const step = setupStep(view.id);
  const reconnecting = view.status === "error" || view.status === "needs_reauth";

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="text-xl font-semibold tracking-tight">{step.title}</h2>
          <span className="text-muted-foreground text-xs">
            about {step.minutes} minute{step.minutes === 1 ? "" : "s"}
          </span>
        </div>
        <p className="text-muted-foreground text-sm">{step.summary}</p>
      </header>

      {view.status === "skipped" ? (
        <p className="bg-muted/40 text-muted-foreground rounded-lg border p-3 text-sm">
          You passed over this one. Nothing has been lost — connect it now and it stops counting as
          skipped, or put it back on the list at the bottom of this page.
        </p>
      ) : null}

      {reconnecting && view.lastError ? (
        <div
          role="alert"
          className="border-destructive/40 bg-destructive/5 space-y-1 rounded-lg border p-3 text-sm"
        >
          <p className="text-destructive font-medium">This stopped working.</p>
          <p>{view.lastError}</p>
        </div>
      ) : null}

      <PanelSection title="What this turns on">
        <ul className="space-y-1.5">
          {step.unlocks.map((line) => (
            <li key={line} className="flex gap-2 text-sm">
              <Check className="text-success mt-0.5 size-4 shrink-0" aria-hidden="true" />
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

      {/* A credential is stored but has not proved itself: someone saved it
          and came back later, or it broke. Offer the test before the form,
          so nobody re-pastes a key that was fine all along. */}
      {view.hasSecret ? (
        <PanelSection title="There is already a credential here">
          <p className="text-muted-foreground text-sm">
            {view.last4 ? `Saved, ending ${view.last4}. ` : "One is saved. "}
            Test it before pasting a new one — it may only have needed the thing you just fixed
            elsewhere.
          </p>
          <TestButton
            orgId={orgId}
            step={view.id}
            label={view.id === "calendar" ? "Test and refresh calendars" : "Test connection"}
          />
        </PanelSection>
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
      >
        {view.id === "data" ? <DataSourceForm orgId={orgId} view={view} /> : null}
        {view.id === "calendar" ? (
          <CalendarForm orgId={orgId} view={view} configured={googleConfigured} />
        ) : null}
        {view.id === "email" ? <EmailForm orgId={orgId} view={view} orgName={orgName} /> : null}
        {view.id === "claude" ? <ClaudeForm orgId={orgId} view={view} /> : null}
      </PanelSection>

      <footer className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-4">
        {embedded ? null : view.status === "skipped" ? (
          <ResumeButton orgId={orgId} step={view.id} />
        ) : (
          <SkipButton orgId={orgId} orgSlug={orgSlug} step={view.id} nextStep={nextStep} />
        )}
        {!embedded && <p className="text-muted-foreground max-w-md text-xs">{step.ifSkipped}</p>}
        <Link
          href={`/app/${orgSlug}/settings/integrations/${step.settingsSegment}`}
          className="text-muted-foreground ml-auto text-xs underline-offset-4 hover:underline"
        >
          Full settings for this
        </Link>
      </footer>
    </div>
  );
}
