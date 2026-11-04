import { ConferenceProvider, IntegrationProvider } from "@/generated/prisma/enums";
import { assertNoTx } from "@/server/db/context";

import { conferenceHttp } from "./oauth";
import { isAllowedJoinUrl, type ProviderDef, providerOf } from "./providers";
import { clearAccessToken, getAccessToken } from "./token";
import {
  ConferenceApiError,
  ConferenceReauthError,
  type ConferenceClient,
  type ConferenceContext,
  type ConferenceDialIn,
  type ConferenceDraft,
  type ConferenceMeeting,
} from "./types";

/**
 * The three providers' APIs (docs/features/meetings.md).
 *
 * Each one creates a meeting in the account the org connected, and returns
 * the same shape. Nothing here reads the database beyond the access token, and
 * nothing here is called with a transaction open: these are the network calls
 * the conference-sync job makes.
 *
 * What each provider actually gives us differs, and the difference is real:
 *
 *   Google Meet  a meeting SPACE, with no start time of its own. The link is
 *                permanent and reusable, so moving the meeting is a no-op at
 *                Google - our own calendar entry and reminders carry the time.
 *   Zoom         a scheduled meeting with a start time, duration, passcode,
 *                dial-in numbers and a separate host start_url.
 *   Teams        an onlineMeeting with a start and end, and a join URL.
 */

const JSON_HEADERS = { "content-type": "application/json", accept: "application/json" } as const;

async function call(
  def: ProviderDef,
  url: string,
  init: RequestInit,
  what: string,
  ctx: ConferenceContext,
): Promise<Record<string, unknown>> {
  assertNoTx(`${def.integration} ${what}`);
  const token = await getAccessToken(ctx.orgId, def.integration, { signal: ctx.signal });
  const timeout = AbortSignal.timeout(15_000);
  const res = await conferenceHttp.fetch(url, {
    ...init,
    headers: { ...JSON_HEADERS, ...(init.headers ?? {}), authorization: `Bearer ${token}` },
    signal: ctx.signal ? AbortSignal.any([ctx.signal, timeout]) : timeout,
    cache: "no-store",
    redirect: "error",
  });
  if (res.status === 204 || res.status === 404) return {};
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  if (!res.ok) {
    // A 401 means the cached access token is no longer good: drop it so the
    // next attempt refreshes rather than replaying a dead token.
    if (res.status === 401) {
      clearAccessToken(ctx.orgId, def.integration);
      throw new ConferenceReauthError(def.integration, `${def.label} rejected the access token.`);
    }
    throw new ConferenceApiError(res.status, errorCode(body), errorMessage(def, res.status, body, what));
  }
  return body;
}

function errorCode(body: Record<string, unknown>): string | null {
  if (typeof body.code === "string" || typeof body.code === "number") return String(body.code);
  const err = body.error;
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && typeof (err as { code?: unknown }).code === "string")
    return (err as { code: string }).code;
  return null;
}

function errorMessage(
  def: ProviderDef,
  status: number,
  body: Record<string, unknown>,
  what: string,
): string {
  const nested = body.error as { message?: unknown } | undefined;
  const raw =
    (typeof body.message === "string" && body.message) ||
    (nested && typeof nested.message === "string" && nested.message) ||
    "";
  // Zoom's 4700 is always a missing scope on the app; say which one, because
  // nothing else in the message tells an admin what to fix.
  const hint =
    errorCode(body) === "4700"
      ? ` Add the ${def.required.join(", ")} scope to the ${def.label} app, then connect again.`
      : "";
  return `${def.label} ${what} failed (${status})${raw ? `: ${raw}` : ""}${hint}`;
}

function requireJoinUrl(def: ProviderDef, raw: unknown, what: string): string {
  if (typeof raw !== "string" || !isAllowedJoinUrl(raw, def.joinHosts)) {
    throw new ConferenceApiError(
      502,
      null,
      `${def.label} ${what} returned a join link we will not store (expected https on ${def.joinHosts.join(" or ")}).`,
    );
  }
  return raw;
}

function optionalHostUrl(def: ProviderDef, raw: unknown): string | null {
  return typeof raw === "string" && isAllowedJoinUrl(raw, def.joinHosts) ? raw : null;
}

/**
 * A provider's meeting id before it becomes part of a URL path. The value is
 * ours (we stored it) but it arrived from the network once, so it is checked
 * rather than trusted: no slashes beyond the one in a Meet space name, no
 * dots, nothing that could climb out of the path it is pasted into.
 */
function safeMeetingId(def: ProviderDef, id: string, prefix?: string): string {
  const ok = prefix
    ? id.startsWith(prefix) && /^[A-Za-z0-9_-]{1,120}$/.test(id.slice(prefix.length))
    : /^[A-Za-z0-9_.=-]{1,255}$/.test(id) && !id.includes("..");
  if (!ok) {
    throw new ConferenceApiError(
      500,
      null,
      `${def.label} meeting id is not a shape we will put in a request path.`,
    );
  }
  return id;
}

