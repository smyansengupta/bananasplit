"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";

import { Button } from "@/components/ui/button";

type Variant = "default" | "outline" | "secondary" | "ghost" | "destructive" | "link";

/**
 * A button that runs one Server Action ({ error?, data? } result) with
 * `args`, shows the error inline, and refreshes the page on success.
 * `confirm` asks first (irreversible actions). Server components pass the
 * action reference and serializable args, never a closure.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyAction = (...args: any[]) => Promise<{ error?: string }>;

export function ActionButton<A extends AnyAction>({
  action,
  args,
  children,
  confirm,
  variant = "outline",
  size = "sm",
  onDone,
  className,
}: {
  action: A;
  args?: Parameters<A>;
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
            const result = await action(...((args ?? []) as Parameters<A>));
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
