"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  nextProfileStep,
  previousProfileStep,
  profileStepHref,
  type ProfileStep,
} from "@/lib/onboarding/steps";

import type { StepSaveResult } from "./actions";

/**
 * Back + Continue for a profile-setup step. Continue saves the step first
 * and only moves on when the save worked; field errors come back to the
 * form through onErrors.
 */
export function useStepSave(step: ProfileStep) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});

  function saveAndContinue(run: () => Promise<StepSaveResult>) {
    setErrors({});
    startTransition(async () => {
      const result = await run();
      if (!result.ok) {
        setErrors(result.fieldErrors);
        return;
      }
      const next = nextProfileStep(step);
      router.push(next ? profileStepHref(next) : "/onboarding");
    });
  }

  return { pending, errors, setErrors, saveAndContinue };
}

export function StepNav({
  step,
  pending,
  onContinue,
  continueLabel = "Continue",
  continueStyle,
  disabled,
}: {
  step: ProfileStep;
  pending: boolean;
  onContinue: () => void;
  continueLabel?: ReactNode;
  /** A4 colours its button with the picked theme. */
  continueStyle?: React.CSSProperties;
  disabled?: boolean;
}) {
  const previous = previousProfileStep(step);
  return (
    <div className="flex gap-2 pt-1">
      {previous && (
        <Button asChild variant="outline" className="text-muted-foreground">
          <Link href={profileStepHref(previous)}>Back</Link>
        </Button>
      )}
      <Button
        type="button"
        className="flex-1 font-semibold"
        onClick={onContinue}
        disabled={pending || disabled}
        style={continueStyle}
      >
        {pending ? "Saving…" : continueLabel}
      </Button>
    </div>
  );
}
