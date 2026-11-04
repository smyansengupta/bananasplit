"use client";

import { Printer } from "@/components/icons";

import { pill } from "@/components/brand/pill";

/** "Print or save as PDF": the browser's print dialog. */
export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className={pill({ size: "sm" })}>
      <Printer className="size-4" aria-hidden="true" />
      Print or save as PDF
    </button>
  );
}
