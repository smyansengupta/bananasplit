"use client";

import { useTheme } from "next-themes";
import { useState } from "react";

import { FieldError } from "@/components/onboarding/step-card";
import {
  choiceName,
  initialThemeChoice,
  ThemePicker,
  toPersonalTheme,
  useChoiceColors,
} from "@/components/onboarding/theme-picker";
import type { PersonalTheme } from "@/lib/theme/personal";

import { saveThemeStep } from "./actions";
import { StepNav, useStepSave } from "./step-nav";

/** A4 · Theme: only changes this member's view. The choice carries into A6. */
export function ThemeStep({ initial }: { initial: PersonalTheme | null }) {
  const { pending, errors, saveAndContinue } = useStepSave("theme");
  const { setTheme } = useTheme();
  const [choice, setChoice] = useState(() => initialThemeChoice(initial, "harbor"));
  const colors = useChoiceColors(choice);

  function submit() {
    saveAndContinue(async () => {
      const result = await saveThemeStep(toPersonalTheme(choice));
      // Light or dark applies right away on this device too.
      if (result.ok) setTheme(choice.mode);
      return result;
    });
  }

  return (
    <div className="space-y-4">
      <ThemePicker value={choice} onChange={setChoice} />
      <FieldError message={errors.form ?? errors.preset ?? errors.custom} />
      <StepNav
        step="theme"
        pending={pending}
        onContinue={submit}
        continueLabel={`Use ${choiceName(choice)}`}
        continueStyle={colors ? { background: colors.primary, color: colors.onPrimary } : undefined}
      />
    </div>
  );
}
