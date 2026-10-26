"use client";

import { Info, Loader2 } from "@/components/icons";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useState, useTransition } from "react";

import { saveThemeStep } from "@/app/onboarding/profile/actions";
import { Button } from "@/components/ui/button";

/**
 * Shown on Settings > Theme when the viewer has their own theme: theirs is
 * what they see, so changes here would look like they did nothing.
 */
export function PersonalThemeNotice({
  themeName,
  profileHref,
  clubMode = "system",
}: {
  themeName: string;
  profileHref: string;
  /** The club's default light/dark, applied when switching back to it. */
  clubMode?: "light" | "dark" | "system";
}) {
  const router = useRouter();
  const { setTheme } = useTheme();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div
      role="status"
      className="bg-tint-info text-tint-info-foreground rounded-tile flex flex-col gap-3 py-3 pr-3 pl-4 sm:flex-row sm:items-center"
    >
      <Info className="size-5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold">You&apos;re seeing your own theme ({themeName}).</p>
        <p className="text-xs opacity-85">
          Changes here apply to everyone who matches the club, but not to you while your personal
          theme is on. You can change it in{" "}
          <a href={profileHref} className="underline underline-offset-2">
            your profile
          </a>
          .
        </p>
        {error && <p className="text-destructive mt-1 text-xs">{error}</p>}
      </div>
      <Button
        type="button"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const result = await saveThemeStep(null);
            if (!result.ok) setError("Couldn't switch. Try again.");
            else {
              setTheme(clubMode);
              router.refresh();
            }
          })
        }
      >
        {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
        Match the club instead
      </Button>
    </div>
  );
}
