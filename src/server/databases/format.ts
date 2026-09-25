import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";

import type { Cell } from "@/components/databases/column-config";
import type { UserPublic } from "@/server/members";

/** Display and export formatting for database rows, in the org timezone. */

export function inTz(date: Date, timezone: string): TZDate {
  return new TZDate(date.getTime(), timezone || "UTC");
}

/** "Sep 16, 2026" */
export function fmtDate(date: Date | null | undefined, timezone: string): string {
  return date ? format(inTz(date, timezone), "MMM d, yyyy") : "";
}

/** "Sep 16, 2026, 6:05 PM" */
export function fmtDateTime(date: Date | null | undefined, timezone: string): string {
  return date ? format(inTz(date, timezone), "MMM d, yyyy, h:mm a") : "";
}

/** CSV: "2026-09-16 18:05" in the org timezone (the header names the zone). */
export function csvDateTime(date: Date | null | undefined, timezone: string): string {
  return date ? format(inTz(date, timezone), "yyyy-MM-dd HH:mm") : "";
}

/** CSV: "2026-09-16". */
export function csvDate(date: Date | null | undefined, timezone: string): string {
  return date ? format(inTz(date, timezone), "yyyy-MM-dd") : "";
}

/** The term (fall-YYYY / spring-YYYY) of an instant in the org timezone: app.term_of in TS. */
export function termOf(date: Date, timezone: string): string {
  const local = inTz(date, timezone);
  return `${local.getMonth() >= 6 ? "fall" : "spring"}-${local.getFullYear()}`;
}

/** "fall-2026" -> "Fall 2026" */
export function termLabel(term: string | null | undefined): string {
  if (!term) return "";
  const m = /^(fall|spring)-(\d{4})$/.exec(term);
  return m ? `${m[1] === "fall" ? "Fall" : "Spring"} ${m[2]}` : term;
}

export function text(
  v: string | null | undefined,
  opts: { muted?: boolean; title?: string } = {},
): Cell {
  return v ? { t: "text", v, ...opts } : null;
}

export function num(v: number | null | undefined): Cell {
  return { t: "number", v: v ?? null };
}

export function dateTimeCell(date: Date | null | undefined, timezone: string): Cell {
  return date ? { t: "text", v: fmtDateTime(date, timezone), title: date.toISOString() } : null;
}

export function dateCell(date: Date | null | undefined, timezone: string): Cell {
  return date ? { t: "text", v: fmtDate(date, timezone), title: date.toISOString() } : null;
}

export interface ContactLike {
  id: string;
  displayName: string | null;
  emailMasked: string | null;
  userId: string | null;
  user?: UserPublic | null;
}

/** The name to show for a contact: a linked member's name wins, then the display name. */
export function contactName(
  contact: ContactLike | null | undefined,
  override?: string | null,
): string {
  if (override) return override;
  if (!contact) return "Unknown";
  return contact.user?.name || contact.displayName || contact.emailMasked || "Unknown";
}

/** The person cell: UserAvatar and name when the contact is linked to a member, initials otherwise. */
export function personCell(
  contact: ContactLike | null | undefined,
  override?: string | null,
): Cell {
  if (!contact) return { t: "person", name: "Unknown", user: null };
  const user = contact.user
    ? { name: contact.user.name, image: contact.user.image, avatar: contact.user.avatar }
    : null;
  return {
    t: "person",
    name: contactName(contact, override),
    user,
    sub: contact.userId ? "Member" : undefined,
  };
}

/** The address the viewer may see: the full primary email (row-gated by RLS) or the masked one. */
export function visibleEmail(contact: {
  emailMasked: string | null;
  emails?: { emailNormalized: string }[];
}): string {
  return contact.emails?.[0]?.emailNormalized ?? contact.emailMasked ?? "";
}

export const EVENT_KIND_LABELS: Record<string, string> = {
  WORKSHOP: "Workshop",
  SOCIAL: "Social",
  HACKATHON: "Hackathon",
  INFO_SESSION: "Info session",
  BOARD_MEETING: "Board meeting",
  OTHER: "Other",
};

export const METHOD_LABELS: Record<string, string> = { QR: "QR", FORM: "Form", MANUAL: "Manual" };

export const SOURCE_LABELS: Record<string, string> = {
  SUITE: "Suite",
  SUPABASE_SYNC: "Website sync",
  CSV: "CSV import",
};

export const CHANNEL_LABELS: Record<string, string> = {
  WEB: "Website",
  TYPEFORM: "Typeform",
  OFFICER: "Officer",
  CSV: "CSV",
  MANUAL: "Manual",
};

export const STATUS_LABELS: Record<string, string> = {
  PENDING: "Pending",
  ADDED: "Added to list",
  UNSUBSCRIBED: "Unsubscribed",
};

export function options(labels: Record<string, string>): { value: string; label: string }[] {
  return Object.entries(labels).map(([value, label]) => ({ value, label }));
}
