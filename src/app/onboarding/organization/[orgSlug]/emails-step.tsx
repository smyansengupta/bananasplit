"use client";

import { Mail, Users } from "@/components/icons";
import { useState } from "react";

import { saveNotificationPreferences } from "@/app/app/[orgSlug]/profile/actions";
import {
  ContinuePill,
  SetupCard,
  StepBody,
  StepError,
  StepFooter,
  StepIntro,
} from "@/components/onboarding/setup-shell";
import { Switch } from "@/components/ui/switch";
import { EMAIL_GROUPS, emailPatch, type EmailGroupId } from "@/lib/onboarding/emails";

import { saveOrgEmailsStepAction } from "./actions";
import { useNextStep, type SetupStepProps } from "./step-flow";

const DIGEST_LABEL = "A morning summary of your day";

/**
 * Emails: what lands in your inbox (your own email preferences, as on the
 * profile) and, for an organization, whether everyone gets the weekly
 * recap by email. The switches start all on for someone who has never
 * chosen (setupEmailSwitches), else at what they chose.
 */
export function EmailsStep(
  props: SetupStepProps & {
    initial: Record<EmailGroupId, boolean>;
    /** Organizations only: OrgSettings.pulseEmail. */
    recapByEmail: boolean | null;
    orgName: string;
  },
) {
  const { backHref, orgId, flow, initial, orgName } = props;
  const { pending, error, next, skip } = useNextStep(props, "emails");
  const [on, setOn] = useState(initial);
  const [recap, setRecap] = useState(props.recapByEmail === null ? null : true);

  function save() {
    next(async () => {
      const mine = await saveNotificationPreferences(emailPatch(on));
      if (!mine.ok) return { ok: false, error: mine.error };
      if (flow === "org" && recap !== null) return saveOrgEmailsStepAction(orgId, recap);
      return { ok: true };
    });
  }

  const rows = [
    ...EMAIL_GROUPS.map((g) => ({ id: g.id as EmailGroupId, label: g.label })),
    { id: "digest" as const, label: DIGEST_LABEL },
  ];

  return (
    <SetupCard>
      <StepIntro title="Turn on emails.">Switch off what you don&apos;t want.</StepIntro>
      <StepBody className="gap-5">
        {flow === "org" && recap !== null && (
          <section className="flex flex-col gap-2">
            <h2 className="text-muted-foreground m-0 flex items-center gap-1.5 text-[13px] font-semibold">
              <Users className="size-4" aria-hidden="true" />
              For everyone in {orgName}
            </h2>
            <Row
              id="recap"
              label="A weekly recap: what got done and what's next"
              checked={recap}
              onChange={setRecap}
            />
          </section>
        )}
        <section className="flex flex-col gap-2">
          <h2 className="text-muted-foreground m-0 flex items-center gap-1.5 text-[13px] font-semibold">
            <Mail className="size-4" aria-hidden="true" />
            For you
          </h2>
          {rows.map((r) => (
            <Row
              key={r.id}
              id={r.id}
              label={r.label}
              checked={on[r.id]}
              onChange={(v) => setOn((s) => ({ ...s, [r.id]: v }))}
            />
          ))}
        </section>
      </StepBody>
      <StepError message={error} />
      <StepFooter
        back={backHref ? { href: backHref } : undefined}
        skip={{ onClick: skip, disabled: pending }}
      >
        <ContinuePill pending={pending} onClick={save} />
      </StepFooter>
    </SetupCard>
  );
}

function Row({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label
      htmlFor={`email-${id}`}
      className="bg-card rounded-tile flex cursor-pointer items-center gap-3 border px-3.5 py-3 text-[15px]"
    >
      <span className="flex-1">{label}</span>
      <Switch id={`email-${id}`} checked={checked} onCheckedChange={onChange} />
    </label>
  );
}
