/**
 * From your apps (Home): what the organization's connected apps are doing,
 * as it happens. A call under way or about to start (with Join), an app
 * that needs reconnecting, events that didn't reach Google Calendar, the
 * website sync bringing data in, and the viewer's own AI apps working in
 * the workspace. Live things first, then what needs fixing, then the rest,
 * newest first. Pure, so the order and the words are unit-tested.
 */

export type AppKind = "call" | "website" | "calendar" | "ai" | "integration";

export interface AppsRow {
  key: string;
  app: AppKind;
  text: string;
  /** "20 min ago", "Starts in 5 min". */
  sub: string | null;
  href: string | null;
  /** The one thing to do right on the row. */
  action?: { label: string; href: string; external: boolean };
  tone: "live" | "warn" | "plain";
}

export interface AppsFeed {
  rows: AppsRow[];
}

export interface AppsFeedInput {
  now: Date;
  base: string;
  calls: readonly {
    id: string;
    title: string;
    startsAt: Date;
    endsAt: Date;
    provider: string;
    url: string;
  }[];
  /** The website sync's streams (checkins, signups...), when each last ran. */
  syncs: readonly { stream: string; lastSyncedAt: Date | null; failed: boolean }[];
  /** Upcoming events that didn't reach Google Calendar (0 for those who can't fix it). */
  calendarFailed: number;
  /** Apps that need attention (admins only). */
  attention: readonly { provider: string; status: "ERROR" | "NEEDS_REAUTH" }[];
  /** The viewer's own AI apps that worked in the workspace lately. */
  ai: readonly { name: string; lastUsedAt: Date }[];
}

const MINUTE = 60 * 1000;
/** A call shows from this long before it starts. */
const CALL_SOON_MIN = 15;
/** Longer than this isn't a call (a day-long event with a link on it). */
const CALL_MAX_MS = 8 * 60 * MINUTE;
/** Syncs and AI work stay on the feed this long. */
const RECENT_MS = 72 * 60 * MINUTE;
const LIMIT = 6;

const CALL_APP: Record<string, string> = {
  ZOOM: "Zoom",
  MEET: "Google Meet",
  TEAMS: "Microsoft Teams",
};

const INTEGRATION_NAME: Record<string, string> = {
  GOOGLE_CALENDAR: "Google Calendar",
  GOOGLE_MEET: "Google Meet",
  ZOOM: "Zoom",
  MICROSOFT_TEAMS: "Microsoft Teams",
  EMAIL_RESEND: "Email sending",
  SUPABASE_SOURCE: "The website sync",
  NETLIFY_BUILD_HOOK: "Website builds",
  CLAUDE: "Claude",
  OPENAI_COMPATIBLE: "The AI model",
};

const STREAM_WORD: Record<string, string> = {
  checkins: "check-ins",
  signups: "sign-ups",
  sessions: "sessions",
  ballots: "votes",
  unsubscribes: "unsubscribes",
};

/** "just now", "12 min ago", "3 h ago", "2 days ago". */
export function agoWords(at: Date, now: Date): string {
  const min = Math.max(0, Math.round((now.getTime() - at.getTime()) / MINUTE));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} ${d === 1 ? "day" : "days"} ago`;
}

/** Join only opens a secure web link, never whatever else was typed in. */
function joinable(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

function andList(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

export function buildAppsFeed(input: AppsFeedInput): AppsFeed {
  const { now, base } = input;
  const live: AppsRow[] = [];
  const warn: AppsRow[] = [];
  const plain: (AppsRow & { at: number })[] = [];

  // The nearest to now first: the one starting in two minutes before the one an hour in.
  const calls = [...input.calls].sort(
    (a, b) =>
      Math.abs(a.startsAt.getTime() - now.getTime()) -
      Math.abs(b.startsAt.getTime() - now.getTime()),
  );
  for (const call of calls) {
    if (call.endsAt.getTime() - call.startsAt.getTime() > CALL_MAX_MS || !joinable(call.url))
      continue;
    const app = CALL_APP[call.provider] ?? "Call";
    const mins = Math.ceil((call.startsAt.getTime() - now.getTime()) / MINUTE);
    const on = call.startsAt.getTime() <= now.getTime() && call.endsAt.getTime() > now.getTime();
    if (!on && (mins <= 0 || mins > CALL_SOON_MIN)) continue;
    live.push({
      key: `call:${call.id}`,
      app: "call",
      text: on ? `${app}: ${call.title} is on now` : `${app}: ${call.title} starts soon`,
      sub: on ? "Live" : `Starts in ${mins} min`,
      href: `${base}/meetings/${call.id}`,
      action: { label: "Join", href: call.url, external: true },
      tone: on ? "live" : "plain",
    });
  }

  for (const a of input.attention) {
    const name = INTEGRATION_NAME[a.provider] ?? "An app";
    warn.push({
      key: `attention:${a.provider}`,
      app: "integration",
      text: a.status === "NEEDS_REAUTH" ? `${name} needs reconnecting` : `${name} isn't working`,
      sub: null,
      href: `${base}/integrations`,
      action: { label: "Fix", href: `${base}/integrations`, external: false },
      tone: "warn",
    });
  }

  if (input.calendarFailed > 0) {
    const n = input.calendarFailed;
    warn.push({
      key: "calendar:failed",
      app: "calendar",
      text: `${n} ${n === 1 ? "event didn't" : "events didn't"} reach Google Calendar`,
      sub: null,
      href: `${base}/calendar`,
      tone: "warn",
    });
  }

  const failed = input.syncs.filter((s) => s.failed).map((s) => STREAM_WORD[s.stream] ?? s.stream);
  if (failed.length > 0) {
    warn.push({
      key: "website:failed",
      app: "website",
      text: `The website sync couldn't bring in ${andList(failed)}`,
      sub: null,
      href: `${base}/integrations`,
      tone: "warn",
    });
  }
  const synced = input.syncs.filter(
    (s) => !s.failed && s.lastSyncedAt && now.getTime() - s.lastSyncedAt.getTime() <= RECENT_MS,
  );
  if (synced.length > 0) {
    const latest = new Date(Math.max(...synced.map((s) => s.lastSyncedAt!.getTime())));
    plain.push({
      key: "website:synced",
      app: "website",
      text: `Website: ${andList(synced.map((s) => STREAM_WORD[s.stream] ?? s.stream))} synced`,
      sub: agoWords(latest, now),
      href: `${base}/databases`,
      tone: "plain",
      at: latest.getTime(),
    });
  }

  for (const ai of input.ai) {
    if (now.getTime() - ai.lastUsedAt.getTime() > RECENT_MS) continue;
    plain.push({
      key: `ai:${ai.name}`,
      app: "ai",
      text: `${ai.name} worked in the workspace for you`,
      sub: agoWords(ai.lastUsedAt, now),
      href: null,
      tone: "plain",
      at: ai.lastUsedAt.getTime(),
    });
  }

  plain.sort((a, b) => b.at - a.at);
  const rows = [...live, ...warn, ...plain.map(({ at: _at, ...row }) => row)].slice(0, LIMIT);
  return { rows };
}
