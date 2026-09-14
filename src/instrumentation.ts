import * as Sentry from "@sentry/nextjs";

// Sentry.init with no DSN is a safe no-op (the SDK just disables itself) —
// this file works unchanged in local dev, CI, and prod; only setting
// NEXT_PUBLIC_SENTRY_DSN in Vercel turns reporting on (spec 6.6).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      tracesSampleRate: 0.1,
    });
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      tracesSampleRate: 0.1,
    });
  }
}

export const onRequestError = Sentry.captureRequestError;
