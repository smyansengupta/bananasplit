import { describeError, redactText } from "@/lib/redact";

/**
 * Sanitizes an error before it is stored anywhere a member can read it
 * (Job.lastError, OrgIntegration.lastError, Event.googleSyncError,
 * OrgChartVersion.parseError): one line, no email addresses, no bearer or
 * API-key shapes, no URL query strings or token paths, at most 500
 * characters (the SQL truncates to 500 as well).
 */
export function sanitize(error: unknown, max = 500): string {
  return describeError(error, max);
}

/** The same redaction for a string that is not an error (log lines). */
export function sanitizeText(text: string): string {
  return redactText(text);
}
