"use client";

import { Loader2 } from "lucide-react";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PROFILE_LIMITS, profileDetailsSchema, profileFieldErrors } from "@/lib/profile/schema";

import { saveProfileDetails } from "./actions";
import { TimezoneSelect } from "./timezone-select";

export interface DetailsInitial {
  name: string;
  pronouns: string;
  major: string;
  gradYear: string;
  bio: string;
  timezone: string | null;
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-destructive text-sm">
      {message}
    </p>
  );
}

/** Name, pronouns, major and year, bio and timezone. */
export function DetailsForm({
  initial,
  orgTimezone,
}: {
  initial: DetailsInitial;
  orgTimezone: string;
}) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function set<K extends keyof DetailsInitial>(key: K, value: DetailsInitial[K]) {
    setValues((v) => ({ ...v, [key]: value }));
    setSaved(false);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedYear = values.gradYear.trim();
    const input = {
      name: values.name,
      pronouns: values.pronouns,
      major: values.major,
      gradYear: trimmedYear === "" ? null : Number(trimmedYear),
      bio: values.bio,
      timezone: values.timezone,
    };
    const local = profileDetailsSchema.safeParse(input);
    if (!local.success) {
      setErrors(profileFieldErrors(local.error));
      return;
    }
    setErrors({});
    startTransition(async () => {
      const result = await saveProfileDetails(input);
      if (result.ok) setSaved(true);
      else setErrors(result.fieldErrors);
    });
  }

  const describedBy = (key: string, extra?: string) =>
    [errors[key] ? `${key}-error` : null, extra].filter(Boolean).join(" ") || undefined;

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="profile-name">Name</Label>
          <Input
            id="profile-name"
            value={values.name}
            onChange={(e) => set("name", e.target.value)}
            maxLength={PROFILE_LIMITS.name}
            autoComplete="name"
            required
            aria-invalid={Boolean(errors.name) || undefined}
            aria-describedby={describedBy("name")}
          />
          <FieldError id="name-error" message={errors.name} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="profile-pronouns">
            Pronouns <span className="text-muted-foreground font-normal">(optional)</span>
          </Label>
          <Input
            id="profile-pronouns"
            value={values.pronouns}
            onChange={(e) => set("pronouns", e.target.value)}
            maxLength={PROFILE_LIMITS.pronouns}
            placeholder="she/her, they/them…"
            aria-invalid={Boolean(errors.pronouns) || undefined}
            aria-describedby={describedBy("pronouns")}
          />
          <FieldError id="pronouns-error" message={errors.pronouns} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="profile-timezone">Timezone</Label>
          <TimezoneSelect
            id="profile-timezone"
            value={values.timezone}
            orgTimezone={orgTimezone}
            onChange={(tz) => set("timezone", tz)}
            invalid={Boolean(errors.timezone)}
          />
          <FieldError id="timezone-error" message={errors.timezone} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="profile-major">Major</Label>
          <Input
            id="profile-major"
            value={values.major}
            onChange={(e) => set("major", e.target.value)}
            maxLength={PROFILE_LIMITS.major}
            placeholder="Computer Science"
            aria-invalid={Boolean(errors.major) || undefined}
            aria-describedby={describedBy("major")}
          />
          <FieldError id="major-error" message={errors.major} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="profile-year">Graduation year</Label>
          <Input
            id="profile-year"
            value={values.gradYear}
            onChange={(e) => set("gradYear", e.target.value.replace(/[^\d]/g, "").slice(0, 4))}
            inputMode="numeric"
            placeholder="2028"
            aria-invalid={Boolean(errors.gradYear) || undefined}
            aria-describedby={describedBy("gradYear")}
          />
          <FieldError id="gradYear-error" message={errors.gradYear} />
        </div>

        <div className="space-y-2 sm:col-span-2">
          <div className="flex items-baseline justify-between gap-2">
            <Label htmlFor="profile-bio">Bio</Label>
            <span id="bio-count" className="text-muted-foreground text-xs tabular-nums">
              {values.bio.length}/{PROFILE_LIMITS.bio}
            </span>
          </div>
          <Textarea
            id="profile-bio"
            value={values.bio}
            onChange={(e) => set("bio", e.target.value)}
            maxLength={PROFILE_LIMITS.bio}
            rows={4}
            placeholder="What you work on, what you're learning, what people can ask you about."
            aria-invalid={Boolean(errors.bio) || undefined}
            aria-describedby={describedBy("bio", "bio-count")}
          />
          <FieldError id="bio-error" message={errors.bio} />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          Save details
        </Button>
        <p aria-live="polite" className="text-sm">
          {errors.form ? (
            <span className="text-destructive">{errors.form}</span>
          ) : saved ? (
            <span className="text-muted-foreground">Saved.</span>
          ) : null}
        </p>
      </div>
    </form>
  );
}
