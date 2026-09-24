import { AttendanceMethod, EventKind, SignupSource } from "@/generated/prisma/enums";

/**
 * Pure mappings from the club website's Supabase rows to suite values
 * (Phase 4b). No database access here, so every rule is unit-tested.
 */

/**
 * checkins.source (website schema.sql allows code, officer and link) to the
 * suite's check-in method:
 *   code    FORM    the student typed the room code into the check-in form
 *                   (the only value the website's check_in() writes today)
 *   link    QR      a pre-filled check-in link, as a table-sign QR code carries
 *   officer MANUAL  an officer entered the row by hand
 * Anything else maps to FORM and is reported as unmapped.
 */
export function mapCheckinSource(source: string | null | undefined): {
  method: AttendanceMethod;
  unmapped: boolean;
} {
  switch ((source ?? "").trim().toLowerCase()) {
    case "code":
      return { method: AttendanceMethod.FORM, unmapped: false };
    case "link":
      return { method: AttendanceMethod.QR, unmapped: false };
    case "officer":
      return { method: AttendanceMethod.MANUAL, unmapped: false };
    default:
      return { method: AttendanceMethod.FORM, unmapped: true };
  }
}

/** signups.source (web, typeform, officer) to the suite's signup channel. */
export function mapSignupSource(source: string | null | undefined): SignupSource {
  switch ((source ?? "").trim().toLowerCase()) {
    case "typeform":
      return SignupSource.TYPEFORM;
    case "officer":
      return SignupSource.OFFICER;
    default:
      return SignupSource.WEB;
  }
}

/**
 * The website's kindOf() (src/lib/events.js), ported: title keywords, most
 * specific first; everything else is a workshop. The admin confirms the kind
 * of a session the sync created.
 */
const KIND_MATCHERS: [RegExp, EventKind][] = [
  [/athon\b|\bhack\s?night\b/i, EventKind.HACKATHON],
  [
    /\binfo(rmation)?\s*(session|night)\b|\bintro\b|\borientation\b|\bkick\s?-?off\b|\binterest\s*meeting\b/i,
    EventKind.INFO_SESSION,
  ],
  [/\bsocial\b|\bmixer\b|\bhangout\b|\bgame\s?night\b/i, EventKind.SOCIAL],
];

export function kindOfTitle(title: string | null | undefined): EventKind {
  const text = title ?? "";
  for (const [re, kind] of KIND_MATCHERS) if (re.test(text)) return kind;
  return EventKind.WORKSHOP;
}

/** Lower-cased and trimmed; null when it is not an address at all. */
export function normalizeEmail(email: string | null | undefined): string | null {
  const value = (email ?? "").trim().toLowerCase();
  if (value.length < 3 || value.length > 254) return null;
  const at = value.indexOf("@");
  if (at <= 0 || at !== value.lastIndexOf("@") || at === value.length - 1) return null;
  if (/\s/.test(value)) return null;
  return value;
}

/** m***@husky.neu.edu: what members see instead of the address. */
export function maskEmail(email: string): { masked: string; domain: string } {
  const [local = "", domain = ""] = email.split("@");
  return { masked: `${local.slice(0, 1) || "?"}***@${domain}`, domain };
}

/** A display name as entered, trimmed and bounded; null when empty. */
export function cleanName(name: string | null | undefined): string | null {
  const value = (name ?? "").replace(/\s+/g, " ").trim();
  return value ? value.slice(0, 120) : null;
}

/** The website's session ids, poll ids and signup ids are UUIDs. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether an externalId could have come from the website contract. The
 * reconcile only ever removes synced rows whose id has the source's shape,
 * so rows imported some other way (fixtures, a future second source) are
 * never touched by a reconcile of this one.
 */
export function isSourceId(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** Answers of a signup, as stored in Signup.answers. */
export interface SignupAnswers {
  colleges: string[];
  meet_days: string[];
  interests: string[];
}

function tokens(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim().toLowerCase())
    .filter((v) => /^[a-z0-9_]{1,32}$/.test(v))
    .slice(0, 16);
}

export function signupAnswers(row: {
  colleges?: unknown;
  meet_days?: unknown;
  interests?: unknown;
}): SignupAnswers {
  return {
    colleges: tokens(row.colleges),
    meet_days: tokens(row.meet_days),
    interests: tokens(row.interests),
  };
}

/** The website's option labels (src/lib/join.js), for display. */
export const SIGNUP_LABELS = {
  classYear: {
    first: "First year",
    second: "Second year",
    third: "Third year",
    fourth: "Fourth year",
    fifth_plus: "Fifth year or more",
    grad: "Graduate student",
  },
  colleges: {
    khoury: "Khoury",
    coe: "Engineering",
    cos: "Science",
    dmsb: "D'Amore-McKim",
    camd: "CAMD",
    cssh: "CSSH",
    bouve: "Bouvé",
    cps: "Professional Studies",
    law: "Law",
    mills: "Mills College",
    explore: "Explore Program",
    other: "Something else",
  },
  meet_days: {
    monday: "Monday",
    tuesday: "Tuesday",
    wednesday: "Wednesday",
    thursday: "Thursday",
    friday: "Friday",
    weekend: "Weekends",
  },
  interests: {
    workshops: "Build workshops",
    hackathons: "Hackathons",
    speakers: "Speaker talks",
    projects: "Team projects",
    social: "Social and community",
  },
} as const satisfies Record<string, Record<string, string>>;

/** A label for a stored token, falling back to the token itself. */
export function signupLabel(group: keyof typeof SIGNUP_LABELS, value: string): string {
  return (SIGNUP_LABELS[group] as Record<string, string>)[value] ?? value;
}
