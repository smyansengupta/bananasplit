import * as Sentry from "@sentry/nextjs";

import { scrubBreadcrumb, scrubSentryEvent } from "@/lib/observability/scrub";

// Same no-DSN-means-disabled behavior as src/instrumentation.ts, and the same
// scrubber: browser events carry URLs (invite and feed tokens live in paths)
// and breadcrumbs that must be redacted before they are sent.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
  beforeSend: scrubSentryEvent,
  beforeSendTransaction: scrubSentryEvent,
  beforeBreadcrumb: scrubBreadcrumb,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
