"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { usePreviewNext } from "@/components/onboarding/preview-flow";

import type { SetupFlow, SetupStep } from "@/lib/onboarding/steps";

import { goToNextSetupStep } from "./actions";

/** What every setup step gets from its page. */
export interface SetupStepProps {
  flow: SetupFlow;
  orgId: string;
  orgSlug: string;
  backHref: string | null;
}

/**
 * Going to the step after `step`: the server's redirect, or in the dev
 * preview (PreviewFlow) its next screen. `preview` says which, so a step
 * skips its save there.
 */
export function useGoNext(flow: SetupFlow, orgSlug: string, step: SetupStep) {
  const router = useRouter();
  const preview = usePreviewNext();
  const goNext = async () => {
    if (preview) router.push(preview);
    else await goToNextSetupStep(flow, orgSlug, step);
  };
  return { preview: preview !== null, goNext };
}

/**
 * Moving on from a setup step: `save` first when given (its error stays on
 * the step), then the next step. Skip is the same without saving.
 */
export function useNextStep({ flow, orgSlug }: SetupStepProps, step: SetupStep) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { preview, goNext } = useGoNext(flow, orgSlug, step);

  function next(save?: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    start(async () => {
      if (save && !preview) {
        const result = await save();
        if (!result.ok) {
          setError(result.error);
          return;
        }
      }
      await goNext();
    });
  }

  return { pending, error, next, skip: () => next() };
}
