import type { RecentPage } from "@/lib/overview/here-now";
import type { RecentItem } from "@/server/pins";

/**
 * Here now (src/components/overview/here-now.tsx): the pages the viewer
 * opened lately, so the widget can say when someone online is on one of
 * them. The pages come from the page's own listRecent read (passed in);
 * who's online from its onlineNow read, beside the date, and the shell's
 * heartbeat keeps it live.
 */

/** How many recent pages the page reads: Pick up shows the first few, Here now all of them. */
export const HERE_NOW_RECENT = 12;

export interface HereNowData {
  recent: RecentPage[];
  /** Home's own address: everyone lands there, so it's never an overlap. */
  homeHref: string;
  /** When the page was rendered (ISO), for "an hour ago". */
  now: string;
}

export function loadHereNow(
  orgSlug: string,
  { recent, now }: { recent: readonly RecentItem[]; now: Date },
): HereNowData {
  return {
    recent: recent.slice(0, HERE_NOW_RECENT).map((r) => ({
      href: r.href,
      label: r.label,
      visitedAt: r.visitedAt.toISOString(),
    })),
    homeHref: `/app/${orgSlug}`,
    now: now.toISOString(),
  };
}
