"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo, useState, useTransition } from "react";

import { BrandField, BrandInput, brandInputClass } from "@/components/brand/fields";
import {
  ContinuePill,
  SetupCard,
  StepBody,
  StepError,
  StepFooter,
  StepIntro,
} from "@/components/onboarding/setup-shell";
import { slugify } from "@/lib/slug";
import { timeZoneOptions } from "@/lib/timezones";
import { cn } from "@/lib/utils";

import { checkSlugAvailability, createOrganizationAction } from "../actions";
import { FieldSelect } from "@/components/ui/field-select";
import { TRIAL_DAYS } from "@/lib/billing/space";
import { START_HREF } from "@/lib/onboarding/steps";
import { usePreviewNext } from "@/components/onboarding/preview-flow";
import { clearInvalid, highlightInvalid } from "@/lib/forms/highlight-invalid";

/**
 * Basics: the organization's name, web address and time zone. Creating it
 * makes the signed-in person its owner and starts its trial; they then join
 * it like anyone (about you, bio, role, review) and set it up. The server
 * re-checks the creation policy, the code, the URL and the limits.
 */
export function ClubBasicsStep({
  requiresCode,
  notice,
}: {
  requiresCode: boolean;
  /** Why this person can't create a club yet, in place of the fields. */
  notice?: React.ReactNode;
}) {
  const [state, formAction, isPending] = useActionState(createOrganizationAction, {});
  const router = useRouter();
  const preview = usePreviewNext();
  const [name, setName] = useState("");
  const [manualSlug, setManualSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [slugStatus, setSlugStatus] = useState<"idle" | "available" | "taken">("idle");
  const [checking, startCheck] = useTransition();
  const zones = useMemo(() => timeZoneOptions(), []);
  const [timezone, setTimezone] = useState("UTC");

  useEffect(() => {
    try {
      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the browser zone is only known on the client
      if (detected && zones.includes(detected)) setTimezone(detected);
    } catch {
      // keep UTC
    }
  }, [zones]);

  // Nothing to check until there's a name (slugify falls back to "org").
  const slug = slugEdited ? manualSlug : name.trim() ? slugify(name) : "";

  useEffect(() => {
    if (!slug) return;
    const handle = setTimeout(() => {
      startCheck(async () => {
        // The dev preview has no database to ask: every address is free there.
        setSlugStatus(preview || (await checkSlugAvailability(slug)) ? "available" : "taken");
      });
    }, 400);
    return () => clearTimeout(handle);
  }, [slug, preview]);

  const taken = Boolean(slug) && !checking && slugStatus === "taken";
  const available = Boolean(slug) && !checking && slugStatus === "available";

  return (
    <SetupCard>
      <StepIntro title="Name your organization.">
        You&apos;ll be its owner, and its {TRIAL_DAYS} days of Team Advanced start now, free, with
        no card. You can change all of this later.
      </StepIntro>

      {notice ? (
        <StepBody>{notice}</StepBody>
      ) : (
        <form
          action={formAction}
          noValidate
          onInput={clearInvalid}
          onSubmit={(e) => {
            // Empty fields are outlined in red, not the browser's bubble.
            if (highlightInvalid(e)) return;
            // The dev preview creates nothing: on to the next screen.
            if (!preview) return;
            e.preventDefault();
            router.push(preview);
          }}
          className="flex flex-1 flex-col"
        >
          <input type="hidden" name="flow" value="onboarding" />
          <StepBody className="gap-5">
            <BrandField id="org-name" label="Organization name">
              <BrandInput
                id="org-name"
                name="name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Organization name"
                autoComplete="organization"
              />
            </BrandField>
            <BrandField
              id="org-slug"
              label="Web address"
              aside={
                <span
                  aria-live="polite"
                  className={cn(
                    "text-[13px] font-medium",
                    taken
                      ? "text-destructive"
                      : available
                        ? "text-tint-success-foreground"
                        : "text-muted-foreground",
                  )}
                >
                  {slug && checking
                    ? "Checking…"
                    : taken
                      ? "Already taken"
                      : available
                        ? "Available"
                        : ""}
                </span>
              }
            >
              <div className="bg-card border-input focus-within-banana rounded-field has-aria-invalid:border-destructive has-aria-invalid:ring-destructive/15 flex h-10 items-center border pl-4 text-[15px] transition-shadow has-aria-invalid:ring-3">
                <span className="text-muted-foreground font-mono text-[13px]">/app/</span>
                <input
                  id="org-slug"
                  name="slug"
                  required
                  value={slug}
                  onChange={(e) => {
                    setManualSlug(slugify(e.target.value));
                    setSlugEdited(true);
                  }}
                  placeholder="web-address"
                  aria-invalid={taken || undefined}
                  className="h-full min-w-0 flex-1 bg-transparent pr-4 pl-0.5 outline-none"
                />
              </div>
            </BrandField>
            <BrandField id="org-timezone" label="Time zone">
              <FieldSelect
                id="org-timezone"
                name="timezone"
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
            {requiresCode && (
              <BrandField id="org-code" label="Organization creation code">
                <BrandInput
                  id="org-code"
                  name="code"
                  required
                  autoComplete="off"
                  placeholder="Creation code"
                  className="font-mono uppercase"
                />
                <span className="text-muted-foreground text-[13px]">
                  A single-use code from a platform admin. Codes expire after 14 days.
                </span>
              </BrandField>
            )}
          </StepBody>
          <StepError message={state.error} />
          <StepFooter back={{ href: START_HREF }}>
            <ContinuePill
              type="submit"
              pending={isPending}
              disabled={taken}
              pendingLabel="Creating…"
            />
          </StepFooter>
        </form>
      )}

      {notice && <StepFooter back={{ href: START_HREF }}>{null}</StepFooter>}
    </SetupCard>
  );
}
