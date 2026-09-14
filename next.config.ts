import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {/* config options here */};

// Only uploads source maps (and needs auth) when SENTRY_AUTH_TOKEN is set —
// a plain `next build` without it still succeeds, just without that step.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: true,
  widenClientFileUpload: true,
});
