"use client";

import { Check, Plus } from "@/components/icons";
import { useState, type ReactNode } from "react";

import {
  ContinuePill,
  SetupCard,
  StepBody,
  StepFooter,
  StepIntro,
} from "@/components/onboarding/setup-shell";
import { cn } from "@/lib/utils";

import { useNextStep, type SetupStepProps } from "./step-flow";

export interface ToolTile {
  slug: string;
  name: string;
  /** What it does once connected, in a few words. */
  does: string;
  /** The app's logo (a BrandMark drawn on the server). */
  logo: ReactNode;
}

/**
 * Connect tools: the apps the home page names (notes, meetings, AI, inbox,
 * data), as buttons. They mark what you use here; connecting each one is
 * in Settings › Integrations, where the guided setups are.
 */
export function ToolsStep(props: SetupStepProps & { tools: readonly ToolTile[] }) {
  const { backHref, tools } = props;
  const { pending, next, skip } = useNextStep(props, "tools");
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (slug: string) =>
    setPicked((p) => (p.includes(slug) ? p.filter((x) => x !== slug) : [...p, slug]));

  return (
    <SetupCard>
      <StepIntro title="Plug in the apps you already use.">
        Meeting notes file themselves, calls get booked in place and your inbox turns into tasks.
        Pick yours.
      </StepIntro>
      <StepBody>
        <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2">
          {tools.map((tool) => {
            const on = picked.includes(tool.slug);
            return (
              // An odd last tile takes the whole row rather than sitting alone.
              <li key={tool.slug} className="sm:odd:last:col-span-2">
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(tool.slug)}
                  className={cn(
                    "bg-card rounded-tile flex w-full cursor-pointer items-center gap-3 border p-2.5 text-left transition-[border-color,box-shadow]",
                    on ? "border-foreground ring-foreground ring-1" : "hover:border-foreground/30",
                  )}
                >
                  <span aria-hidden="true">{tool.logo}</span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[14px] font-semibold">{tool.name}</span>
                    <span className="text-muted-foreground truncate text-[12px]">{tool.does}</span>
                  </span>
                  {on ? (
                    <Check className="size-4 flex-none" strokeWidth={3} aria-label="Added" />
                  ) : (
                    <Plus className="text-muted-foreground size-4 flex-none" aria-hidden="true" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </StepBody>
      <StepFooter
        back={backHref ? { href: backHref } : undefined}
        skip={{ onClick: skip, disabled: pending }}
      >
        <ContinuePill pending={pending} onClick={() => next()} />
      </StepFooter>
    </SetupCard>
  );
}
