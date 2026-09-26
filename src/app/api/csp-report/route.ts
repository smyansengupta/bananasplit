import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { clientIpFrom } from "@/lib/request-ip";

/**
 * Receives Content-Security-Policy violation reports (0A Fix 13), both the
 * legacy report-uri form (application/csp-report) and the Reporting API
 * form (application/reports+json). The policy is enforced by default; these
 * log lines are how a CSP_MODE=report-only trial of a policy change is
 * reviewed. Only the directive and the blocked origin are logged, never
 * full URLs with query strings (they can carry tokens).
 */

const REPORT_LIMIT = 60;
const REPORT_WINDOW_SEC = 60;
const MAX_BODY_BYTES = 16 * 1024;

interface Violation {
  directive: string;
  blocked: string;
  page: string;
}

function originOnly(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  if (!value.includes(":")) return value.slice(0, 40); // 'inline', 'eval', ...
  try {
    const url = new URL(value);
    return url.protocol === "data:" || url.protocol === "blob:" ? url.protocol : url.origin;
  } catch {
    return value.slice(0, 40);
  }
}

function pathOnly(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  try {
    return new URL(value).pathname.slice(0, 200);
  } catch {
    return "";
  }
}

function extract(body: unknown): Violation[] {
  const items = Array.isArray(body) ? body : [body];
  const out: Violation[] = [];
  for (const item of items.slice(0, 20)) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const report = (record["csp-report"] ?? record.body ?? record) as Record<string, unknown>;
    out.push({
      directive: String(
        report["effective-directive"] ??
          report.effectiveDirective ??
          report["violated-directive"] ??
          "",
      ).slice(0, 60),
      blocked: originOnly(report["blocked-uri"] ?? report.blockedURL),
      page: pathOnly(report["document-uri"] ?? report.documentURL),
    });
  }
  return out;
}

export async function POST(request: Request) {
  const ip = clientIpFrom(request.headers);
  const limited = await checkRateLimit(rateLimitKey("csp-report", ip), REPORT_LIMIT, REPORT_WINDOW_SEC);
  if (!limited.allowed) {
    return new Response(null, { status: 429 });
  }
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    return new Response(null, { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400 });
  }
  for (const violation of extract(body)) {
    console.warn(
      `[csp] ${violation.directive || "unknown"} blocked ${violation.blocked || "?"} on ${violation.page || "?"}`,
    );
  }
  return new Response(null, { status: 204 });
}
