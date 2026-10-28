"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";

import { BrandField, BrandInput, brandInputClass } from "@/components/brand/fields";
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
import { slugify } from "@/lib/slug";
import { timeZoneOptions } from "@/lib/timezones";
import { cn } from "@/lib/utils";

import { checkSlugAvailability, createOrganizationAction } from "../actions";

/** What a new club's sidebar opens with, for the preview. */
const SPACES = [
  "Overview",
  "Tasks",
  "Calendar",
  "Notes",
  "Databases",
  "Finance",
  "People",
] as const;

/**
 * B1 · Club basics: the club's name, web address and time zone. Creating it
 * makes the signed-in person its owner; B2 follows under the new URL. The
 * server re-checks the creation policy, the code, the URL and the limits.
 */
export function ClubBasicsStep({
  index,
  total,
  requiresCode,
  notice,
}: {
  index: number;
  total: number;
  requiresCode: boolean;
  /** Why this person can't create a club yet, in place of the fields. */
  notice?: React.ReactNode;
}) {
  const [state, formAction, isPending] = useActionState(createOrganizationAction, {});
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
        setSlugStatus((await checkSlugAvailability(slug)) ? "available" : "taken");
      });
    }, 400);
    return () => clearTimeout(handle);
  }, [slug]);

  const taken = Boolean(slug) && !checking && slugStatus === "taken";
  const available = Boolean(slug) && !checking && slugStatus === "available";
  const clubName = name.trim() || "Your organization";

  return (
    <SetupCard
      preview={
        <>
          <PreviewHeader meta="Your organization's home" />
          <PreviewTile className="flex-row items-center gap-3">
            <span className="bg-primary text-primary-foreground font-heading rounded-field grid size-11 flex-none place-items-center text-[20px]">
              {clubName[0]?.toUpperCase()}
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-[15px] font-bold">{clubName}</span>
              <span className="text-muted-foreground truncate font-mono text-[12px]">
                /app/{slug || "your-org"}
              </span>
            </span>
          </PreviewTile>
          <PreviewTile className="gap-1 p-2">
            {SPACES.map((space, i) => (
              <span
                key={space}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[14px] font-semibold",
                  i === 0 ? "bg-muted text-foreground" : "text-muted-foreground",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-2 rounded-full",
                    i === 0 ? "bg-brand-accent" : "bg-foreground/15",
                  )}
                />
                {space}
              </span>
            ))}
          </PreviewTile>
          <p className="text-muted-foreground m-0 mt-auto text-[12px] leading-normal">
            Meetings, reminders and reports use {timezone.replace(/_/g, " ")} time.
          </p>
        </>
      }
    >
      <StepIntro index={index} total={total} title="Let's start with the basics.">
        You&apos;ll be the organization&apos;s admin. Everything here can be changed later in the
        Admin panel.
      </StepIntro>

      {notice ? (
        <StepBody>{notice}</StepBody>
      ) : (
        <form action={formAction} className="flex flex-1 flex-col">
          <input type="hidden" name="flow" value="onboarding" />
          <StepBody className="gap-5">
            <BrandField id="org-name" label="Organization name">
              <BrandInput
                id="org-name"
                name="name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Riverside Robotics"
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
              <div className="bg-card border-input focus-within-banana rounded-field flex h-10 items-center border pl-4 text-[15px] transition-shadow">
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
                  aria-invalid={taken || undefined}
                  className="h-full min-w-0 flex-1 bg-transparent pr-4 pl-0.5 outline-none"
                />
              </div>
            </BrandField>
            <BrandField id="org-timezone" label="Time zone">
              <select
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
              </select>
            </BrandField>
            {requiresCode && (
              <BrandField id="org-code" label="Organization creation code">
                <BrandInput
                  id="org-code"
                  name="code"
                  required
                  autoComplete="off"
                  placeholder="XXXX-XXXX-XXXX-XXXX"
                  className="font-mono uppercase"
                />
                <span className="text-muted-foreground text-[13px]">
                  A single-use code from a platform admin. Codes expire after 14 days.
                </span>
              </BrandField>
            )}
          </StepBody>
          <StepError message={state.error} />
          <StepFooter back={{ href: "/onboarding" }}>
            <ContinuePill
              type="submit"
              pending={isPending}
              disabled={taken}
              pendingLabel="Creating…"
            />
          </StepFooter>
        </form>
      )}

      {notice && <StepFooter back={{ href: "/onboarding" }}>{null}</StepFooter>}
    </SetupCard>
  );
}
