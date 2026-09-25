"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import type { SetupStepId } from "@/server/setup/catalog";

import {
  finishSetupAction,
  resumeSetupStepAction,
  sendSetupTestEmailAction,
  skipSetupStepAction,
  testSetupStepAction,
  type SetupResult,
} from "./actions";

/**
 * The controls that move someone through the flow without connecting
 * anything: skip, come back, re-test, and finish.
 *
 * Skipping is a first-class choice, not a hidden escape hatch: it is a
 * visible button next to the primary one, it says what it costs, and it is
 * reversible from the rail.
 */

function useAction() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, start] = useTransition();
  function go(fn: () => Promise<SetupResult>, then?: () => void) {
    setError(null);
    start(async () => {
      const r = await fn();
      if (r.ok) {
        then?.();
        router.refresh();
      } else {
        setError(r.error);
      }
    });
  }
  return { error, isPending, go };
}

export function SkipButton({
  orgId,
  orgSlug,
  step,
  nextStep,
  label = "Skip for now",
}: {
  orgId: string;
  orgSlug: string;
  step: SetupStepId;
  nextStep: SetupStepId | null;
  label?: string;
}) {
  const router = useRouter();
  const { error, isPending, go } = useAction();
  return (
    <div className="space-y-1">
      <Button
        type="button"
        variant="ghost"
        disabled={isPending}
        onClick={() =>
          go(
            () => skipSetupStepAction(orgId, step),
            () =>
              router.push(
                `/app/${orgSlug}/setup?step=${nextStep && nextStep !== step ? nextStep : "finish"}`,
              ),
          )
        }
      >
        {isPending ? "Skipping…" : label}
      </Button>
      {error ? (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function ResumeButton({ orgId, step }: { orgId: string; step: SetupStepId }) {
  const { error, isPending, go } = useAction();
  return (
    <div className="space-y-1">
      <Button
        type="button"
        disabled={isPending}
        onClick={() => go(() => resumeSetupStepAction(orgId, step))}
      >
        {isPending ? "Working…" : "Set this up after all"}
      </Button>
      {error ? (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function TestButton({
  orgId,
  step,
  label = "Test connection",
  variant = "outline",
}: {
  orgId: string;
  step: SetupStepId;
  label?: string;
  variant?: "outline" | "ghost" | "default";
}) {
  const router = useRouter();
  const [result, setResult] = useState<SetupResult | null>(null);
  const [isPending, start] = useTransition();
  return (
    <div className="space-y-1.5">
      <Button
        type="button"
        variant={variant}
        disabled={isPending}
        onClick={() =>
          start(async () => {
            setResult(null);
            const r = await testSetupStepAction(orgId, step);
            setResult(r);
            router.refresh();
          })
        }
      >
        {isPending ? "Testing…" : label}
      </Button>
      {result ? (
        <p
          role="status"
          className={result.ok ? "text-success text-sm" : "text-destructive text-sm"}
        >
          {result.ok ? (result.message ?? "It works.") : result.error}
          {!result.ok && result.fix ? (
            <span className="text-foreground/80 mt-1 block">{result.fix}</span>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

/** One message from the org's own sender to the acting user, nobody else. */
export function SendTestEmailButton({ orgId }: { orgId: string }) {
  const [result, setResult] = useState<SetupResult | null>(null);
  const [isPending, start] = useTransition();
  return (
    <div className="space-y-1.5">
      <Button
        type="button"
        variant="outline"
        disabled={isPending}
        onClick={() =>
          start(async () => {
            setResult(null);
            setResult(await sendSetupTestEmailAction(orgId));
          })
        }
      >
        {isPending ? "Sending…" : "Send me a test email"}
      </Button>
      {result ? (
        <p
          role="status"
          className={result.ok ? "text-success text-sm" : "text-destructive text-sm"}
        >
          {result.ok ? (result.message ?? "Sent.") : result.error}
        </p>
      ) : null}
    </div>
  );
}

/** Closes the flow. Nothing is deleted; the prompt on the overview goes away. */
export function FinishButton({
  orgId,
  orgSlug,
  done,
}: {
  orgId: string;
  orgSlug: string;
  done: boolean;
}) {
  const router = useRouter();
  const { error, isPending, go } = useAction();
  return (
    <div className="space-y-1">
      <Button
        type="button"
        variant={done ? "outline" : "default"}
        disabled={isPending}
        onClick={() =>
          go(
            () => finishSetupAction(orgId, !done),
            () => (done ? undefined : router.push(`/app/${orgSlug}`)),
          )
        }
      >
        {isPending ? "Saving…" : done ? "Reopen setup" : "Done for now"}
      </Button>
      {error ? (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      ) : null}
    </div>
  );
}
