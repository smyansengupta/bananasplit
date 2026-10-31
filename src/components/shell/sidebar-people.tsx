"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { presenceBeatAction } from "@/app/app/[orgSlug]/_shell/presence-actions";
import { fadeLabel, surfaceTone, useSidebarMode } from "@/components/shell/sidebar-mode-context";
import { UserAvatar, type UserAvatarUser } from "@/components/user-avatar";
import { cn } from "@/lib/utils";

export interface SidebarPeopleData {
  /** Everyone here now, you included. */
  count: number;
  /** A few of the others here now, most recently seen first. */
  faces: (UserAvatarUser & { id: string })[];
}

/** How often the open app says you're here (as HEARTBEAT_MS, src/server/presence.ts). */
const BEAT_MS = 60_000;

/**
 * Who's here now, at the sidebar's foot over the logo: the faces of the
 * others online and how many of you there are, opening People. While the
 * tab is open and visible it marks you here once a minute and refreshes the
 * list (src/server/presence.ts); a hidden tab stops, so you drop off after
 * a couple of minutes away. Folds away on the rail.
 */
export function SidebarPeople({
  orgId,
  orgSlug,
  people: initial,
  onNavigate,
}: {
  orgId: string;
  orgSlug: string;
  people: SidebarPeopleData;
  onNavigate?: () => void;
}) {
  const { rail, chrome } = useSidebarMode();
  const tone = surfaceTone(chrome);
  const [people, setPeople] = useState(initial);

  useEffect(() => {
    let live = true;
    const beat = () => {
      if (document.visibilityState !== "visible") return;
      presenceBeatAction(orgId)
        .then((next) => {
          if (live) setPeople(next);
        })
        .catch(() => {});
    };
    beat();
    const timer = setInterval(beat, BEAT_MS);
    document.addEventListener("visibilitychange", beat);
    return () => {
      live = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", beat);
    };
  }, [orgId]);

  const alone = people.count <= 1;
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
      {alone ? (
        <span aria-hidden="true" className="grid size-5 shrink-0 place-items-center">
          <span className="bg-success size-2 rounded-full" />
        </span>
      ) : (
        <span className="flex shrink-0">
          {people.faces.map((face, i) => (
            <span key={face.id} className={cn("relative", i > 0 && "-ml-1.5")}>
              <UserAvatar user={face} size="xs" className="ring-sidebar ring-2" />
            </span>
          ))}
        </span>
      )}
      <span className={cn("min-w-0 truncate", fadeLabel(rail))}>
        {alone ? "Just you here now" : `${people.count} here now`}
      </span>
    </Link>
  );
}
