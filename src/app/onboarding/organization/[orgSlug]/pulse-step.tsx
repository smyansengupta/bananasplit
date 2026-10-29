"use client";

import { useState, useTransition } from "react";

import { PulseFields } from "@/components/onboarding/pulse-fields";
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
import { describePulseSchedule, type PulseSettings } from "@/lib/pulse/settings";

import { goToNextOrgStep, savePulseStepAction } from "./actions";

/**
 * Club setup: when the weekly pulse goes out (redesign guide 15.2). The
 * day (Fri by default), the time (5 PM), who gets it and how, saved to
 * OrgSettings; changed later in Admin panel › Weekly pulse.
 */
export function PulseStep({
  orgId,
  orgSlug,
  clubName,
  index,
  total,
  backHref,
  initial,
}: {
  orgId: string;
  orgSlug: string;
  clubName: string;
  index: number;
  total: number;
  backHref: string;
  initial: PulseSettings;
}) {
  const [value, setValue] = useState<PulseSettings>({ ...initial, pulseEnabled: true });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(next: PulseSettings) {
    setError(null);
    start(async () => {
      const result = await savePulseStepAction(orgId, next);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      await goToNextOrgStep(orgSlug, "pulse");
    });
  }

  const channels = [value.pulseInApp && "in the app", value.pulseEmail && "by email"].filter(
    Boolean,
  );

  return (
    <SetupCard
      preview={
        <>
          <PreviewHeader meta={describePulseSchedule(value)} />
          <PreviewTile className="gap-3">
            <span className="text-muted-foreground text-[12px] font-medium">
              Weekly pulse · {clubName}
            </span>
            <span className="display-title text-[20px]">Week of Oct 3 to Oct 9</span>
            <span className="text-muted-foreground text-[12px]">
              9 things done · 32 at the General meeting · 4 new members
            </span>
            {[
              ["Venue and logistics is done", "Fall Showcase"],
              ["9 tasks finished", "Fall Showcase 5 · Recruitment 3"],
              ["T-shirt color: Midnight blue won", "21 votes."],
              ["Next week", "Officer meeting Tue · General meeting Thu"],
            ].map(([title, detail]) => (
              <span key={title} className="border-border border-t pt-2.5">
                <span className="block text-[13px] font-semibold">{title}</span>
                <span className="text-muted-foreground block text-[12px]">{detail}</span>
              </span>
            ))}
          </PreviewTile>
          <p className="text-muted-foreground m-0 text-[12px]">
            {channels.length > 0
              ? `Sent ${channels.join(" and ")}.`
              : "Turn on at least one way to send it."}
          </p>
        </>
      }
    >
      <StepIntro index={index} total={total} title="When should the weekly pulse go out?">
        A short recap of what the organization got done. You can change this later in Settings.
      </StepIntro>
      <StepBody className="gap-6">
        <PulseFields value={value} onChange={setValue} disabled={pending} />
      </StepBody>
      <StepError message={error} />
      <StepFooter
        back={{ href: backHref }}
        skip={{
          label: "Don't send one",
          disabled: pending,
          onClick: () => submit({ ...value, pulseEnabled: false }),
        }}
      >
        <ContinuePill
          pending={pending}
          disabled={!value.pulseInApp && !value.pulseEmail}
          onClick={() => submit(value)}
        />
      </StepFooter>
    </SetupCard>
  );
}
