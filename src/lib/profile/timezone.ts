/**
 * User timezones (Phase 2). User.timezone is an IANA zone the user chose,
 * or NULL to follow the org's timezone. Reminders and digests run in the
 * effective zone: effectiveTimezone(user, org) = user.timezone ?? org.timezone
 * (Phase 6's src/server/tasks/time.ts resolver has the same rule). Pure and
 * client-safe.
 */

const IANA_SHAPE = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+){0,2}$/;

/** True for a zone the runtime's Intl knows ("America/New_York", "UTC"). */
export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) return false;
  if (!IANA_SHAPE.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** The zone reminders and digests use for this user in this org. */
export function effectiveTimezone(
  user: { timezone?: string | null },
  org: { timezone: string },
): string {
  return user.timezone && isValidTimeZone(user.timezone) ? user.timezone : org.timezone;
}

const FALLBACK_ZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Toronto",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Africa/Lagos",
  "Asia/Kolkata",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Australia/Sydney",
];

/** Every IANA zone the runtime supports, sorted (a short list on old runtimes). */
export function listTimeZones(): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
  const zones =
    typeof intl.supportedValuesOf === "function" ? intl.supportedValuesOf("timeZone") : [];
  const all = new Set([...(zones.length > 0 ? zones : FALLBACK_ZONES), "UTC"]);
  return [...all].sort((a, b) => a.localeCompare(b));
}

/** "America/New_York" -> "America / New York" for select labels. */
export function timeZoneLabel(zone: string): string {
  return zone.replace(/_/g, " ").replace(/\//g, " / ");
}
