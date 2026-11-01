import { refresh } from "next/cache";
import { unstable_rethrow } from "next/navigation";

import { NotFoundError } from "@/lib/auth/errors";
import { AppError } from "@/server/db/errors";

/**
 * The { ok, error } shape shared by member-path actions that answer with a
 * sentence instead of throwing (announcements, decisions): a refusal says
 * what to show, and anything thrown becomes one, so the button that called
 * the action toasts it rather than hitting an error boundary.
 *
 *   return runResult(() => postTx(orgId, input), { gone: GONE, label: "announcements" });
 */

export type ActionRefusal = { ok: false; error: string };

export interface RunResultOptions {
  /** What a NotFoundError says ("That decision is gone."). */
  gone: string;
  /** The log prefix for anything unexpected. */
  label: string;
  /** Refresh the page after a success (default true). */
  refreshAfter?: boolean;
}

/** A throw as a refusal; Next's own control flow (redirects) passes through. */
export function failedResult(error: unknown, { gone, label }: RunResultOptions): ActionRefusal {
  unstable_rethrow(error);
  if (error instanceof NotFoundError) return { ok: false, error: gone };
  if (error instanceof AppError) return { ok: false, error: error.message };
  console.error(`[${label}] action failed`, error);
  return { ok: false, error: "Something went wrong. Try again." };
}

/** Runs `fn`, refreshes on success, and turns a throw into a refusal. */
export async function runResult<T extends { ok: boolean }>(
  fn: () => Promise<T>,
  options: RunResultOptions,
): Promise<T | ActionRefusal> {
  try {
    const result = await fn();
    if ((options.refreshAfter ?? true) && result.ok) refresh();
    return result;
  } catch (error) {
    return failedResult(error, options);
  }
}
