/**
 * Calls and texts, the pure parts (docs/features/crm.md module 5, "Calls",
 * "Texting" and "Deliverability and law"). Client-safe: the phone settings
 * shape, the STOP/START/HELP words carriers require, consent, quiet hours,
 * call outcomes and how a number is shown without printing all of it.
 */

export type PhoneProvider = "telnyx" | "twilio";

export const PHONE_PROVIDERS: readonly PhoneProvider[] = ["telnyx", "twilio"];

export const PROVIDER_LABEL: Record<PhoneProvider, string> = { telnyx: "Telnyx", twilio: "Twilio" };

/** What CrmSettings.phone holds. Every field has a default that works on the first click. */
export interface PhoneSettings {
  /** Which connected provider places calls and sends texts (null: the first connected). */
  provider: PhoneProvider | null;
  /** "ask": a member may record after the notice plays; "never": nobody records. */
  recording: "ask" | "never";
  /** Read to everyone on the call before recording starts. */
  notice: string;
  /** No texts go out between these hours, organization time ("21:00" to "08:00"). */
  quietStart: string;
  quietEnd: string;
  /** The dialer suggests calls only between these hours. */
  callStart: string;
  callEnd: string;
  /** The org's recorded voicemail to drop (a crm-audio blob key), if any. */
  voicemailKey: string | null;
}

export const DEFAULT_NOTICE = "This call is being recorded. If you'd rather it wasn't, just say so.";

export const DEFAULT_PHONE_SETTINGS: PhoneSettings = {
  provider: null,
  recording: "ask",
  notice: DEFAULT_NOTICE,
  quietStart: "21:00",
  quietEnd: "08:00",
  callStart: "09:00",
  callEnd: "18:00",
  voicemailKey: null,
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** CrmSettings.phone read safely: anything missing or wrong falls back to the default. */
export function readPhoneSettings(raw: unknown): PhoneSettings {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const time = (v: unknown, d: string) => (typeof v === "string" && HHMM.test(v) ? v : d);
  const d = DEFAULT_PHONE_SETTINGS;
  return {
    provider: o.provider === "telnyx" || o.provider === "twilio" ? o.provider : null,
    recording: o.recording === "never" ? "never" : "ask",
    notice:
      typeof o.notice === "string" && o.notice.trim().length >= 10 ? o.notice.trim().slice(0, 300) : d.notice,
    quietStart: time(o.quietStart, d.quietStart),
    quietEnd: time(o.quietEnd, d.quietEnd),
    callStart: time(o.callStart, d.callStart),
    callEnd: time(o.callEnd, d.callEnd),
    voicemailKey: typeof o.voicemailKey === "string" && o.voicemailKey ? o.voicemailKey : null,
  };
}

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** The hour and minute it is now in a time zone. */
export function localMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

/** Is `at` inside the window start..end (which may wrap past midnight)? */
export function inWindow(at: Date, timeZone: string, start: string, end: string): boolean {
  const now = localMinutes(at, timeZone);
  const s = minutes(start);
  const e = minutes(end);
  if (s === e) return false;
  return s < e ? now >= s && now < e : now >= s || now < e;
}

/** Texts wait during quiet hours. */
export function inQuietHours(settings: Pick<PhoneSettings, "quietStart" | "quietEnd">, at: Date, timeZone: string): boolean {
  return inWindow(at, timeZone, settings.quietStart, settings.quietEnd);
}

// ---- STOP, START and HELP --------------------------------------------------------

/**
 * The words US carriers (CTIA) and both providers treat as opting out and
 * back in. Matched on the whole message, trimmed and case-folded, so "stop
 * by at 5" is a message, not an opt-out.
 */
export const STOP_WORDS = ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "OPTOUT", "OPT-OUT", "REVOKE"] as const;
export const START_WORDS = ["START", "YES", "UNSTOP", "OPTIN", "OPT-IN", "SUBSCRIBE"] as const;
export const HELP_WORDS = ["HELP", "INFO"] as const;

export type Keyword = "stop" | "start" | "help" | null;

export function textKeyword(body: string): Keyword {
  const word = body
    .trim()
    .replace(/[.!\s]+$/g, "")
    .toUpperCase();
  if ((STOP_WORDS as readonly string[]).includes(word)) return "stop";
  if ((START_WORDS as readonly string[]).includes(word)) return "start";
  if ((HELP_WORDS as readonly string[]).includes(word)) return "help";
  return null;
}

/** The auto-reply each keyword gets (sent once; carriers require STOP and HELP to answer). */
export function keywordReply(keyword: Exclude<Keyword, null>, orgName: string): string {
  switch (keyword) {
    case "stop":
      return `${orgName}: you won't get more texts from us. Reply START to get them again.`;
    case "start":
      return `${orgName}: texts are back on. Reply STOP to stop, HELP for help.`;
    case "help":
      return `${orgName}: reply STOP to stop texts, START to start them again. Questions? Reply here and a person will answer.`;
  }
}

