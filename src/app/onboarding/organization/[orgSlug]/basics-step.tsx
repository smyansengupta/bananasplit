"use client";

import { useMemo, useState } from "react";

import { updateOrgName, updateOrgTimezone } from "@/app/app/[orgSlug]/settings/general/actions";
import { BrandField, BrandInput, brandInputClass } from "@/components/brand/fields";
import {
  ContinuePill,
  SetupCard,
  StepBody,
  StepError,
  StepFooter,
  StepIntro,
} from "@/components/onboarding/setup-shell";
import { FieldSelect } from "@/components/ui/field-select";
import { timeZoneOptions } from "@/lib/timezones";
import { cn } from "@/lib/utils";

import { useNextStep, type SetupStepProps } from "./step-flow";

/**
 * Basics, once the organization exists: Back from Import lands here, not on
 * "What brings you here?", so going back fixes the name or time zone instead
 * of making a second organization. The web address is set; Settings ›
 * General changes it (it keeps redirecting from the old one).
 */
export function OrgBasicsStep(
  props: SetupStepProps & { name: string; slug: string; timezone: string },
) {
  const { orgId, slug } = props;
  const { pending, error, next } = useNextStep(props, "basics");
  const zones = useMemo(() => timeZoneOptions(), []);
  const [name, setName] = useState(props.name);
  const [timezone, setTimezone] = useState(props.timezone);

  function save() {
    next(async () => {
      const named = await updateOrgName(orgId, name);
      if (named.error) return { ok: false, error: named.error };
      const zoned = await updateOrgTimezone(orgId, timezone);
      if (zoned.error) return { ok: false, error: zoned.error };
      return { ok: true };
    });
  }

  return (
    <SetupCard>
      <StepIntro title="Your organization.">Fix anything, then keep going.</StepIntro>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <StepBody>
          <BrandField id="org-name" label="Organization name">
            <BrandInput
              id="org-name"
              value={name}
              maxLength={80}
              placeholder="Organization name"
              aria-invalid={name.trim() === "" || undefined}
              onChange={(e) => setName(e.target.value)}
            />
          </BrandField>
          <BrandField id="org-slug" label="Web address" aside="Change it in Settings › General.">
            <BrandInput id="org-slug" value={`/app/${slug}`} readOnly className="font-mono" />
          </BrandField>
          <BrandField id="org-timezone" label="Time zone">
            <FieldSelect
              id="org-timezone"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className={cn(brandInputClass, "cursor-pointer")}
            >
              {zones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replace(/_/g, " ")}
                </option>
              ))}
            </FieldSelect>
          </BrandField>
        </StepBody>
        <StepError message={error} />
        <StepFooter>
          <ContinuePill type="submit" pending={pending} disabled={name.trim() === ""} />
        </StepFooter>
      </form>
    </SetupCard>
  );
}
