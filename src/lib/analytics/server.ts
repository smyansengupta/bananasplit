import "server-only";

import { track } from "@vercel/analytics/server";

import type { EventProperties, FunnelEvent } from "./events";

/**
 * Records a funnel step from a server action (src/lib/analytics/events.ts).
 * Never throws and never blocks for long: a failed or slow analytics call
 * must not stop someone signing up. Outside a Vercel deployment the library
 * sends nothing.
 */
export async function trackServer(event: FunnelEvent, properties?: EventProperties): Promise<void> {
  try {
    await Promise.race([
      track(event, properties),
      new Promise<void>((resolve) => setTimeout(resolve, 1500)),
    ]);
  } catch (error) {
    console.error(
      "[analytics] could not record",
      event,
      error instanceof Error ? error.message : error,
    );
  }
}
