/**
 * When the Integrations and apps ambient buttons show (Buttons3:
 * Integrations and apps): an app to reconnect, a sync to retry, Google
 * Calendar for an organization that makes events, an unverified sending
 * domain, and Forms for an organization already using forms. Pure: no
 * database, no request APIs.
 */

const DAY_MS = 86_400_000;

function ago(at: Date | string | null | undefined, now: Date): string | null {
  if (!at) return null;
  const days = Math.floor((now.getTime() - new Date(at).getTime()) / DAY_MS);
  if (days < 0) return null;
  return days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
}

/** "Reconnect": an app whose sign-in expired, or that keeps failing. */
export function needsReconnect(
  app: { status: string; lastVerifiedAt?: Date | string | null },
  now: Date,
): { reason: string } | null {
  const when = ago(app.lastVerifiedAt, now);
  if (app.status === "NEEDS_REAUTH") {
    return {
      reason: when ? `Its sign-in stopped working, last checked ${when}` : "Its sign-in expired",
    };
  }
  if (app.status === "ERROR") {
    return { reason: when ? `It stopped working, last checked ${when}` : "It stopped working" };
  }
  return null;
}

/**
 * "Retry now": a sync that failed while the connection still works (a
 * connection that needs signing in again gets Reconnect instead).
 */
export function syncToRetry(input: {
  status: string;
  failed: number;
  lastError: string | null;
}): { reason: string } | null {
  if (input.status !== "CONNECTED" && input.status !== "ERROR") return null;
  if (input.failed > 0) {
    return {
      reason: input.failed === 1 ? "1 item didn't sync" : `${input.failed} items didn't sync`,
    };
  }
  if (input.status === "ERROR" || input.lastError) return { reason: "The last sync failed" };
  return null;
}

/** "Connect Google Calendar": events are being made here, and Google isn't connected. */
export function suggestGoogleCalendar(input: {
  googleStatus: string | null;
  canManage: boolean;
  /** Events made in the last 30 days. */
  recentEvents: number;
}): { reason: string } | null {
  if (!input.canManage || input.recentEvents < 2) return null;
  if (input.googleStatus === "CONNECTED" || input.googleStatus === "ERROR") return null;
  if (input.googleStatus === "NEEDS_REAUTH") return null;
  return { reason: `${input.recentEvents} events made in the last 30 days` };
}

/** "Verify domain": your own sender is saved, and Resend hasn't verified its domain. */
export function domainToVerify(input: {
  hasSecret: boolean;
  domainStatus: string | null;
}): { reason: string } | null {
  if (!input.hasSecret || !input.domainStatus || input.domainStatus === "verified") return null;
  return { reason: `Your sending domain is ${input.domainStatus.replace(/_/g, " ")}` };
}

/** "Add Forms": the organization has forms, and the Forms add-on is off. */
export function suggestFormsAddOn(input: {
  added: boolean;
  locked: boolean;
  canManage: boolean;
  forms: number;
}): { reason: string } | null {
  if (input.added || input.locked || !input.canManage || input.forms === 0) return null;
  return {
    reason:
      input.forms === 1
        ? "Your organization has a form"
        : `Your organization has ${input.forms} forms`,
  };
}
