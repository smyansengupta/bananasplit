"use client";

import { Calendar, LayoutGrid, ListChecks, X } from "@/components/icons";
import type { ReactNode } from "react";

import { LogoForm } from "@/app/app/[orgSlug]/settings/general/general-forms";
import { CoreMark } from "@/components/brand/logo";
import {
  ContinuePill,
  SetupCard,
  StepBody,
  StepError,
  StepFooter,
  StepIntro,
} from "@/components/onboarding/setup-shell";

import { useNextStep, type SetupStepProps } from "./step-flow";

/** The logo at `size` px: the uploaded picture, or the name's initial until there is one. */
function Mark({ name, logoUrl, size }: { name: string; logoUrl: string | null; size: number }) {
  return logoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element -- the uploaded logo, blob-hosted
    <img
      src={logoUrl}
      alt=""
      width={size}
      height={size}
      className="flex-none rounded-[25%] object-cover"
      style={{ width: size, height: size }}
    />
  ) : (
    <span
      className="bg-foreground text-background grid flex-none place-items-center rounded-[25%] font-bold"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }}
    >
      {name.trim().charAt(0).toUpperCase() || "A"}
    </span>
  );
}

/** One place the logo shows: a small picture of it there, and its name under it. */
function Place({ label, children }: { label: string; children: ReactNode }) {
  return (
    <figure className="m-0 flex min-w-0 flex-col gap-2">
      <div className="bg-muted/70 flex h-[132px] flex-col justify-center rounded-[16px] p-3">
        {children}
      </div>
      <figcaption className="text-muted-foreground text-center text-[12px] font-medium">
        {label}
      </figcaption>
    </figure>
  );
}

/**
 * Picture: the organization's logo (Organization.logo), the same upload and
 * crop as Settings › General, dropped or picked. Under it, the places it
 * shows (the sidebar, an invite, the browser tab), drawn with the real logo
 * as soon as it's uploaded, or the initial until then. It saves as soon as
 * it's cropped; Continue just moves on.
 */
export function PictureStep(props: SetupStepProps & { name: string; logoUrl: string | null }) {
  const { backHref, orgId, name, logoUrl } = props;
  const { pending, error, next, skip } = useNextStep(props, "picture");
  const org = name.trim() || "Your organization";

  return (
    <SetupCard>
      <StepIntro title="Add your logo.">Your team sees it everywhere they work.</StepIntro>
      <StepBody className="gap-5">
        <LogoForm orgId={orgId} logoUrl={logoUrl} orgName={name} canEdit bare />

        <div aria-hidden="true" className="grid gap-3 sm:grid-cols-3">
          <Place label="Sidebar">
            <span className="bg-card flex flex-col gap-1 rounded-[12px] p-2 shadow-[var(--elevation-1)]">
              <span className="flex items-center gap-2 px-1 pb-1">
                <Mark name={org} logoUrl={logoUrl} size={22} />
                <span className="truncate text-[12px] font-bold">{org}</span>
              </span>
              {[
                { icon: LayoutGrid, label: "Overview", on: true },
                { icon: ListChecks, label: "Tasks", on: false },
                { icon: Calendar, label: "Calendar", on: false },
              ].map(({ icon: Icon, label, on }) => (
                <span
                  key={label}
                  className={`flex items-center gap-1.5 rounded-[7px] px-1.5 py-1 text-[11px] font-semibold ${on ? "bg-muted" : "text-muted-foreground"}`}
                >
                  <Icon className="size-3" />
                  {label}
                </span>
              ))}
            </span>
          </Place>

          <Place label="Invites">
            <span className="bg-card flex flex-col items-center gap-1.5 rounded-[12px] p-3 text-center shadow-[var(--elevation-1)]">
              <Mark name={org} logoUrl={logoUrl} size={30} />
              <span className="text-[11px] leading-tight">
                You&apos;re invited to <b className="font-bold">{org}</b>
              </span>
              <span className="bg-foreground text-background rounded-full px-2.5 py-0.5 text-[10px] font-semibold">
                Join
              </span>
            </span>
          </Place>

          <Place label="Browser tab">
            <span className="flex flex-col gap-0">
              <span className="bg-card flex items-center gap-1.5 rounded-t-[10px] px-2 py-1.5 shadow-[var(--elevation-1)]">
                <Mark name={org} logoUrl={logoUrl} size={14} />
                <span className="min-w-0 flex-1 truncate text-[11px] font-semibold">{org}</span>
                <X className="text-muted-foreground size-3" />
              </span>
              <span className="bg-card/60 flex items-center gap-1.5 rounded-b-[10px] px-2 py-2">
                <CoreMark size={12} />
                <span className="bg-muted h-1.5 flex-1 rounded-full" />
              </span>
            </span>
          </Place>
        </div>
      </StepBody>
      <StepError message={error} />
      <StepFooter
        back={backHref ? { href: backHref } : undefined}
        skip={logoUrl ? undefined : { onClick: skip, disabled: pending }}
      >
        <ContinuePill pending={pending} onClick={() => next()} />
      </StepFooter>
    </SetupCard>
  );
}
