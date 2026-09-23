/**
 * IANA timezones for the org timezone select (Settings > General, org
 * creation). Pure and client-safe.
 */

let cached: string[] | null = null;

/** Every IANA zone this runtime knows, with UTC first. */
export function timeZoneOptions(): string[] {
  if (cached) return cached;
  let zones: string[] = [];
  try {
    zones = Intl.supportedValuesOf("timeZone");
  } catch {
    zones = [];
  }
  cached = ["UTC", ...zones.filter((z) => z !== "UTC")];
  return cached;
}

/** Whether `tz` is a zone Intl can format dates in. */
export function isValidTimeZone(tz: string): boolean {
  if (!tz || tz.length > 64) return false;
  if (tz === "UTC") return true;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return timeZoneOptions().includes(tz) || /^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)+$/.test(tz);
  } catch {
    return false;
  }
}
