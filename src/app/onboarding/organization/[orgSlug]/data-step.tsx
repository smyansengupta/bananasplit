"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { FieldError } from "@/components/onboarding/step-card";
import { Button } from "@/components/ui/button";
import { orgStepHref } from "@/lib/onboarding/steps";
import { cn } from "@/lib/utils";
import type { SetupStepStatus } from "@/server/setup/progress";

import { goToNextOrgStep, skipDataStepAction } from "./actions";

export interface DataConnection {
  id: string;
  title: string;
  summary: string;
  status: SetupStepStatus;
  detail: string | null;
  lastError: string | null;
}

const BADGE: Record<string, string> = { data: "DB", calendar: "CAL", email: "MAIL", claude: "AI" };

const STATUS: Record<SetupStepStatus, { text: string; tone: string }> = {
  connected: { text: "● Connected", tone: "text-success" },
  untested: { text: "◌ Pending", tone: "text-warning" },
  error: { text: "● Not working", tone: "text-destructive" },
  needs_reauth: { text: "● Reconnect", tone: "text-destructive" },
  skipped: { text: "Skipped", tone: "text-muted-foreground" },
  todo: { text: "Not connected", tone: "text-muted-foreground" },
};

/**
 * B2 · Connect data: the org's real connections (the guided setup's four
 * services), each tested by that flow before it shows as Connected.
 * Continue unlocks once one works; "Skip for now" marks the rest skipped.
 */
export function DataStep({
  orgId,
  orgSlug,
  connections,
  connectedCount,
}: {
  orgId: string;
  orgSlug: string;
  connections: DataConnection[];
  connectedCount: number;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const back = encodeURIComponent(orgStepHref(orgSlug, "data"));

  return (
    <div className="space-y-4">
      <ul className="grid grid-cols-1 gap-2">
        {connections.map((c) => {
          const status = STATUS[c.status];
          const connected = c.status === "connected";
          return (
            <li
              key={c.id}
              className="flex min-w-0 items-center gap-2.5 rounded-xl border px-3 py-2.5"
            >
              <span
                className={cn(
                  "rounded-md px-1.5 py-0.5 font-mono text-[10px]",
                  connected ? "bg-success/15 text-success" : "bg-warning/15 text-warning",
                )}
              >
                {BADGE[c.id] ?? "API"}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{c.title}</div>
                {c.detail || c.lastError ? (
                  <div className="text-muted-foreground truncate font-mono text-[11px]">
                    {c.detail ?? c.lastError}
                  </div>
                ) : (
                  <div className="text-muted-foreground line-clamp-2 text-[11px] leading-snug">
                    {c.summary}
                  </div>
                )}
              </div>
              <span className={cn("shrink-0 text-[11px] whitespace-nowrap", status.tone)}>
                {status.text}
              </span>
              <Button
                asChild
                size="sm"
                variant={connected ? "ghost" : "outline"}
                className="shrink-0"
              >
                <Link href={`/app/${orgSlug}/setup?step=${c.id}&from=${back}`}>
                  {connected ? "Manage" : "Connect"}
                </Link>
              </Button>
            </li>
          );
        })}
      </ul>
      <p className="text-muted-foreground text-xs">
        Connect opens the guided setup for that service: where the key comes from, what it can
        reach, and a live test. You come back here when it&apos;s done.
      </p>
      <FieldError message={error ?? undefined} />
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          className="text-muted-foreground flex-1"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              const result = await skipDataStepAction(orgId);
              if (!result.ok) {
                setError(result.error);
                return;
              }
              await goToNextOrgStep(orgSlug, "data");
            })
          }
        >
          Skip for now
        </Button>
        <Button
          type="button"
          className="flex-1 font-semibold"
          disabled={pending || connectedCount === 0}
          onClick={() => start(() => goToNextOrgStep(orgSlug, "data"))}
        >
          Continue
        </Button>
      </div>
    </div>
  );
}
