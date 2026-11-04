import "server-only";

import { after } from "next/server";

/**
 * Runs best-effort network work after the response (Next.js after()): the
 * WorkOS calls that follow a grant change, which our own row already
 * decides. A failure is logged, never thrown. Outside a request (scripts,
 * tests) there is nothing to hang the work on, and it is skipped.
 */
export function afterResponse(label: string, work: () => Promise<unknown>): void {
  try {
    after(async () => {
      try {
        await work();
      } catch (error) {
        console.warn(
          `[connectors] ${label} failed`,
          error instanceof Error ? error.message : error,
        );
      }
    });
  } catch {
    // Not inside a Next.js request.
  }
}
