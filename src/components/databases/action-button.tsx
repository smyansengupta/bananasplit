"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";

import { Button } from "@/components/ui/button";

type Variant = "default" | "outline" | "secondary" | "ghost" | "destructive" | "link";

/**
 * A button that runs one Server Action ({ error?, data? } result), shows
 * the error inline, and refreshes the page on success. `confirm` asks
 * first (irreversible actions).
 */
export function ActionButton({
  action,
  children,
  confirm,
  variant = "outline",
  size = "sm",
  onDone,
  className,
}: {
  action: () => Promise<{ error?: string }>;
  children: ReactNode;
  confirm?: string;
  variant?: Variant;
  size?: "default" | "sm" | "xs";
  onDone?: () => void;
  className?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        type="button"
        variant={variant}
        size={size}
        disabled={pending}
        className={className}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          setError(null);
          start(async () => {
            const result = await action();
            if (result.error) {
              setError(result.error);
              return;
            }
            onDone?.();
            router.refresh();
          });
        }}
      >
        {children}
      </Button>
      {error && (
        <span role="alert" className="text-destructive text-xs">
          {error}
        </span>
      )}
    </span>
  );
}
