import * as Sentry from "@sentry/nextjs";

import {
  consoleScrubberEnabled,
  installConsoleScrubber,
  scrubBreadcrumb,
  scrubSentryEvent,
} from "@/lib/observability/scrub";

// Sentry.init with no DSN is a safe no-op (the SDK just disables itself) —
// this file works unchanged in local dev, CI, and prod; only setting
// NEXT_PUBLIC_SENTRY_DSN in Vercel turns reporting on (spec 6.6).
//
// Every event and breadcrumb passes through the scrubber (src/lib/
// observability/scrub.ts): no credentials, tokens, emails or query strings
// leave the server in an error report, and in production the console is
// scrubbed the same way before it reaches the log drain.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (consoleScrubberEnabled()) installConsoleScrubber();
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      tracesSampleRate: 0.1,
      sendDefaultPii: false,
      beforeSend: scrubSentryEvent,
      beforeSendTransaction: scrubSentryEvent,
      beforeBreadcrumb: scrubBreadcrumb,
    });
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      tracesSampleRate: 0.1,
      sendDefaultPii: false,
      beforeSend: scrubSentryEvent,
      beforeSendTransaction: scrubSentryEvent,
      beforeBreadcrumb: scrubBreadcrumb,
    });
  }
}

export const onRequestError = Sentry.captureRequestError;
