"use client";

import { useEffect, useState } from "react";

import { AvatarEditor } from "@/app/app/[orgSlug]/profile/avatar-editor";
import { TimezoneSelect } from "@/app/app/[orgSlug]/profile/timezone-select";
import { Chip, FieldError } from "@/components/onboarding/step-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { UserAvatarUser } from "@/components/user-avatar";
import { PRONOUN_CHOICES } from "@/lib/onboarding/steps";
import { PROFILE_LIMITS } from "@/lib/profile/schema";
import { isValidTimeZone } from "@/lib/profile/timezone";

import { saveBasicsStep } from "./actions";
import { StepNav, useStepSave } from "./step-nav";

/** A1 · Basics: picture, full name, pronouns, time zone. */
export function BasicsStep({
  user,
  initial,
}: {
  user: UserAvatarUser;
  initial: { name: string; pronouns: string; timezone: string | null };
}) {
  const { pending, errors, saveAndContinue } = useStepSave("basics");
  const [name, setName] = useState(initial.name);
  const preset = (PRONOUN_CHOICES as readonly string[]).includes(initial.pronouns);
  const [pronouns, setPronouns] = useState(initial.pronouns);
  const [custom, setCustom] = useState(!preset && initial.pronouns !== "");
  const [timezone, setTimezone] = useState<string | null>(initial.timezone);
  const [detected, setDetected] = useState(false);

  // "Eastern Time (detected)": the device's zone, until they pick another.
  useEffect(() => {
    if (initial.timezone) return;
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (isValidTimeZone(zone)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the browser zone is only known on the client
      setTimezone(zone);
      setDetected(true);
    }
  }, [initial.timezone]);

  function submit() {
    saveAndContinue(() => saveBasicsStep({ name, pronouns: pronouns || null, timezone }));
  }

  return (
    <div className="space-y-4">
      <AvatarEditor user={user} compact />

      <div className="grid gap-1.5">
        <Label htmlFor="ob-name" className="text-xs">
          Full name
        </Label>
        <Input
          id="ob-name"
          value={name}
          maxLength={PROFILE_LIMITS.name}
          autoComplete="name"
          onChange={(e) => setName(e.target.value)}
          aria-invalid={Boolean(errors.name) || undefined}
        />
        <FieldError message={errors.name} />
      </div>

      <div className="grid gap-1.5">
        <span className="text-xs font-medium" id="ob-pronouns-label">
          Pronouns
        </span>
        <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby="ob-pronouns-label">
          {PRONOUN_CHOICES.map((p) => (
            <Chip
              key={p}
              selected={!custom && pronouns === p}
              onClick={() => {
                setCustom(false);
                setPronouns(pronouns === p ? "" : p);
              }}
            >
              {p}
            </Chip>
          ))}
          <Chip
            selected={custom}
            onClick={() => {
              setCustom(!custom);
              if (!custom) setPronouns("");
            }}
          >
            Custom
          </Chip>
        </div>
        {custom && (
          <Input
            aria-label="Your pronouns"
            placeholder="e.g. he/they"
            value={pronouns}
            maxLength={PROFILE_LIMITS.pronouns}
            onChange={(e) => setPronouns(e.target.value)}
            autoFocus
          />
        )}
        <FieldError message={errors.pronouns} />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="ob-tz" className="text-xs">
          Time zone
        </Label>
        <TimezoneSelect
          id="ob-tz"
          value={timezone}
          orgTimezone={null}
          onChange={(zone) => {
            setTimezone(zone);
            setDetected(false);
          }}
          invalid={Boolean(errors.timezone)}
        />
        {detected && <p className="text-muted-foreground text-xs">Detected from this device.</p>}
        <FieldError message={errors.timezone} />
      </div>

      <FieldError message={errors.form} />
      <StepNav step="basics" pending={pending} onContinue={submit} disabled={!name.trim()} />
    </div>
  );
}
