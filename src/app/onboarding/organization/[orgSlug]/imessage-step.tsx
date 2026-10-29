"use client";

import { Check } from "@/components/icons";
import { useState } from "react";

import { pill } from "@/components/brand/pill";
import { IMESSAGE } from "@/components/marketing/palette";
import {
  ContinuePill,
  SetupCard,
  StepBody,
  StepFooter,
  StepIntro,
} from "@/components/onboarding/setup-shell";
import { Input } from "@/components/ui/input";
import type { SetupFlow } from "@/lib/onboarding/steps";
import { cn } from "@/lib/utils";

import { useNextStep, type SetupStepProps } from "./step-flow";

/** What you text, and what Bananasplit does about it. */
const THREAD: Record<SetupFlow, readonly { you: string; done: string }[]> = {
  org: [
    {
      you: "Add a task for Maya: send the Acme proposal Friday",
      done: "Done. Assigned to Maya, due Fri.",
    },
    { you: "Move tomorrow's standup to 10", done: "Moved to 10 AM. 6 people notified." },
    { you: "How much have we spent on ads this month?", done: "$2,340, 18% under budget." },
  ],
  personal: [
    { you: "Remind me to renew my passport next week", done: "Set for Mon, 9 AM." },
    { you: "What's on today?", done: "Dentist at 3, and 2 tasks due." },
    { you: "Move the dentist to Thursday", done: "Moved to Thu, 3 PM." },
  ],
};

/**
 * iMessage: run everything by text. Tasks, meetings, money and answers, from
 * anywhere, the reason people stay on Team Advanced (Personal Plus for one
 * person). The screen is here before the texting service is: Turn on marks
 * it on this page only; nothing is sent or stored yet.
 */
export function IMessageStep(props: SetupStepProps) {
  const { backHref, flow } = props;
  const { pending, next, skip } = useNextStep(props, "imessage");
  const [phone, setPhone] = useState("");
  const [on, setOn] = useState(false);

  return (
    <SetupCard>
      <StepIntro title="Run it all by text.">
        {flow === "org"
          ? "Tasks, meetings, money and answers. Text Bananasplit like a teammate."
          : "Reminders, plans and answers. Text Bananasplit like a friend."}
      </StepIntro>
      <StepBody className="gap-5">
        <ol
          aria-label="Example messages"
          className="bg-muted/60 m-0 flex list-none flex-col gap-2 rounded-[20px] p-4"
        >
          {THREAD[flow].map(({ you, done }) => (
            <li key={you} className="flex flex-col gap-1.5">
              <span
                className="max-w-[85%] self-end rounded-[16px] rounded-br-[5px] px-3 py-2 text-[14px] leading-[1.35]"
                style={{ backgroundColor: IMESSAGE.blue, color: IMESSAGE.white }}
              >
                {you}
              </span>
              <span className="bg-card max-w-[85%] self-start rounded-[16px] rounded-bl-[5px] px-3 py-2 text-[14px] leading-[1.35] shadow-[var(--elevation-1)]">
                {done}
              </span>
            </li>
          ))}
        </ol>

        <div className="flex flex-wrap gap-2">
          <label htmlFor="imessage-phone" className="sr-only">
            iPhone number
          </label>
          <Input
            id="imessage-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="iPhone number"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              setOn(false);
            }}
            className="h-10 min-w-0 flex-1"
          />
          <button
            type="button"
            onClick={() => setOn(true)}
            disabled={phone.replace(/\D/g, "").length < 7 || on}
            className={cn(pill({ size: "md", tone: on ? "outline" : "ink" }), "flex-none")}
          >
            {on ? (
              <>
                <Check className="size-4" strokeWidth={3} aria-hidden="true" />
                On
              </>
            ) : (
              "Turn on"
            )}
          </button>
        </div>
        <p className="text-muted-foreground m-0 -mt-2 text-[13px]">
          {flow === "org" ? "Team Advanced" : "Personal Plus"}, free during your trial.
        </p>
      </StepBody>
      <StepFooter
        back={backHref ? { href: backHref } : undefined}
        skip={on ? undefined : { onClick: skip, disabled: pending }}
      >
        <ContinuePill pending={pending} onClick={() => next()} />
      </StepFooter>
    </SetupCard>
  );
}
