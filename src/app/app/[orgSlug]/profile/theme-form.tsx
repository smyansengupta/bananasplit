"use client";

import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useState, useTransition } from "react";

import { saveThemeStep } from "@/app/onboarding/profile/actions";
import {
  initialThemeChoice,
  ThemePicker,
  toPersonalTheme,
} from "@/components/onboarding/theme-picker";
import { Button } from "@/components/ui/button";
import type { PersonalTheme } from "@/lib/theme/personal";

/**
 * Profile > Theme: the personal theme from onboarding A4, editable. "Match
 * my club" saves NULL, so the org's theme (Settings > Theme) shows again.
 */
export function ThemeForm({
  initial,
  clubMode = "system",
}: {
  initial: PersonalTheme | null;
  /** The org's default light/dark ("system" = the device), used by "Match my club". */
  clubMode?: "light" | "dark" | "system";
}) {
  const router = useRouter();
  const { setTheme } = useTheme();
  const [choice, setChoice] = useState(() => initialThemeChoice(initial));
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  function save(value: PersonalTheme | null) {
    setStatus(null);
    start(async () => {
      const result = await saveThemeStep(value);
      if (!result.ok) {
        setStatus({
          ok: false,
          text: Object.values(result.fieldErrors)[0] ?? "Couldn't save. Try again.",
        });
        return;
      }
      setTheme(value ? value.mode : clubMode);
      setStatus({ ok: true, text: value ? "Theme saved." : "Following the organization's theme." });
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <ThemePicker value={choice} onChange={setChoice} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={() => save(toPersonalTheme(choice))} disabled={pending}>
          {pending ? "Saving…" : "Save theme"}
        </Button>
        <span
          aria-live="polite"
          className={
            status?.ok === false ? "text-destructive text-sm" : "text-muted-foreground text-sm"
          }
        >
          {status?.text}
        </span>
      </div>
    </div>
  );
}
