"use client";

import { useEffect } from "react";

import { presenceBeatAction } from "@/app/app/[orgSlug]/_shell/presence-actions";
import { publishOnline, type OnlinePeople } from "@/components/shell/presence-store";

/** How often the open app says you're here (as HEARTBEAT_MS, src/server/presence.ts). */
const BEAT_MS = 60_000;

/**
 * You, here: while the tab is open and visible it marks you here once a
 * minute and fetches who else is (src/server/presence.ts); a hidden tab
 * stops, so you drop off after a couple of minutes away. Each answer is
 * published (presence-store.ts) for what shows it: Overview's members
 * online and People's dots. Draws nothing.
 */
export function PresenceBeat({ orgId }: { orgId: string }) {
  useEffect(() => {
    let live = true;
    const beat = () => {
      if (document.visibilityState !== "visible") return;
      presenceBeatAction(orgId)
        .then((next: OnlinePeople) => {
          if (live) publishOnline(orgId, next);
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
  return null;
}
