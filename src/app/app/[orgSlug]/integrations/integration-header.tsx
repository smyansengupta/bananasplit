import { ChevronDown } from "@/components/icons";
import type { ReactNode } from "react";

/** "How to set up …": the step-by-step for the other service, folded away in a card. */
export function SetupHelp({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="group bg-card ring-foreground/6 edge rounded-card text-sm ring-1">
      <summary className="heading focus-visible:outline-foreground flex cursor-pointer list-none items-center justify-between gap-3 px-6 py-5 text-[15px] outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronDown
          className="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="text-muted-foreground [&_code]:bg-muted -mt-1 px-6 pb-6 [&_code]:rounded-md [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12.5px]">
        {children}
      </div>
    </details>
  );
}
