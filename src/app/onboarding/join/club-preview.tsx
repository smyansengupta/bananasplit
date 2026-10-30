import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * A club before (or right after) joining it: its logo, or its initial on
 * pine, then its name and a line about it. Shared by the code form, the
 * invite link and "Your role in <club>".
 */
export function ClubPreview({
  name,
  logoUrl,
  detail,
  badge,
  className,
}: {
  name: string;
  /** A 64px logo variant (orgLogoUrl), or null for the initial. */
  logoUrl: string | null;
  detail?: ReactNode;
  badge?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "bg-muted border-foreground/8 flex items-center gap-3.5 rounded-2xl border px-4 py-3.5",
        className,
      )}
    >
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- a stored 64px WebP variant
        <img src={logoUrl} alt="" className="rounded-field size-11 flex-none object-cover" />
      ) : (
        <span className="bg-primary text-primary-foreground font-heading rounded-field grid size-11 flex-none place-items-center text-[20px]">
          {name.trim()[0]?.toUpperCase()}
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[16px] font-bold break-words">{name}</span>
        {detail && <span className="text-muted-foreground text-[13px]">{detail}</span>}
      </span>
      {badge}
    </div>
  );
}
