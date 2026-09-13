"use client";

import { Lock, Users } from "lucide-react";

import { cn } from "@/lib/utils";

const OPTIONS = [
  { value: "PRIVATE" as const, label: "Private", icon: Lock },
  { value: "ORGANIZATION" as const, label: "Organization", icon: Users },
];

export function VisibilityToggle({
  value,
  onChange,
  disabled,
}: {
  value: "PRIVATE" | "ORGANIZATION";
  onChange: (value: "PRIVATE" | "ORGANIZATION") => void;
  disabled?: boolean;
}) {
  return (
    <div className="bg-muted inline-flex items-center gap-1 rounded-lg p-1">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(option.value)}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
            value === option.value
              ? "bg-background shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <option.icon className="size-3.5" aria-hidden="true" />
          {option.label}
        </button>
      ))}
    </div>
  );
}
