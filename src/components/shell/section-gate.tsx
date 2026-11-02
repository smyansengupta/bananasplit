"use client";

import { EyeOff, LayoutGrid } from "@/components/icons";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { EmptyState } from "@/components/empty-state";

/**
 * A section the org turned off in Admin panel › Sidebar: members get a notice
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
  /** Every section's paths, and whether the org hid it. */
  sectionPaths: readonly {
    id?: string;
    path: string;
    also?: readonly string[];
    hidden: boolean;
    /** An add-on the organization hasn't added (src/lib/addons.ts). */
    notAdded?: boolean;
    label?: string;
  }[];
  isAdmin: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const base = `/app/${orgSlug}`;
  // The most specific section wins: Polls lives under Calendar, and each
  // can be on or off by itself.
  const match = sectionPaths
    .flatMap((s) =>
      [s.path, ...(s.also ?? [])].map((path) => ({
        path,
        hidden: s.hidden,
        notAdded: s.notAdded ?? false,
        id: s.id,
        label: s.label,
      })),
    )
    .filter(
      (s) =>
        s.path && (pathname === `${base}${s.path}` || pathname.startsWith(`${base}${s.path}/`)),
    )
    .sort((a, b) => b.path.length - a.path.length)[0];
  if (!match?.hidden) return <>{children}</>;
  // An add-on nobody has added yet: its page says what it is, and how to add it.
  if (match.notAdded && match.id) {
    return (
      <EmptyState
        icon={LayoutGrid}
        title={`${match.label ?? "This"} isn't added yet`}
        description={
          isAdmin
            ? "It's an add-on. See what it does and add it in one click."
            : "It's an add-on. Ask an owner or admin to add it."
        }
        action={
          isAdmin ? (
            <Link
              href={`${base}/integrations/${match.id}`}
              className="text-sm underline underline-offset-4"
            >
              See {match.label ?? "it"}
            </Link>
          ) : (
            <Link href={base} className="text-sm underline underline-offset-4">
              Back to Home
            </Link>
          )
        }
      />
    );
  }
  if (isAdmin) {
    return (
      <div className="space-y-4">
        <p className="bg-muted/50 text-muted-foreground flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
          <EyeOff className="size-4 shrink-0" aria-hidden="true" />
          This section is hidden from members.{" "}
          <Link href={`${base}/settings/sidebar`} className="underline underline-offset-2">
            Admin panel › Sidebar
          </Link>
        </p>
        {children}
      </div>
    );
  }
  return (
    <EmptyState
      title="This section is turned off"
      description="Your organization's admins turned it off."
      action={
        <Link href={base} className="text-sm underline underline-offset-4">
          Back to the Overview
        </Link>
      }
    />
  );
}
