/**
 * Display helpers shared by the report cards (server) and charts (client).
 * Pure: org-local dates arrive as yyyy-mm-dd and are formatted as calendar
 * dates (in UTC, so the viewer's own timezone never shifts them).
 */

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parts(date: string): [number, number, number] {
  const [y, m, d] = date.split("-").map(Number);
  return [y, m, d];
}

/** "Sep 22" */
export function shortDate(date: string): string {
  const [, m, d] = parts(date);
  return `${MONTHS[m - 1]} ${d}`;
}

/** "Tue, Sep 22" (with ", 2026" when `withYear`). */
export function longDate(date: string, withYear = false): string {
  const [y, m, d] = parts(date);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday}, ${MONTHS[m - 1]} ${d}${withYear ? `, ${y}` : ""}`;
}

/** "Week of Sep 21" */
export function weekLabel(monday: string): string {
  return `Week of ${shortDate(monday)}`;
}

const INTEGER = new Intl.NumberFormat("en-US");
const ONE_DECIMAL = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

export function formatCount(n: number): string {
  return INTEGER.format(n);
}

export function formatDecimal(n: number): string {
  return ONE_DECIMAL.format(n);
}

/** "12.5%" */
export function formatPct(n: number): string {
  return `${ONE_DECIMAL.format(n)}%`;
}

/** "+6", "−6", "0" (a true minus sign). */
export function formatSigned(n: number): string {
  if (n > 0) return `+${formatDecimal(n)}`;
  if (n < 0) return `−${formatDecimal(Math.abs(n))}`;
  return "0";
}

/** "+12.5%", "−12.5%" */
export function formatSignedPct(n: number): string {
  return `${formatSigned(n)}%`;
}

export const KIND_LABELS: Record<string, string> = {
  WORKSHOP: "Workshops",
  INFO_SESSION: "Info sessions",
  SOCIAL: "Socials",
  HACKATHON: "Hackathons",
  BOARD_MEETING: "Board meetings",
  OTHER: "Other",
};

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

export const CHANNEL_LABELS: Record<string, string> = {
  WEB: "Website",
  TYPEFORM: "Typeform",
  OFFICER: "Officer",
  CSV: "CSV import",
  MANUAL: "Manual",
};

export function channelLabel(channel: string): string {
  return CHANNEL_LABELS[channel] ?? channel;
}

/** "as of 6:42 PM" (today) or "as of Sep 22, 6:42 PM", in the org timezone. */
export function asOfLabel(iso: string, tz: string, now: Date = new Date()): string {
  const at = new Date(iso);
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(at);
  if (day(at) === day(now)) return `as of ${time}`;
  const date = new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric" }).format(at);
  return `as of ${date}, ${time}`;
}
