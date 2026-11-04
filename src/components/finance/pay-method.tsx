"use client";

import { useState } from "react";

import { Input } from "@/components/ui/input";
import { chipClass } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";

/** How clubs pay members back, in the order they're usually picked. */
export const PAY_METHODS = ["Venmo", "Zelle", "Cash App", "PayPal", "Cash", "Check"] as const;

const LAST_METHOD_KEY = "bananasplit.finance.payMethod";

/** The method this treasurer used last on this device (a convenience, never required). */
export function lastPayMethod(): string {
  try {
    return window.localStorage.getItem(LAST_METHOD_KEY) ?? "";
  } catch {
    return "";
  }
}

export function rememberPayMethod(method: string) {
  try {
    if (method.trim()) window.localStorage.setItem(LAST_METHOD_KEY, method.trim());
  } catch {
    // Private windows and blocked storage: nothing to remember.
  }
}

/**
 * How a treasurer paid someone back: one chip per usual method, the last one
 * used picked already, and a field for anything else. One click instead of
 * typing "Venmo" every time.
 */
export function PayMethodChips({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (method: string) => void;
  className?: string;
}) {
  const known = (PAY_METHODS as readonly string[]).includes(value);
  const [other, setOther] = useState(!known && value !== "");
  return (
    <div
      role="group"
      aria-label="Paid with"
      className={cn("flex flex-wrap items-center gap-1.5", className)}
    >
      {PAY_METHODS.map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={value === m}
          onClick={() => {
            setOther(false);
            onChange(m);
          }}
          className={cn(chipClass(value === m), "h-8 px-3 text-[13px]")}
        >
          {m}
        </button>
      ))}
      {other ? (
        <Input
          autoFocus
          aria-label="Paid with"
          value={known ? "" : value}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-32"
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setOther(true);
            onChange("");
          }}
          className={cn(chipClass(false), "h-8 px-3 text-[13px]")}
        >
          Other
        </button>
      )}
    </div>
  );
}
