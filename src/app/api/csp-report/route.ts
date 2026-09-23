import { checkRateLimit } from "@/lib/rate-limit";

/**
 * Receives Content-Security-Policy violation reports (0A Fix 13), both the
 * legacy report-uri form (application/csp-report) and the Reporting API
 * form (application/reports+json). The policy ships report-only first;
 * these log lines are how the report-only week is reviewed before
 * CSP_MODE=enforce. Only the directive and the blocked origin are logged,
 * never full URLs with query strings (they can carry tokens).
 */

const REPORT_LIMIT = 60;
const REPORT_WINDOW_MS = 60 * 1000;
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
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!checkRateLimit(`csp-report:${ip}`, REPORT_LIMIT, REPORT_WINDOW_MS).allowed) {
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
