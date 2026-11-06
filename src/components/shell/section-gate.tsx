"use client";

import { EyeOff, LayoutGrid } from "@/components/icons";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { AddAddOnButton } from "@/components/addons/addon-controls";
import { EmptyState } from "@/components/empty-state";
import { isAddOn } from "@/lib/addons";

/**
 * A section the org turned off in Admin panel › Sidebar: members get a notice
 * instead of the page (it isn't a permission; the data rules are the same).
 * Owners and admins still see the page, with a reminder that it's hidden.
 *
 * An add-on the organization hasn't added (src/lib/addons.ts) works the same
 * way, with Add right there for owners and admins. Treasurers keep Finance's
 * pages (an approval email still opens), and anyone keeps their own
 * reimbursements, so turning Finance off never strands money someone is owed.
 */
export function SectionGate({
  orgId,
  orgSlug,
  role,
  sectionPaths,
  isAdmin,
  children,
}: {
  orgId: string;
  orgSlug: string;
  role: string | null;
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
  if (match.notAdded && match.id && isAddOn(match.id)) {
    const id = match.id;
    const name = match.label ?? "This add-on";
    if (pathname.startsWith(`${base}/finance/my-reimbursements`)) return <>{children}</>;
    if (isAdmin || (id === "finance" && role === "TREASURER")) {
      return (
        <div className="space-y-4">
          <div className="bg-muted/50 text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2 text-sm">
            <LayoutGrid className="size-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              {name} isn&apos;t added, so it&apos;s hidden from the sidebar.
            </span>
            {isAdmin && <AddAddOnButton orgId={orgId} orgSlug={orgSlug} id={id} size="sm" />}
          </div>
          {children}
        </div>
      );
    }
    return (
      <EmptyState
        icon={LayoutGrid}
        title={`${name} isn't added`}
        description="It's an add-on. Ask an owner or admin to add it."
        action={
          <Link href={base} className="text-sm underline underline-offset-4">
            Back to Home
          </Link>
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
          Back to Home
        </Link>
      }
    />
  );
}
