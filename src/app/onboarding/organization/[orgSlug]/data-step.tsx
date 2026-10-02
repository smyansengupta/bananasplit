"use client";

import {
  CalendarDays,
  Circle,
  CircleCheck,
  CircleDashed,
  Database,
  Info,
  KeyRound,
  Mail,
  Plug,
  SkipForward,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

import { ContinueButton, FieldError } from "@/components/onboarding/step-card";
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

const ICONS: Record<string, LucideIcon> = {
  data: Database,
  calendar: CalendarDays,
  email: Mail,
  claude: KeyRound,
};

const STATUS: Record<SetupStepStatus, { text: string; tone: string; icon: LucideIcon }> = {
  connected: { text: "Connected", tone: "bg-success/10 text-success", icon: CircleCheck },
  untested: { text: "Testing", tone: "bg-warning/10 text-warning", icon: CircleDashed },
  error: { text: "Not working", tone: "bg-destructive/10 text-destructive", icon: TriangleAlert },
  needs_reauth: { text: "Reconnect", tone: "bg-destructive/10 text-destructive", icon: TriangleAlert },
  skipped: { text: "Skipped", tone: "bg-muted text-muted-foreground", icon: CircleDashed },
  todo: { text: "Not connected", tone: "bg-muted text-muted-foreground", icon: Circle },
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
          const Icon = ICONS[c.id] ?? Plug;
          const StatusIcon = status.icon;
          const connected = c.status === "connected";
          return (
            <li
              key={c.id}
              className={cn(
                "flex min-w-0 items-center gap-3 rounded-xl border px-3 py-3 transition-colors",
                connected && "border-success/30 bg-success/5",
              )}
            >
              <Icon
                className={cn("size-4 shrink-0", connected ? "text-success" : "text-muted-foreground")}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{c.title}</span>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                      status.tone,
                    )}
                  >
                    <StatusIcon className="size-3" aria-hidden="true" />
                    {status.text}
                  </span>
                </div>
                {c.detail || c.lastError ? (
                  <div className="text-muted-foreground truncate font-mono text-[11px]">
                    {c.detail ?? c.lastError}
                  </div>
                ) : (
                  <div className="text-muted-foreground line-clamp-2 text-xs leading-snug">
                    {c.summary}
                  </div>
                )}
              </div>
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
      <p className="text-muted-foreground flex gap-1.5 text-xs">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <span>
        Connect opens the guided setup for that service: where the key comes from, what it can
        reach, and a live test. You come back here when it&apos;s done.
        </span>
      </p>
      <FieldError message={error ?? undefined} />
      <div className="flex gap-2 border-t pt-4">
        <Button
          type="button"
          variant="outline"
          size="lg"
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
          <SkipForward aria-hidden="true" />
          Skip for now
        </Button>
        <ContinueButton
          pending={pending}
          pendingLabel="One moment…"
          disabled={connectedCount === 0}
          onClick={() => start(() => goToNextOrgStep(orgSlug, "data"))}
        />
      </div>
    </div>
  );
}
