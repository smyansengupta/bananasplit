"use client";

import { Info, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { saveThemeStep } from "@/app/onboarding/profile/actions";
import { Button } from "@/components/ui/button";

/**
 * Shown on Settings > Theme when the viewer has their own theme: theirs is
 * what they see, so changes here would look like they did nothing.
 */
export function PersonalThemeNotice({ themeName, profileHref }: { themeName: string; profileHref: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div
      role="status"
      className="bg-primary/5 border-primary/30 flex flex-col gap-3 rounded-xl border p-3.5 sm:flex-row sm:items-center"
    >
      <Info className="text-primary size-5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium">You&apos;re seeing your own theme ({themeName}).</p>
        <p className="text-muted-foreground text-xs">
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
            else router.refresh();
          })
        }
      >
        {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
        Match the club instead
      </Button>
    </div>
  );
}
