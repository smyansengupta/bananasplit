"use client";

import { Check, Sparkles, Upload } from "@/components/icons";
import { useState } from "react";

import { SourceTile } from "@/components/onboarding/source-tile";
import {
  ContinuePill,
  SetupCard,
  StepBody,
  StepError,
  StepFooter,
  StepIntro,
} from "@/components/onboarding/setup-shell";
import { IMPORT_SOURCES, SPREADSHEET_SOURCE } from "@/lib/onboarding/sources";
import { cn } from "@/lib/utils";

import { useNextStep, type SetupStepProps } from "./step-flow";

/**
 * Import: start fresh (picked to begin with) or bring your work over from
 * the app you're leaving, the step that decides whether switching is worth
 * it, so it comes first. A spreadsheet (CSV or Excel) imports now, into a
 * database, in a new tab. The apps' importers come later: picking one says
 * so, and setup goes on through every step (nothing is skipped, since
 * nothing came over).
 */
export function ImportStep(props: SetupStepProps & { spreadsheetHref: string }) {
  const { backHref, flow, spreadsheetHref } = props;
  const { pending, error, next } = useNextStep(props, "import");
  const [picked, setPicked] = useState<string[]>([]);
  const fresh = picked.length === 0;
  // One app at a time: picking another replaces it.
  const toggle = (id: string) => setPicked((p) => (p[0] === id ? [] : [id]));

  return (
    <SetupCard>
      <StepIntro
        title={flow === "org" ? "Bring your team's work with you." : "Bring your stuff with you."}
      >
        Start fresh, or pick where you&apos;re coming from.
      </StepIntro>
      <StepBody className="gap-3">
        <button
          type="button"
          aria-pressed={fresh}
          onClick={() => setPicked([])}
          className={cn(
            "bg-card rounded-card flex w-full cursor-pointer items-center gap-3.5 border p-4 text-left transition-[border-color,box-shadow]",
            fresh ? "border-foreground ring-foreground ring-1" : "hover:border-foreground/30",
          )}
        >
          <span className="bg-muted grid size-11 flex-none place-items-center rounded-[12px]">
            <Sparkles className="size-5" aria-hidden="true" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-[16px] font-semibold">Start fresh</span>
            <span className="text-muted-foreground text-[13px]">A clean, new workspace.</span>
          </span>
          {fresh && <Check className="size-5 flex-none" strokeWidth={3} aria-hidden="true" />}
        </button>

        <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0 sm:grid-cols-4">
          {IMPORT_SOURCES.map((source) => {
            const on = picked.includes(source.id);
            return (
              <li key={source.id}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(source.id)}
                  className={cn(
                    "bg-card rounded-tile flex w-full cursor-pointer flex-col items-center gap-2 border px-2 py-3.5 text-center transition-[border-color,box-shadow]",
                    on ? "border-foreground ring-foreground ring-1" : "hover:border-foreground/30",
                  )}
                >
                  <SourceTile source={source} size={36} />
                  <span className="truncate text-[13px] font-semibold">{source.name}</span>
                </button>
              </li>
            );
          })}
        </ul>
        {!fresh && (
          <p className="text-muted-foreground m-0 text-[13px]" role="status">
            Importing from {IMPORT_SOURCES.find((s) => s.id === picked[0])?.name} is coming soon.
            Until then, set things up here.
          </p>
        )}

        <a
          href={spreadsheetHref}
          target="_blank"
          rel="noopener"
          className="bg-muted/60 rounded-tile hover:bg-muted flex items-center gap-3 p-3 text-[14px]"
        >
          <SourceTile source={SPREADSHEET_SOURCE} size={30} />
          <span className="flex-1 font-semibold">Upload a CSV or Excel file</span>
          <Upload className="text-muted-foreground size-4" aria-hidden="true" />
        </a>
      </StepBody>
      <StepError message={error} />
      <StepFooter back={backHref ? { href: backHref } : undefined}>
        <ContinuePill pending={pending} onClick={() => next()}>
          {fresh ? "Continue in a new workspace" : "Continue"}
        </ContinuePill>
      </StepFooter>
    </SetupCard>
  );
}
