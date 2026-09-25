import { unstable_rethrow } from "next/navigation";

import { ForbiddenError, NotFoundError } from "@/lib/auth/errors";
import { AppError } from "@/server/db/errors";
import { EventValidationError } from "@/server/events/service";

/**
 * The calendar actions return { error } instead of throwing, so the dialogs
 * can show the message. Next.js control flow (redirect to sign-in, notFound)
 * is rethrown untouched; unknown errors are logged and replaced by a
 * generic message (no database detail reaches the browser).
 */
export function actionError(error: unknown): { error: string } {
  unstable_rethrow(error);
  if (error instanceof EventValidationError) return { error: error.message };
  if (error instanceof ForbiddenError) {
    return { error: error.message === "Forbidden" ? "You don't have permission to do that." : error.message };
  }
  if (error instanceof NotFoundError) return { error: "That event no longer exists." };
  if (error instanceof AppError) return { error: error.message };
  console.error("[calendar] action failed", error);
  return { error: "Something went wrong. Try again." };
}
