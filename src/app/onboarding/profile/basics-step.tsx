"use client";

import { Globe, MessageCircle, PenLine, UserRound } from "@/components/icons";
import { useEffect, useState } from "react";

import { AvatarEditor } from "@/app/app/[orgSlug]/profile/avatar-editor";
import { TimezoneSelect } from "@/app/app/[orgSlug]/profile/timezone-select";
import { Chip, FieldError, FieldLabel } from "@/components/onboarding/step-fields";
import { Input } from "@/components/ui/input";
import type { UserAvatarUser } from "@/components/user-avatar";
import { PRONOUN_CHOICES } from "@/lib/onboarding/steps";
import { PROFILE_LIMITS } from "@/lib/profile/schema";
import { isValidTimeZone } from "@/lib/profile/timezone";

export interface BasicsValue {
  name: string;
  pronouns: string;
  timezone: string | null;
}

/**
 * About you, for the profile form: picture (saved on its own), full name,
 * time zone (detected from the device when there's none yet) and pronouns.
 */
export function BasicsFields({
  user,
  value,
  onChange,
  errors,
  pronouns: askPronouns = true,
}: {
  user: UserAvatarUser;
  value: BasicsValue;
  onChange: (value: BasicsValue) => void;
  errors: Record<string, string>;
  /** Show the pronoun chips (not in a personal workspace). */
  pronouns?: boolean;
}) {
  const { name, pronouns, timezone } = value;
  const set = (patch: Partial<BasicsValue>) => onChange({ ...value, ...patch });
  const preset = (PRONOUN_CHOICES as readonly string[]).includes(pronouns);
  const [custom, setCustom] = useState(!preset && pronouns !== "");

  // The device's zone, until they pick another.
  useEffect(() => {
    if (timezone) return;
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (isValidTimeZone(zone)) {
      onChange({ ...value, timezone: zone });
    }
    // Once, on mount: the zone is filled in from the device a single time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <AvatarEditor user={user} compact />

      <div className="grid gap-1.5">
        <FieldLabel htmlFor="ob-name" icon={UserRound} hidden>
          Full name
        </FieldLabel>
        <Input
          id="ob-name"
          value={name}
          maxLength={PROFILE_LIMITS.name}
          autoComplete="name"
          placeholder="Full name"
          onChange={(e) => set({ name: e.target.value })}
          aria-invalid={Boolean(errors.name) || undefined}
        />
        <FieldError message={errors.name} />
      </div>

      <div className="grid gap-1.5">
        <FieldLabel htmlFor="ob-tz" icon={Globe} hidden>
          Time zone
        </FieldLabel>
        <TimezoneSelect
          id="ob-tz"
          value={timezone}
          orgTimezone={null}
          onChange={(zone) => set({ timezone: zone })}
          invalid={Boolean(errors.timezone)}
        />
        <FieldError message={errors.timezone} />
      </div>
      {askPronouns && (
        <div className="grid gap-1.5">
          <FieldLabel id="ob-pronouns-label" icon={MessageCircle} hidden>
            Pronouns
          </FieldLabel>
          <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby="ob-pronouns-label">
            {PRONOUN_CHOICES.map((p) => (
              <Chip
                key={p}
                selected={!custom && pronouns === p}
                onClick={() => {
                  setCustom(false);
                  set({ pronouns: pronouns === p ? "" : p });
                }}
              >
                {p}
              </Chip>
            ))}
            <Chip
              icon={PenLine}
              selected={custom}
              onClick={() => {
                setCustom(!custom);
                if (!custom) set({ pronouns: "" });
              }}
            >
              Custom
            </Chip>
          </div>
          {custom && (
            <Input
              aria-label="Your pronouns"
              placeholder="Pronouns"
              value={pronouns}
              maxLength={PROFILE_LIMITS.pronouns}
              onChange={(e) => set({ pronouns: e.target.value })}
              autoFocus
            />
          )}
          <FieldError message={errors.pronouns} />
        </div>
      )}
    </>
  );
}
