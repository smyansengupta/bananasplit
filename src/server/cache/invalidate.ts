import { AsyncLocalStorage } from "node:async_hooks";

import { revalidateTag, updateTag } from "next/cache";

import { currentTx } from "@/server/db/context";

import { isOrgTag } from "./tags";

/**
 * The one way to invalidate cached data (contract 5, 'Caching model').
 *
 *   invalidate([tags.publicEvents(orgId), tags.reports(orgId)])
 *
 * - Never before COMMIT: inside a transaction wrapper the call is queued on
 *   ctx.afterCommit and runs only if the transaction commits (a rolled-back
 *   action invalidates nothing). Outside a transaction it runs at once.
 * - In a Server Action it calls updateTag (read-your-own-writes). Everywhere
 *   else (jobs, route handlers, crons) it calls revalidateTag(tag,
 *   { expire: 0 }): updateTag throws outside Server Actions, and the
 *   one-argument revalidateTag is deprecated.
 * - Jobs run inside runAsBackgroundWork (the job runner does this), which
 *   pins revalidateTag: updateTag is never reachable from a job path.
 * - Outside any Next.js request (scripts, `pnpm jobs:drain`) there is no
 *   cache to invalidate; the call is logged and skipped.
 *
 * Shared services call invalidate(), never updateTag/revalidateTag directly.
 * Tags must come from src/server/cache/tags.ts.
 */

export type InvalidationMode = "action" | "background";

const background = new AsyncLocalStorage<true>();

/** Runs `fn` so that every invalidate() inside it uses revalidateTag. */
export function runAsBackgroundWork<T>(fn: () => T): T {
  return background.run(true, fn);
}

/** True inside runAsBackgroundWork (the job runner). */
export function isBackgroundWork(): boolean {
  return background.getStore() === true;
}

/** Test seam: the two Next.js functions, replaceable in unit tests. */
export const nextCache = {
  updateTag: (tag: string) => updateTag(tag),
  revalidateTag: (tag: string) => revalidateTag(tag, { expire: 0 }),
};

function isOutsideActionError(error: unknown): boolean {
  return error instanceof Error && /only be called from within a Server Action/i.test(error.message);
}

function isNoRequestContextError(error: unknown): boolean {
  return error instanceof Error && /static generation store missing/i.test(error.message);
}

function applyNow(tagList: readonly string[], mode: InvalidationMode | undefined): void {
  for (const tag of tagList) {
    try {
      if (mode === "background" || isBackgroundWork()) {
        nextCache.revalidateTag(tag);
      } else if (mode === "action") {
        nextCache.updateTag(tag);
      } else {
        try {
          nextCache.updateTag(tag);
        } catch (error) {
          if (!isOutsideActionError(error)) throw error;
          nextCache.revalidateTag(tag);
        }
      }
    } catch (error) {
      if (isNoRequestContextError(error)) {
        // Scripts and the CLI drain: no Next.js cache in this process.
        continue;
      }
      console.error(`[cache] invalidating ${tag} failed`, error);
    }
  }
}

/**
 * Invalidates `tagList` after the current transaction commits, or now when
 * no transaction is in scope. `mode` forces updateTag ("action") or
 * revalidateTag ("background"); by default a job uses revalidateTag and
 * anything else tries updateTag first.
 */
export function invalidate(tagList: readonly string[], options?: { mode?: InvalidationMode }): void {
  const unique = [...new Set(tagList)];
  for (const tag of unique) {
    if (!isOrgTag(tag)) throw new TypeError(`invalidate: ${tag} is not built by src/server/cache/tags.ts`);
  }
  if (unique.length === 0) return;

  const mode = options?.mode ?? (isBackgroundWork() ? "background" : undefined);
  const tx = currentTx();
  if (tx) {
    tx.afterCommit(() => applyNow(unique, mode));
    return;
  }
  applyNow(unique, mode);
}
