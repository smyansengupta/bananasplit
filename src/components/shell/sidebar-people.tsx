"use client";

import Link from "next/link";

import { fadeLabel, surfaceTone, useSidebarMode } from "@/components/shell/sidebar-mode-context";
import { UserAvatar, type UserAvatarUser } from "@/components/user-avatar";
import { cn } from "@/lib/utils";

export interface SidebarPeopleData {
  /** Everyone in the organization, you included. */
  count: number;
  /** A few of the others, newest first. */
  faces: (UserAvatarUser & { id: string })[];
}

/**
 * Who's in the organization, at the sidebar's foot over the logo: a few
 * faces and the count, opening People. Folds away on the rail.
 */
export function SidebarPeople({
  orgSlug,
  people,
  onNavigate,
}: {
  orgSlug: string;
  people: SidebarPeopleData;
  onNavigate?: () => void;
}) {
  const { rail, chrome } = useSidebarMode();
  const tone = surfaceTone(chrome);
  if (people.count < 2) return null;
  return (
    <Link
      href={`/app/${orgSlug}/people`}
      onClick={onNavigate}
      tabIndex={rail ? -1 : undefined}
      aria-hidden={rail || undefined}
      className={cn(
        "focus-glow flex h-8 shrink-0 items-center gap-2 overflow-hidden rounded-[7px] px-2 text-xs whitespace-nowrap outline-none",
        "transition-opacity duration-300 motion-reduce:transition-none",
        tone.text,
        tone.hover,
        rail && "pointer-events-none opacity-0",
      )}
    >
      <span className="flex shrink-0">
        {people.faces.map((face, i) => (
          <UserAvatar
            key={face.id}
            user={face}
            size="xs"
            className={cn("ring-sidebar ring-2", i > 0 && "-ml-1.5")}
          />
        ))}
      </span>
      <span className={cn("min-w-0 truncate", fadeLabel(rail))}>
        {people.count} {people.count === 1 ? "member" : "members"}
      </span>
    </Link>
  );
}
