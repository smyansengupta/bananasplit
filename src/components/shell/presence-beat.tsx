"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { presenceBeatAction } from "@/app/app/[orgSlug]/_shell/presence-actions";
import { publishOnline, type OnlinePeople } from "@/components/shell/presence-store";

/** How often the open app says you're here (as HEARTBEAT_MS, src/server/presence.ts). */
const BEAT_MS = 60_000;

/** Moving to another page beats early, but not more often than this. */
const MOVE_BEAT_MS = 20_000;

/**
 * You, here: while the tab is open and visible it marks you here once a
 * minute, on the page you have open, and fetches who else is
 * (src/server/presence.ts); a hidden tab stops, so you drop off after a
 * couple of minutes away. Opening another page beats early (at most every
 * 20 seconds), so Home's "Here now" follows you; that beat only marks you,
 * and the minute's beat answers who else is here. Each answer is published
 * (presence-store.ts) for what shows it: Overview's members online and
 * People's dots. Draws nothing.
 */
export function PresenceBeat({ orgId }: { orgId: string }) {
  const pathname = usePathname();
  const last = useRef(0);
  const beatRef = useRef<(moved: boolean) => void>(() => {});

  useEffect(() => {
    let live = true;
    const beat = (moved: boolean) => {
      if (document.visibilityState !== "visible") return;
      last.current = Date.now();
      presenceBeatAction(orgId, window.location.pathname, moved)
        .then((next: OnlinePeople | null) => {
          if (live && next) publishOnline(orgId, next);
        })
        .catch(() => {});
    };
    const onTimer = () => beat(false);
    beatRef.current = beat;
    onTimer();
    const timer = setInterval(onTimer, BEAT_MS);
    document.addEventListener("visibilitychange", onTimer);
    return () => {
      live = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onTimer);
    };
  }, [orgId]);

  useEffect(() => {
    if (Date.now() - last.current >= MOVE_BEAT_MS) beatRef.current(true);
  }, [pathname]);

  return null;
}