// ---- Consent ------------------------------------------------------------------------

export type ConsentChannel = "email" | "text" | "call";

export interface ChannelConsent {
  granted: boolean;
  /** ISO time it was given or taken back. */
  at: string;
  /** How: "verbal", "form", "written", "texted START", "texted STOP", ... */
  how: string;
  /** The member who recorded it, if a member did. */
  by?: string | null;
}

export type Consent = Partial<Record<ConsentChannel, ChannelConsent>>;

export const CONSENT_HOW = [
  { id: "verbal", label: "They said yes on a call or in person" },
  { id: "written", label: "They said yes in writing (email, letter)" },
  { id: "form", label: "They ticked a box on a form" },
  { id: "texted", label: "They texted us first" },
] as const;

export function readConsent(raw: unknown): Consent {
  if (!raw || typeof raw !== "object") return {};
  const out: Consent = {};
  for (const ch of ["email", "text", "call"] as const) {
    const v = (raw as Record<string, unknown>)[ch];
    if (v && typeof v === "object" && typeof (v as ChannelConsent).granted === "boolean") {
      const c = v as ChannelConsent;
      out[ch] = {
        granted: c.granted,
        at: typeof c.at === "string" ? c.at : new Date(0).toISOString(),
        how: typeof c.how === "string" ? c.how.slice(0, 120) : "",
        by: typeof c.by === "string" ? c.by : null,
      };
    }
  }
  return out;
}

/** The consent JSON with one channel set. */
export function withConsent(raw: unknown, channel: ConsentChannel, value: ChannelConsent): Consent {
  return { ...readConsent(raw), [channel]: value };
}

/** May we text them? A person marked do-not-contact never; otherwise only with text consent. */
export function canText(person: { doNotContact: boolean; consent: unknown; phone: string | null }): {
  ok: boolean;
  reason?: "no-phone" | "do-not-contact" | "no-consent" | "opted-out";
} {
  if (!person.phone) return { ok: false, reason: "no-phone" };
  if (person.doNotContact) return { ok: false, reason: "do-not-contact" };
  const c = readConsent(person.consent).text;
  if (!c) return { ok: false, reason: "no-consent" };
  if (!c.granted) return { ok: false, reason: "opted-out" };
  return { ok: true };
}

// ---- Numbers -----------------------------------------------------------------------

/** E.164 (+15551234567) from what someone typed, or null. US numbers without +1 get it. */
export function toE164(input: string | null | undefined): string | null {
  const s = (input ?? "").trim();
  if (!s || /[^0-9+()\-.\s]/.test(s)) return null;
  const digits = s.replace(/\D/g, "");
  if (s.startsWith("+")) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/** The last 10 digits, for matching an incoming number to a person. */
export function phoneKey(input: string | null | undefined): string | null {
  const d = (input ?? "").replace(/\D/g, "");
  return d.length >= 7 ? d.slice(-10) : null;
}

/** "+15551234567" as "•••4567": what logs and lists may print. */
export function maskNumber(input: string | null | undefined): string {
  const d = (input ?? "").replace(/\D/g, "");
  return d.length >= 4 ? `•••${d.slice(-4)}` : "•••";
}

/** +15551234567 -> (555) 123-4567 for people reading it; others as given. */
export function formatNumber(e164: string | null | undefined): string {
  if (!e164) return "";
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}

// ---- Calls ---------------------------------------------------------------------------

export const CALL_OUTCOMES = [
  { id: "connected", label: "Talked" },
  { id: "voicemail", label: "Left voicemail" },
  { id: "no-answer", label: "No answer" },
  { id: "busy", label: "Busy" },
  { id: "wrong-number", label: "Wrong number" },
  { id: "callback", label: "Call back later" },
  { id: "not-interested", label: "Not interested" },
] as const;

export type CallOutcome = (typeof CALL_OUTCOMES)[number]["id"];

export function outcomeLabel(id: string | null | undefined): string {
  return CALL_OUTCOMES.find((o) => o.id === id)?.label ?? "Call";
}

/** "1:05", "12:00", "1:02:03". */
export function formatDuration(sec: number | null | undefined): string {
  if (!sec || sec < 0) return "0:00";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

/** "5:30" or "330" or "5m" typed by someone, as seconds. */
export function parseDuration(input: string | null | undefined): number | null {
  const s = (input ?? "").trim().toLowerCase();
  if (!s) return null;
  let m = /^(\d{1,3}):([0-5]\d)$/.exec(s);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = /^(\d{1,4})\s*m(in)?$/.exec(s);
  if (m) return Number(m[1]) * 60;
  m = /^(\d{1,5})\s*s?$/.exec(s);
  if (m) return Number(m[1]);
  return null;
}
