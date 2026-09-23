import { redactText, redactValue } from "@/lib/redact";

/**
 * Keeps secrets and personal data out of error reports and logs.
 *
 * - scrubSentryEvent: Sentry `beforeSend` / `beforeSendTransaction`. Drops
 *   request cookies, headers that carry credentials and request bodies,
 *   and redacts every string left in the event (messages, exception values,
 *   breadcrumbs, extra, contexts, URLs with tokens or query strings).
 * - scrubBreadcrumb: Sentry `beforeBreadcrumb`.
 * - installConsoleScrubber: wraps console.error/warn/info/log so string and
 *   Error arguments are redacted before they reach the platform's log
 *   drain. Installed on the server in production (or with LOG_SCRUB=on);
 *   LOG_SCRUB=off disables it.
 *
 * Pure (no server imports): the browser Sentry client uses it too.
 */

type Loose = Record<string, unknown>;

const DROP_HEADERS = /^(authorization|cookie|set-cookie|x-vercel-protection-bypass|proxy-authorization)$/i;

export function scrubSentryEvent<T>(event: T): T {
  if (!event || typeof event !== "object") return event;
  const e = event as Loose;
  const request = e.request as Loose | undefined;
  if (request) {
    delete request.cookies;
    delete request.data;
    if (request.headers && typeof request.headers === "object") {
      const headers = request.headers as Loose;
      for (const name of Object.keys(headers)) {
        if (DROP_HEADERS.test(name)) delete headers[name];
      }
    }
    if (typeof request.query_string === "string" && request.query_string) {
      request.query_string = "[redacted]";
    }
  }
  const user = e.user as Loose | undefined;
  if (user) {
    // Keep the opaque id for grouping; drop contact details.
    e.user = user.id ? { id: user.id } : undefined;
  }
  return redactValue(e) as T;
}

export function scrubBreadcrumb<T>(breadcrumb: T): T {
  return redactValue(breadcrumb) as T;
}

const WRAPPED = Symbol.for("cbc.consoleScrubber");

function scrubArg(arg: unknown): unknown {
  if (typeof arg === "string") return redactText(arg);
  if (arg instanceof Error) {
    const copy = new Error(redactText(arg.message));
    copy.name = arg.name;
    copy.stack = arg.stack ? redactText(arg.stack) : undefined;
    return copy;
  }
  if (arg && typeof arg === "object") return redactValue(arg);
  return arg;
}

/** Whether the console scrubber should run in this process. */
export function consoleScrubberEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (env.LOG_SCRUB === "off") return false;
  if (env.LOG_SCRUB === "on") return true;
  return env.NODE_ENV === "production";
}

/** Wraps the console methods once per process. */
export function installConsoleScrubber(target: Console = console): void {
  const c = target as Console & { [WRAPPED]?: boolean };
  if (c[WRAPPED]) return;
  for (const method of ["error", "warn", "info", "log", "debug"] as const) {
    const original = c[method].bind(c);
    c[method] = (...args: unknown[]) => original(...args.map(scrubArg));
  }
  c[WRAPPED] = true;
}
