import { assertNoTx } from "@/server/db/context";
import { sanitize } from "@/server/jobs/sanitize";

/**
 * A minimal Google Calendar v3 REST client over plain fetch (no SDK): the
 * five calls the mirror and the import need. Every call:
 * - refuses to run inside a database transaction (assertNoTx), so a slow
 *   Google call never holds a pooled connection or runs for a write that
 *   might roll back;
 * - is bounded by the job's AbortSignal and a per-call timeout;
 * - maps failures to GoogleApiError with a sanitized message (no tokens, no
 *   emails, no query strings) and whether a retry can help.
 */

export const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const DEFAULT_TIMEOUT_MS = 10_000;

export class GoogleApiError extends Error {
  readonly status: number;
  readonly reason: string | null;
  constructor(status: number, reason: string | null, message: string) {
    super(sanitize(`Google Calendar ${status}${reason ? ` ${reason}` : ""}: ${message}`, 300));
    this.name = "GoogleApiError";
    this.status = status;
    this.reason = reason;
  }
  /** 404/410: the event (or calendar) is gone. */
  get gone(): boolean {
    return this.status === 404 || this.status === 410;
  }
  /** Worth retrying with backoff: server errors, throttling, an expired access token. */
  get retryable(): boolean {
    if (this.status >= 500 || this.status === 429 || this.status === 408 || this.status === 401)
      return true;
    return (
      this.status === 403 &&
      /rateLimitExceeded|userRateLimitExceeded|quotaExceeded/i.test(this.reason ?? "")
    );
  }
}

export interface GoogleEventDateTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

/** The fields of a Google event the suite reads or writes. */
export interface GoogleEvent {
  id: string;
  etag?: string;
  htmlLink?: string;
  status?: "confirmed" | "tentative" | "cancelled";
  summary?: string;
  description?: string;
  location?: string;
  start?: GoogleEventDateTime;
  end?: GoogleEventDateTime;
  recurringEventId?: string;
  updated?: string;
  extendedProperties?: { private?: Record<string, string>; shared?: Record<string, string> };
}

/** What the mirror sends (insert adds the deterministic id). */
export interface GoogleEventBody {
  id?: string;
  summary: string;
  description: string;
  location: string;
  start: GoogleEventDateTime;
  end: GoogleEventDateTime;
  status: "confirmed";
  transparency: "opaque";
  extendedProperties: { private: Record<string, string> };
}

export interface ListEventsOptions {
  timeMin?: Date;
  timeMax?: Date;
  pageToken?: string;
  maxResults?: number;
}

export interface CalendarClient {
  insertEvent(calendarId: string, body: GoogleEventBody): Promise<GoogleEvent>;
  getEvent(calendarId: string, eventId: string): Promise<GoogleEvent>;
  patchEvent(calendarId: string, eventId: string, body: GoogleEventBody): Promise<GoogleEvent>;
  deleteEvent(calendarId: string, eventId: string): Promise<void>;
  listEvents(
    calendarId: string,
    options?: ListEventsOptions,
  ): Promise<{ items: GoogleEvent[]; nextPageToken: string | null }>;
}

export interface ClientOptions {
  accessToken: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

async function readError(res: Response): Promise<{ reason: string | null; message: string }> {
  try {
    const body = (await res.json()) as {
      error?: { message?: string; status?: string; errors?: { reason?: string }[] } | string;
      error_description?: string;
    };
    if (typeof body.error === "string") {
      return { reason: body.error, message: body.error_description ?? body.error };
    }
    return {
      reason: body.error?.errors?.[0]?.reason ?? body.error?.status ?? null,
      message: body.error?.message ?? res.statusText,
    };
  } catch {
    return { reason: null, message: res.statusText || "request failed" };
  }
}

function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export function createCalendarClient(options: ClientOptions): CalendarClient {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function call<T>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    init: { body?: unknown; query?: Record<string, string | undefined> } = {},
  ): Promise<T> {
    assertNoTx("Google Calendar");
    const url = new URL(`${GOOGLE_CALENDAR_API}${path}`);
    for (const [k, v] of Object.entries(init.query ?? {}))
      if (v !== undefined) url.searchParams.set(k, v);
    const res = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${options.accessToken}`,
        accept: "application/json",
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: withTimeout(options.signal, timeoutMs),
      cache: "no-store",
      redirect: "error",
    });
    if (!res.ok) {
      const { reason, message } = await readError(res);
      throw new GoogleApiError(res.status, reason, message);
    }
    if (res.status === 204 || method === "DELETE") return undefined as T;
    return (await res.json()) as T;
  }

  const cal = (calendarId: string) => `/calendars/${encodeURIComponent(calendarId)}/events`;
  const ev = (calendarId: string, eventId: string) =>
    `${cal(calendarId)}/${encodeURIComponent(eventId)}`;

  return {
    insertEvent: (calendarId, body) =>
      call<GoogleEvent>("POST", cal(calendarId), { body, query: { sendUpdates: "none" } }),
    getEvent: (calendarId, eventId) => call<GoogleEvent>("GET", ev(calendarId, eventId)),
    patchEvent: (calendarId, eventId, body) => {
      // The id is fixed at insert; Google rejects a patch that repeats it.
      const { id: _id, ...rest } = body;
      return call<GoogleEvent>("PATCH", ev(calendarId, eventId), {
        body: rest,
        query: { sendUpdates: "none" },
      });
    },
    deleteEvent: (calendarId, eventId) =>
      call<void>("DELETE", ev(calendarId, eventId), { query: { sendUpdates: "none" } }),
    listEvents: async (calendarId, opts = {}) => {
      const page = await call<{ items?: GoogleEvent[]; nextPageToken?: string }>(
        "GET",
        cal(calendarId),
        {
          query: {
            singleEvents: "true",
            showDeleted: "false",
            orderBy: "startTime",
            maxResults: String(opts.maxResults ?? 250),
            timeMin: opts.timeMin?.toISOString(),
            timeMax: opts.timeMax?.toISOString(),
            pageToken: opts.pageToken,
          },
        },
      );
      return { items: page.items ?? [], nextPageToken: page.nextPageToken ?? null };
    },
  };
}
