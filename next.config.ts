import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

import {
  CRM_MIC_PERMISSIONS_HEADER,
  CRM_MIC_SOURCES,
  DOOR_MODE_SOURCES,
  DOOR_PERMISSIONS_HEADER,
  buildStaticCsp,
  cspHeaderName,
  cspMode,
  REPORTING_ENDPOINTS_HEADER,
  STATIC_CSP_SOURCE,
  FRAME_DENY_HEADER,
  NOT_FRAMABLE_SOURCE,
  STATIC_SECURITY_HEADERS,
} from "./src/lib/security/csp";

const nextConfig: NextConfig = {
  // 0A Fix 13. Static security headers on every route, plus the static
  // (no-nonce) CSP on every route the proxy does not cover; src/proxy.ts sets
  // the per-request nonce policy on /app, /poll, /invite and the auth pages.
  // These values are fixed when the build runs (CSP_MODE included).
  async headers() {
    return [
      { source: "/:path*", headers: STATIC_SECURITY_HEADERS },
      // Door mode scans tickets with the camera (the later header wins).
      ...DOOR_MODE_SOURCES.map((source) => ({ source, headers: [DOOR_PERMISSIONS_HEADER] })),
      // The CRM records voice notes and calls from the browser (the microphone).
      ...CRM_MIC_SOURCES.map((source) => ({ source, headers: [CRM_MIC_PERMISSIONS_HEADER] })),
      // Every path but the Notes files route (its PDFs preview in a same-origin frame).
      { source: NOT_FRAMABLE_SOURCE, headers: [FRAME_DENY_HEADER] },
      {
        source: STATIC_CSP_SOURCE,
        headers: [
          { key: cspHeaderName(cspMode()), value: buildStaticCsp() },
          REPORTING_ENDPOINTS_HEADER,
        ],
      },
    ];
  },
};

// Only uploads source maps (and needs auth) when SENTRY_AUTH_TOKEN is set —
// a plain `next build` without it still succeeds, just without that step.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: true,
  widenClientFileUpload: true,
});
