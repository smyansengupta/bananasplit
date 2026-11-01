"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";

import { turnPulseOnAction } from "./actions";

/** Turns the weekly pulse on right here, instead of a trip to the Admin panel. */
export function TurnPulseOnButton({ orgId }: { orgId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="flex flex-col items-center gap-2">
      <Button
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await turnPulseOnAction(orgId);
            if (!result.ok) setError(result.error ?? "That didn't save. Try again.");
          })
        }
      >
        {pending ? "Turning on…" : "Turn on"}
      </Button>
      {error && (
        <span role="alert" className="text-tint-danger-foreground text-sm">
          {error}
        </span>
      )}
    </span>
  );
}
