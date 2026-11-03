import type { SendWindow } from "./outreach/schedule";

/**
 * What CRM settings keeps beyond the plain columns (docs/features/crm.md,
 * "Redesign", Settings): the Sending section's window and unsubscribe line
 * (CrmSettings.sending), how much the CRM may do alone (CrmSettings.autonomy),
 * and when sending is paused. Pure and client-safe: the settings cards
 * render from here and the send path reads the same values.
 */

// ---- Sending ---------------------------------------------------------------------------

export interface SendingPrefs {
  /** Group mail (sequences, campaigns, automations) goes from this hour... */
  startHour: number;
  /** ...until this one (exclusive), in the organization's timezone. */
  endHour: number;
  /** Off: weekend sends wait for Monday. */
  weekends: boolean;
  /** Added under group emails, never one-to-one. */
  unsubscribeLine: string;
}

export const DEFAULT_UNSUBSCRIBE_LINE = "Don't want these emails? Unsubscribe.";

export const DEFAULT_SENDING: SendingPrefs = {
  startHour: 8,
  endHour: 21,
  weekends: true,
  unsubscribeLine: DEFAULT_UNSUBSCRIBE_LINE,
};

const hour = (v: unknown, fallback: number, min: number, max: number) =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : fallback;

/** A stored Sending value, cleaned; anything odd falls back to the defaults. */
export function readSending(raw: unknown): SendingPrefs {
  const s = (raw && typeof raw === "object" ? raw : {}) as Partial<
    Record<keyof SendingPrefs, unknown>
  >;
  let startHour = hour(s.startHour, DEFAULT_SENDING.startHour, 0, 23);
  let endHour = hour(s.endHour, DEFAULT_SENDING.endHour, 1, 24);
  if (endHour <= startHour) {
    startHour = DEFAULT_SENDING.startHour;
    endHour = DEFAULT_SENDING.endHour;
  }
  const line =
    typeof s.unsubscribeLine === "string"
      ? s.unsubscribeLine.replace(/\s+/g, " ").trim().slice(0, 200)
      : "";
  return {
    startHour,
    endHour,
    weekends: typeof s.weekends === "boolean" ? s.weekends : DEFAULT_SENDING.weekends,
    unsubscribeLine: line || DEFAULT_UNSUBSCRIBE_LINE,
  };
}

/** The send window group mail waits for (nextInWindow in outreach/schedule.ts). */
export function sendingWindow(prefs: SendingPrefs): SendWindow {
  return {
    days: prefs.weekends ? [1, 2, 3, 4, 5, 6, 7] : [1, 2, 3, 4, 5],
    startHour: prefs.startHour,
    endHour: prefs.endHour,
  };
}

/** Whether the organization changed anything from the defaults (else the old windows apply). */
export function sendingIsSet(raw: unknown): boolean {
  return Boolean(raw && typeof raw === "object" && Object.keys(raw).length > 0);
}

/** "9 AM", "12 PM", "12 AM" (midnight, also 24). */
export function hourLabel(h: number): string {
  const n = ((h % 24) + 24) % 24;
  return `${((n + 11) % 12) + 1} ${n < 12 ? "AM" : "PM"}`;
}

/**
 * The unsubscribe footer for one email: the organization's line with its
 * last "Unsubscribe" linked (plain text gets the address after it). A line
 * without the word gets " Unsubscribe." added, so there's always a way out.
 */
export function unsubscribeFooter(line: string, url: string): { text: string; html: string } {
  const clean = (line.trim() || DEFAULT_UNSUBSCRIBE_LINE).replace(/\s+/g, " ");
  const withWord = /unsubscribe/i.test(clean) ? clean : `${clean} Unsubscribe.`;
  const at = withWord.toLowerCase().lastIndexOf("unsubscribe");
  const before = withWord.slice(0, at);
  const word = withWord.slice(at, at + "unsubscribe".length);
  const after = withWord.slice(at + "unsubscribe".length);
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return {
    text: `${withWord.replace(/[.!]?$/, "")}: ${url}`,
    html: `${esc(before)}<a href="${esc(url)}">${esc(word)}</a>${esc(after)}`,
  };
}

// ---- How much it may do alone ----------------------------------------------------------------

