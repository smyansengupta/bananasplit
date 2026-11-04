"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";

import { Segmented } from "@/components/ui/segmented";

export type PriceMode = "standard" | "student";

const OPTIONS = [
  { value: "standard", label: "Standard" },
  { value: "student", label: "Student organization" },
] as const;

function subscribeToHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

/**
 * /pricing's Standard / Student organization switch, and the matching
 * cards below. Both sets are rendered on the server and passed in; the one
 * not chosen is hidden, so the page works (Standard shows) before
 * JavaScript runs. Arriving at /pricing#student opens the student prices.
 */
export function PriceModeSwitch({
  standard,
  student,
}: {
  standard: ReactNode;
  student: ReactNode;
}) {
  // A choice made on the switch wins; until then the hash decides (the
  // server, which can't see it, renders Standard).
  const [chosen, setChosen] = useState<PriceMode | null>(null);
  const studentHash = useSyncExternalStore(
    subscribeToHash,
    () => window.location.hash === "#student",
    () => false,
  );
  const mode = chosen ?? (studentHash ? "student" : "standard");

  return (
    <div className="flex flex-col gap-10">
      <div className="flex justify-center">
        <Segmented
          label="Prices for"
          options={OPTIONS}
          value={mode}
          onSelect={(value) => setChosen(value as PriceMode)}
        />
      </div>
      <div hidden={mode !== "standard"}>{standard}</div>
      <div hidden={mode !== "student"}>{student}</div>
    </div>
  );
}
