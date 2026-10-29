"use client";

import { KeyRound } from "@/components/icons";
import Link from "next/link";
import { useTransition } from "react";

import { switchActiveOrg } from "@/app/app/actions";
import { OrgMark, orderSpaces } from "@/components/shell/org-switcher";
import { GroupLabel, ICON_STROKE } from "@/components/shell/sidebar-nav";
import { surfaceTone, useSidebarMode } from "@/components/shell/sidebar-mode-context";
import type { OrgSummary, ShellUser } from "@/components/shell/types";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";

/**
 * Personal and every club, under the pins: one click from a club back to
 * Personal, or across to another club, without opening the menu at the top
 * (docs/features/personal-and-clubs.md, "Switching"). The space you're in is
 * marked; the menu keeps the rest (pending deletion, Start a club). The rail
 * folds this away: its club tile opens the menu instead.
 */
export function SpaceList({
  orgs,
  activeSlug,
  user,
  onNavigate,
}: {
  orgs: OrgSummary[];
  activeSlug: string;
  user: ShellUser;
  onNavigate?: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const { chrome } = useSidebarMode();
  const tone = surfaceTone(chrome);
  const spaces = orderSpaces(orgs.filter((o) => !o.pendingDeletion));
  const hasClubs = spaces.some((o) => o.kind !== "PERSONAL");
  const row = cn(
    "focus-glow flex h-9 items-center gap-2.5 rounded-full px-2.5 text-sm whitespace-nowrap outline-none transition-colors",
  );

  return (
    <div aria-busy={pending || undefined} className="flex flex-col gap-0.5">
      <GroupLabel label="Personal & orgs" />
      <ul className="flex max-h-40 flex-col gap-0.5 overflow-y-auto">
        {spaces.map((org) => {
          const current = org.slug === activeSlug;
          const name = org.kind === "PERSONAL" ? "Personal" : org.name;
          return (
            <li key={org.slug}>
              <Link
                href={`/app/${org.slug}`}
                aria-current={current ? "true" : undefined}
                onClick={(event) => {
                  // A plain click remembers the space (Home opens it next time);
                  // a modified click opens it in a new tab as a link would. The
                  // space you're in just goes to its home page.
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) {
                    return;
                  }
                  onNavigate?.();
                  if (current) return;
                  event.preventDefault();
                  startTransition(() => switchActiveOrg(org.slug));
                }}
                className={cn(
                  row,
                  current
                    ? cn(
                        "font-semibold",
                        chrome ? "text-chrome-foreground" : "text-sidebar-foreground",
                      )
                    : cn(tone.text, tone.hover),
                )}
              >
                {org.kind === "PERSONAL" ? (
                  <UserAvatar user={user} size="xs" className="shrink-0" />
                ) : (
                  <OrgMark org={org} className="size-5" />
                )}
                <span className="min-w-0 flex-1 truncate">{name}</span>
                {current && (
                  <>
                    <span className="bg-glow size-1.5 shrink-0 rounded-full" aria-hidden="true" />
                    <span className="sr-only"> (you&apos;re here)</span>
                  </>
                )}
              </Link>
            </li>
          );
        })}
        {!hasClubs && (
          <li>
            <Link
              href="/onboarding/join"
              onClick={onNavigate}
              className={cn(row, tone.text, tone.hover)}
            >
              <KeyRound className="size-4 shrink-0" strokeWidth={ICON_STROKE} aria-hidden="true" />
              Join an organization
            </Link>
          </li>
        )}
      </ul>
    </div>
  );
}