export type TrustLevel = "suggest" | "tell" | "auto";

export const TRUST_LEVELS: readonly { value: TrustLevel; label: string }[] = [
  { value: "suggest", label: "Suggest" },
  { value: "tell", label: "Do and tell me" },
  { value: "auto", label: "Just do it" },
];

export type TrustItem = "emails" | "merges" | "signatures" | "stages";

export const TRUST_ITEMS: readonly { id: TrustItem; label: string; fallback: TrustLevel }[] = [
  { id: "emails", label: "Emails from plans and automations", fallback: "tell" },
  { id: "merges", label: "Merging exact duplicates", fallback: "tell" },
  { id: "signatures", label: "Changing details from email signatures", fallback: "suggest" },
  { id: "stages", label: "Moving deals between stages", fallback: "suggest" },
];

export type Autonomy = Record<TrustItem, TrustLevel>;

const isLevel = (v: unknown): v is TrustLevel => v === "suggest" || v === "tell" || v === "auto";

/** A stored autonomy value, cleaned; each missing item takes its fallback. */
export function readAutonomy(raw: unknown): Autonomy {
  const a = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return Object.fromEntries(
    TRUST_ITEMS.map((t) => [t.id, isLevel(a[t.id]) ? a[t.id] : t.fallback]),
  ) as Autonomy;
}

/**
 * Whether an automation's email step drafts for review instead of sending:
 * the step says so, or the organization said Suggest for automation email.
 */
export function automationEmailReview(stepReview: boolean, autonomy: Autonomy): boolean {
  return stepReview || autonomy.emails === "suggest";
}

// ---- When sending is paused -------------------------------------------------------------------

export interface SendingHealth {
  /** The organization's own sender is verified (SPF and DKIM) for bulk mail. */
  senderOk: boolean;
  /** "hello@northside.org" when there's one. */
  senderAddress: string | null;
  /** This month's spending cap is reached. */
  capReached: boolean;
  /** Group mail sent in the last week, and how much of it bounced. */
  sentLastWeek: number;
  bouncedLastWeek: number;
}

export interface SendingPause {
  /** Paused: something stops; warn: it still goes, but should be fixed. */
  tone: "paused" | "warn";
  /** One sentence, after "Sending is paused." when paused. */
  text: string;
  /** Where to fix it: AI (the cap and the organization's keys, the sender's among them), or Sending's list of what didn't go. */
  fix: "ai" | "bounces";
  /** The fix, as a button label. */
  action: string;
}

/** At this share of group mail bouncing (with enough sent to tell), it's worth a look. */
export const BOUNCE_WARN_RATE = 0.05;
export const BOUNCE_MIN_SENT = 20;

export function bounceRate(sent: number, bounced: number): number {
  return sent > 0 ? bounced / sent : 0;
}

/**
 * Why sending is paused, most important first; empty when it all goes.
 * The cap stops bulk email and texts (one-to-one email still goes); an
 * unverified sender stops bulk email (send.ts and mailbox.ts refuse it).
 */
export function sendingPauses(h: SendingHealth): SendingPause[] {
  const out: SendingPause[] = [];
  if (h.capReached) {
    out.push({
      tone: "paused",
      text: "This month's spending cap is reached, so bulk email and texts wait. One-to-one email still goes.",
      fix: "ai",
      action: "Raise the cap",
    });
  }
  if (!h.senderOk) {
    out.push({
      tone: "paused",
      text: h.senderAddress
        ? `${h.senderAddress} isn't verified yet, so bulk email would land in spam. Drafts are kept.`
        : "Bulk email needs your organization's own verified address, so it waits. Drafts are kept.",
      fix: "ai",
      action: "Verify the address",
    });
  }
  if (
    h.sentLastWeek >= BOUNCE_MIN_SENT &&
    bounceRate(h.sentLastWeek, h.bouncedLastWeek) >= BOUNCE_WARN_RATE
  ) {
    const pct = Math.round(bounceRate(h.sentLastWeek, h.bouncedLastWeek) * 100);
    out.push({
      tone: "warn",
      text: `${pct}% of last week's group email bounced. Clean the list before the next send, or mailboxes start landing in spam.`,
      fix: "bounces",
      action: "See what bounced",
    });
  }
  return out;
}
