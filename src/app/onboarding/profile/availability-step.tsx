"use client";

import { useState } from "react";

import { AvailabilityEditor } from "@/components/onboarding/availability-editor";
import { FieldError } from "@/components/onboarding/step-card";
import type { Availability } from "@/lib/availability";

import { saveAvailabilityStep } from "./actions";
import { StepNav, useStepSave } from "./step-nav";

/** A5 · When you can't meet. */
export function AvailabilityStep({ initial }: { initial: Availability }) {
  const { pending, errors, saveAndContinue } = useStepSave("availability");
  const [value, setValue] = useState(initial);

  const ruleError = Object.entries(errors).find(([k]) => k.startsWith("rules"))?.[1];

  return (
    <div className="space-y-4">
      <AvailabilityEditor value={value} onChange={setValue} />
      <FieldError message={errors.form ?? ruleError ?? errors.blocks} />
      <StepNav
        step="availability"
        pending={pending}
        onContinue={() => saveAndContinue(() => saveAvailabilityStep(value))}
      />
    </div>
  );
}
