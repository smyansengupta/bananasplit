"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { pill } from "@/components/brand/pill";
import {
  ContinuePill,
  PreviewHeader,
  PreviewTile,
  SetupCard,
  StepBody,
  StepError,
  StepFooter,
  StepIntro,
} from "@/components/onboarding/setup-shell";
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

const STATUS: Record<SetupStepStatus, { text: string; chip: string; dot: string }> = {
  connected: {
    text: "✓ Connected",
    chip: "bg-tint-success text-tint-success-foreground",
    dot: "bg-success",
  },
  untested: {
    text: "Testing",
    chip: "bg-tint-accent text-tint-accent-foreground",
    dot: "bg-brand-accent",
  },
  error: { text: "Not working", chip: "bg-destructive/10 text-destructive", dot: "bg-destructive" },
  needs_reauth: {
    text: "Reconnect",
    chip: "bg-destructive/10 text-destructive",
    dot: "bg-destructive",
  },
  skipped: { text: "Skipped", chip: "bg-muted text-muted-foreground", dot: "bg-foreground/20" },
  todo: { text: "Not connected", chip: "bg-muted text-muted-foreground", dot: "bg-foreground/20" },
};

/**
 * B2 · Connect data: the club's real connections (the guided setup's
 * services), each tested by that flow before it shows as Connected. All
 * optional: the club's data is stored in Bananasplit whether or not it
 * connects anything, so Continue always works (with nothing connected it
 * marks the step skipped, as Skip did).
 */
export function DataStep({
  orgId,
  orgSlug,
  index,
  total,
  backHref,
  connections,
  connectedCount,
}: {
  orgId: string;
  orgSlug: string;
  index: number;
  total: number;
  backHref: string;
  connections: DataConnection[];
  connectedCount: number;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const back = encodeURIComponent(orgStepHref(orgSlug, "data"));

  function skip() {
    start(async () => {
      setError(null);
      const result = await skipDataStepAction(orgId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      await goToNextOrgStep(orgSlug, "data");
    });
  }

  return (
    <SetupCard
      preview={
        <>
          <PreviewHeader meta="Your sources" />
          <PreviewTile className="gap-1">
            <span className="font-heading text-[44px] leading-none tracking-[-0.03em] tabular-nums">
              {connectedCount}
              <span className="text-muted-foreground text-[26px]"> of {connections.length}</span>
            </span>
            <span className="text-muted-foreground text-[13px]">connected and tested</span>
          </PreviewTile>
          {connections.map((c) => (
            <PreviewTile key={c.id} className="gap-1.5">
              <span className="flex items-center gap-2 text-[14px] font-semibold">
                <span className={cn("size-2 flex-none rounded-full", STATUS[c.status].dot)} />
                {c.title}
              </span>
              <span className="text-muted-foreground line-clamp-2 text-[12px] leading-normal">
                {c.summary}
              </span>
            </PreviewTile>
          ))}
        </>
      }
    >
      <StepIntro
        index={index}
        total={total}
        title="Connect the tools your organization already uses."
      >
        Optional. Your organization&apos;s data is stored in Bananasplit from day one, walled off so
        only your organization can see it. Connect something only if you already keep data
        elsewhere; each one is tested first and keys are stored encrypted.
      </StepIntro>

      <StepBody>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {connections.map((c) => {
            const status = STATUS[c.status];
            const connected = c.status === "connected";
            return (
              <li
                key={c.id}
                className="bg-card border-foreground/10 rounded-field flex min-h-10 items-center gap-3 border px-4 py-2.5"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-[15px] font-semibold">{c.title}</span>
                    <span
                      className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", status.chip)}
                    >
                      {status.text}
                    </span>
                  </span>
                  {c.detail || c.lastError ? (
                    <span className="text-muted-foreground truncate font-mono text-[12px]">
                      {c.detail ?? c.lastError}
                    </span>
                  ) : (
                    <span className="text-muted-foreground truncate text-[13px]">{c.summary}</span>
                  )}
                </span>
                <Link
                  href={`/app/${orgSlug}/setup?step=${c.id}&from=${back}`}
                  className={cn(pill({ tone: "outline", size: "sm" }), "flex-none")}
                >
                  {connected ? "Manage" : "Connect"}
                </Link>
              </li>
            );
          })}
        </ul>
        <p className="text-muted-foreground m-0 mt-2 text-[13px] leading-normal">
          Connect opens the guided setup for that service: where the key comes from, what it can
          reach, and a live test. You come back here when it&apos;s done.
        </p>
      </StepBody>

      <StepError message={error} />
      <StepFooter back={{ href: backHref }}>
        <ContinuePill
          pending={pending}
          pendingLabel="One moment…"
          onClick={() =>
            connectedCount === 0 ? skip() : start(() => goToNextOrgStep(orgSlug, "data"))
          }
        />
      </StepFooter>
    </SetupCard>
  );
}