function str(raw: unknown): string | null {
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

// ------------------------------------------------------------ Google Meet

const meetDef = () => providerOf(IntegrationProvider.GOOGLE_MEET)!;

/**
 * A Meet space (POST https://meet.googleapis.com/v2/spaces). The space has no
 * time of its own: it is a room that stays open, and the meeting's when lives
 * in Bananasplit and in the calendar entry we already mirror. So `update` has
 * nothing to send, and `remove` only ends any active conference - Google has
 * no delete for a space, and the link stops being advertised the moment the
 * meeting is cancelled here.
 */
export const meetClient: ConferenceClient = {
  provider: ConferenceProvider.MEET,
  integration: IntegrationProvider.GOOGLE_MEET,
  joinHosts: meetDef().joinHosts,

  async create(_draft: ConferenceDraft, ctx: ConferenceContext): Promise<ConferenceMeeting> {
    const def = meetDef();
    const body = await call(
      def,
      "https://meet.googleapis.com/v2/spaces",
      { method: "POST", body: JSON.stringify({}) },
      "space create",
      ctx,
    );
    const name = str(body.name);
    if (!name) throw new ConferenceApiError(502, null, "Google Meet returned no space name");
    return {
      meetingId: name,
      joinUrl: requireJoinUrl(def, body.meetingUri, "space create"),
      hostUrl: null,
      passcode: null,
      dialIn: [],
    };
  },

  async update(
    meetingId: string,
    _draft: ConferenceDraft,
    ctx: ConferenceContext,
  ): Promise<ConferenceMeeting> {
    const def = meetDef();
    // Nothing to change at Google; read it back so a space someone deleted by
    // hand surfaces as an error rather than a link that no longer works.
    const body = await call(
      def,
      `https://meet.googleapis.com/v2/${safeMeetingId(def, meetingId, "spaces/")}`,
      { method: "GET" },
      "space read",
      ctx,
    );
    const uri = body.meetingUri;
    if (uri === undefined) {
      throw new ConferenceApiError(404, null, "Google Meet no longer has that space");
    }
    return {
      meetingId,
      joinUrl: requireJoinUrl(def, uri, "space read"),
      hostUrl: null,
      passcode: null,
      dialIn: [],
    };
  },

  async remove(meetingId: string, ctx: ConferenceContext): Promise<void> {
    // endActiveConference turns out anyone still in the room. A space with
    // nobody in it answers 400 FAILED_PRECONDITION, which is the state we want.
    try {
      await call(
        meetDef(),
        `https://meet.googleapis.com/v2/${safeMeetingId(meetDef(), meetingId, "spaces/")}:endActiveConference`,
        { method: "POST", body: JSON.stringify({}) },
        "end conference",
        ctx,
      );
    } catch (error) {
      if (error instanceof ConferenceApiError && error.status === 400) return;
      throw error;
    }
  },
};

// ------------------------------------------------------------------- Zoom

const zoomDef = () => providerOf(IntegrationProvider.ZOOM)!;

function zoomBody(draft: ConferenceDraft): Record<string, unknown> {
  const minutes = Math.max(
    15,
    Math.round((draft.endsAt.getTime() - draft.startsAt.getTime()) / 60000),
  );
  return {
    topic: draft.title.slice(0, 200),
    // 2 is a scheduled meeting.
    type: 2,
    start_time: draft.startsAt.toISOString().replace(/\.\d{3}Z$/, "Z"),
    duration: Math.min(minutes, 60 * 24),
    timezone: draft.timeZone,
    settings: { join_before_host: true, waiting_room: false },
  };
}

function zoomDialIn(body: Record<string, unknown>): ConferenceDialIn[] {
  const settings = body.settings as { global_dial_in_numbers?: unknown } | undefined;
  const list = settings?.global_dial_in_numbers;
  if (!Array.isArray(list)) return [];
  return list.slice(0, 10).flatMap((raw) => {
    const row = raw as { country?: unknown; number?: unknown };
    const number = str(row.number);
    return number ? [{ country: str(row.country), number, pin: null }] : [];
  });
}

function zoomMeeting(def: ProviderDef, body: Record<string, unknown>, what: string): ConferenceMeeting {
  const id = body.id;
  if (typeof id !== "string" && typeof id !== "number")
    throw new ConferenceApiError(502, null, "Zoom returned no meeting id");
  return {
    meetingId: String(id),
    joinUrl: requireJoinUrl(def, body.join_url, what),
    hostUrl: optionalHostUrl(def, body.start_url),
    passcode: str(body.password),
    dialIn: zoomDialIn(body),
  };
}

export const zoomClient: ConferenceClient = {
  provider: ConferenceProvider.ZOOM,
  integration: IntegrationProvider.ZOOM,
  joinHosts: zoomDef().joinHosts,

  async create(draft: ConferenceDraft, ctx: ConferenceContext): Promise<ConferenceMeeting> {
    const def = zoomDef();
    // "me" is the account that granted the token, which is the one the org
    // connected: the meeting is created there.
    const body = await call(
      def,
      "https://api.zoom.us/v2/users/me/meetings",
      { method: "POST", body: JSON.stringify(zoomBody(draft)) },
      "meeting create",
      ctx,
    );
    return zoomMeeting(def, body, "meeting create");
  },

  async update(
    meetingId: string,
    draft: ConferenceDraft,
    ctx: ConferenceContext,
  ): Promise<ConferenceMeeting> {
    const def = zoomDef();
    const url = `https://api.zoom.us/v2/meetings/${encodeURIComponent(safeMeetingId(def, meetingId))}`;
    // PATCH answers 204 with no body, so read it back for the current links.
    await call(def, url, { method: "PATCH", body: JSON.stringify(zoomBody(draft)) }, "meeting update", ctx);
    const body = await call(def, url, { method: "GET" }, "meeting read", ctx);
    if (body.id === undefined)
      throw new ConferenceApiError(404, null, "Zoom no longer has that meeting");
    return zoomMeeting(def, body, "meeting read");
  },

  async remove(meetingId: string, ctx: ConferenceContext): Promise<void> {
    await call(
      zoomDef(),
      `https://api.zoom.us/v2/meetings/${encodeURIComponent(safeMeetingId(zoomDef(), meetingId))}`,
      { method: "DELETE" },
      "meeting delete",
      ctx,
    );
  },
};

// ---------------------------------------------------------------- MS Teams

const teamsDef = () => providerOf(IntegrationProvider.MICROSOFT_TEAMS)!;

function teamsBody(draft: ConferenceDraft): Record<string, unknown> {
  return {
    subject: draft.title.slice(0, 200),
    startDateTime: draft.startsAt.toISOString(),
    endDateTime: draft.endsAt.toISOString(),
  };
}

function teamsMeeting(def: ProviderDef, body: Record<string, unknown>, what: string): ConferenceMeeting {
  const id = str(body.id);
  if (!id) throw new ConferenceApiError(502, null, "Microsoft returned no meeting id");
  const info = body.audioConferencing as
    | { tollNumber?: unknown; tollFreeNumber?: unknown; conferenceId?: unknown }
    | undefined;
  const dialIn: ConferenceDialIn[] = [];
  for (const raw of [info?.tollNumber, info?.tollFreeNumber]) {
    const number = str(raw);
    if (number) dialIn.push({ country: null, number, pin: str(info?.conferenceId) });
  }
  return {
    meetingId: id,
    joinUrl: requireJoinUrl(def, body.joinWebUrl, what),
    hostUrl: null,
    passcode: null,
    dialIn,
  };
}

export const teamsClient: ConferenceClient = {
  provider: ConferenceProvider.TEAMS,
  integration: IntegrationProvider.MICROSOFT_TEAMS,
  joinHosts: teamsDef().joinHosts,

  async create(draft: ConferenceDraft, ctx: ConferenceContext): Promise<ConferenceMeeting> {
    const def = teamsDef();
    const body = await call(
      def,
      "https://graph.microsoft.com/v1.0/me/onlineMeetings",
      { method: "POST", body: JSON.stringify(teamsBody(draft)) },
      "meeting create",
      ctx,
    );
    return teamsMeeting(def, body, "meeting create");
  },

  async update(
    meetingId: string,
    draft: ConferenceDraft,
    ctx: ConferenceContext,
  ): Promise<ConferenceMeeting> {
    const def = teamsDef();
    const body = await call(
      def,
      `https://graph.microsoft.com/v1.0/me/onlineMeetings/${encodeURIComponent(safeMeetingId(def, meetingId))}`,
      { method: "PATCH", body: JSON.stringify(teamsBody(draft)) },
      "meeting update",
      ctx,
    );
    if (body.id === undefined)
      throw new ConferenceApiError(404, null, "Microsoft no longer has that meeting");
    return teamsMeeting(def, body, "meeting update");
  },

  async remove(meetingId: string, ctx: ConferenceContext): Promise<void> {
    await call(
      teamsDef(),
      `https://graph.microsoft.com/v1.0/me/onlineMeetings/${encodeURIComponent(safeMeetingId(teamsDef(), meetingId))}`,
      { method: "DELETE" },
      "meeting delete",
      ctx,
    );
  },
};

const CLIENTS: readonly ConferenceClient[] = [meetClient, zoomClient, teamsClient];

/** The client for an Event's conferenceProvider, or null (NONE and OTHER). */
export function clientFor(provider: ConferenceProvider): ConferenceClient | null {
  return CLIENTS.find((c) => c.provider === provider) ?? null;
}
