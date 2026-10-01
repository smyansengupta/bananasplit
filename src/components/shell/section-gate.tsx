"use client";

import { EyeOff } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { EmptyState } from "@/components/empty-state";

/**
 * A section the org turned off in Settings › Sidebar: members get a notice
 * instead of the page (it isn't a permission; the data rules are the same).
 * Owners and admins still see the page, with a reminder that it's hidden.
 */
export function SectionGate({
  orgSlug,
  sectionPaths,
  isAdmin,
  children,
}: {
  orgSlug: string;
  /** Every section's path, and whether the org hid it. */
  sectionPaths: readonly { path: string; hidden: boolean }[];
  isAdmin: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const base = `/app/${orgSlug}`;
  // The most specific section wins: Polls lives under Calendar, and each
  // can be on or off by itself.
  const match = sectionPaths
    .filter((s) => s.path && (pathname === `${base}${s.path}` || pathname.startsWith(`${base}${s.path}/`)))
    .sort((a, b) => b.path.length - a.path.length)[0];
  if (!match?.hidden) return <>{children}</>;
  if (isAdmin) {
    return (
      <div className="space-y-4">
        <p className="bg-muted/50 text-muted-foreground flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
          <EyeOff className="size-4 shrink-0" aria-hidden="true" />
          This section is hidden from members.{" "}
          <Link href={`${base}/settings/sidebar`} className="underline underline-offset-2">
            Sidebar settings
          </Link>
        </p>
        {children}
      </div>
    );
  }
  return (
    <EmptyState
      icon={EyeOff}
      title="This section is turned off"
      description="Your club's admins turned it off for this organization."
      action={
        <Link href={base} className="text-sm underline underline-offset-4">
          Back to the Overview
        </Link>
      }
    />
  );
}
