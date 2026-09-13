import { notFound } from "next/navigation";

import { NotFoundError } from "@/lib/auth/errors";

/**
 * Maps auth errors to the corresponding Next.js response in a Server
 * Component/layout: NotFoundError renders the nearest not-found UI.
 * ForbiddenError (and anything else) rethrows to the nearest error boundary.
 */
export function handleAuthErrorInPage(error: unknown): never {
  if (error instanceof NotFoundError) {
    notFound();
  }
  throw error;
}
