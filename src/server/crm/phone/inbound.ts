import { appUrl } from "@/lib/app-url";
import { readPhoneSettings, toE164 } from "@/lib/crm/phone";
import { withSystemOrgTx } from "@/server/db/context";

import { applyCallEvent, callStatusFrom, markNoticePlayed, recordingReady } from "./calls";
import { hangUp, readClientState, recordAfterNotice } from "./live";
import { receiveText, textStatus } from "./texts";

/**
 * What Telnyx and Twilio tell us, after the route has checked the
 * signature: each event opens one short service transaction in that
 * organization (the provider's network calls, like starting a recording
 * after the notice, run after it). Unknown events are ignored, so a
 * provider adding one never breaks anything.
 */

type Json = Record<string, unknown>;

function obj(v: unknown): Json {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {};
}

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

/** Telnyx's hangup cause as a call status. */
function telnyxHangupStatus(cause: string | null): "COMPLETED" | "BUSY" | "NO_ANSWER" | "FAILED" {
  switch (cause) {
    case "user_busy":
    case "busy":
      return "BUSY";
    case "no_answer":
    case "timeout":
    case "originator_cancel":
      return "NO_ANSWER";
    case "call_rejected":
    case "unspecified":
      return "FAILED";
    default:
      return "COMPLETED";
  }
}

function seconds(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const s = Date.parse(start);
  const e = Date.parse(end);
  return Number.isFinite(s) && Number.isFinite(e) && e >= s ? Math.round((e - s) / 1000) : null;
}

export async function handleTelnyxEvent(organizationId: string, body: unknown): Promise<void> {
  const data = obj(obj(body).data);
  const type = str(data.event_type);
  const p = obj(data.payload);
  if (!type) return;
  const ccid = str(p.call_control_id);
  const state = readClientState(p.client_state);

  switch (type) {
    case "call.initiated":
    case "call.answered":
    case "call.bridged": {
      await withSystemOrgTx(organizationId, ({ db }) =>
        applyCallEvent(db, organizationId, {
          callId: state?.what === "call" ? state.callId : null,
          providerCallId: ccid,
          status: type === "call.initiated" ? "RINGING" : "IN_PROGRESS",
        }),
      );
      return;
    }
    case "call.hangup": {
      const answered = Boolean(str(p.start_time)) && str(p.hangup_cause) === "normal_clearing";
      await withSystemOrgTx(organizationId, ({ db }) =>
        applyCallEvent(db, organizationId, {
          callId: state?.what === "call" ? state.callId : null,
          providerCallId: ccid,
          status: telnyxHangupStatus(str(p.hangup_cause)),
          durationSec: answered ? seconds(str(p.start_time), str(p.end_time)) : 0,
        }),
      );
      return;
    }
    case "call.speak.ended": {
      if (state?.what !== "notice" || !ccid) return;
      const ok = await withSystemOrgTx(organizationId, ({ db }) => markNoticePlayed(db, organizationId, state.callId));
      if (ok) await recordAfterNotice(organizationId, ccid);
      return;
    }
    case "call.playback.ended": {
      if (state?.what === "vm" && ccid) await hangUp(organizationId, ccid);
      return;
    }
    case "call.recording.saved": {
      const recordingId = str(p.recording_id);
      if (!recordingId || !ccid) return;
      await withSystemOrgTx(organizationId, ({ db }) =>
        recordingReady(db, organizationId, {
          callId: state?.what === "notice" || state?.what === "call" ? state.callId : null,
          providerCallId: ccid,
          recordingId,
        }),
      );
      return;
    }
    case "message.received": {
      const from = str(obj(p.from).phone_number);
      const to = str(obj(Array.isArray(p.to) ? p.to[0] : null).phone_number);
      if (!from || !to) return;
      await withSystemOrgTx(organizationId, ({ db }) =>
        receiveText(db, organizationId, {
          provider: "telnyx",
          from,
          to,
          body: str(p.text) ?? "",
          providerMessageId: str(p.id),
        }),
      );
      return;
    }
    case "message.sent":
    case "message.finalized": {
      const id = str(p.id);
      const status = str(obj(Array.isArray(p.to) ? p.to[0] : null).status);
      if (id && status) await withSystemOrgTx(organizationId, ({ db }) => textStatus(db, organizationId, id, status));
      return;
    }
    default:
      return;
  }
}

// ---- Twilio ---------------------------------------------------------------------------

function xml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response/>';

/**
 * The softphone's outgoing call: the browser names our call row, never a
 * number, so a token can only dial who the CRM says (the row's own number,
 * from the organization's own number). With Record on, the notice plays to
 * the person as they answer and recording starts with the answer.
 */
export async function twilioVoice(organizationId: string, params: Record<string, string>): Promise<string> {
  const callId = params.CallId ?? "";
  const userId = (params.From ?? "").replace(/^client:/, "");
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(callId)) return `<?xml version="1.0" encoding="UTF-8"?><Response><Reject/></Response>`;
  const found = await withSystemOrgTx(organizationId, async ({ db }) => {
    const call = await db.crmCall.findFirst({
      where: { id: callId, organizationId, provider: "twilio", status: "QUEUED", userId },
      select: { id: true, toNumber: true, fromNumber: true },
    });
    if (!call) return null;
    if (params.CallSid) await db.crmCall.update({ where: { id: call.id }, data: { providerCallId: params.CallSid } });
    const s = await db.crmSettings.findUnique({ where: { organizationId }, select: { phone: true } });
    return { call, settings: readPhoneSettings(s?.phone) };
  });
  if (!found || !toE164(found.call.toNumber) || !found.call.fromNumber) {
    return `<?xml version="1.0" encoding="UTF-8"?><Response><Reject/></Response>`;
  }
  const record = params.Record === "1" && found.settings.recording !== "never";
  const base = `/api/crm/phone/twilio/${organizationId}`;
  const status = appUrl(`${base}/status`);
  const dial = [
    `callerId="${xml(found.call.fromNumber)}"`,
    `answerOnBridge="true"`,
    `action="${xml(status)}"`,
    ...(record
      ? [`record="record-from-answer-dual"`, `recordingStatusCallback="${xml(appUrl(`${base}/recording`))}"`, `recordingStatusCallbackEvent="completed"`]
      : []),
  ].join(" ");
  const number = record
    ? `<Number url="${xml(appUrl(`${base}/notice?call=${found.call.id}`))}">${xml(found.call.toNumber!)}</Number>`
    : `<Number>${xml(found.call.toNumber!)}</Number>`;
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Dial ${dial}>${number}</Dial></Response>`;
}

/** Played to the person as they answer, before the call connects: the recording notice. */
export async function twilioNotice(organizationId: string, callId: string | null): Promise<string> {
  if (!callId || !/^[A-Za-z0-9_-]{1,100}$/.test(callId)) return EMPTY_TWIML;
  const notice = await withSystemOrgTx(organizationId, async ({ db }) => {
    const s = await db.crmSettings.findUnique({ where: { organizationId }, select: { phone: true } });
    const settings = readPhoneSettings(s?.phone);
    if (settings.recording === "never") return null;
    const ok = await markNoticePlayed(db, organizationId, callId);
    return ok ? settings.notice : null;
  });
  return notice
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${xml(notice)}</Say></Response>`
    : EMPTY_TWIML;
}

/** The Dial's end (its action) and call status callbacks. */
export async function twilioStatus(organizationId: string, params: Record<string, string>): Promise<void> {
  const sid = params.ParentCallSid || params.CallSid;
  const raw = params.DialCallStatus || params.CallStatus;
  if (!sid || !raw) return;
  const duration = Number(params.DialCallDuration ?? params.CallDuration ?? "");
  await withSystemOrgTx(organizationId, ({ db }) =>
    applyCallEvent(db, organizationId, {
      providerCallId: sid,
      status: callStatusFrom(raw),
      durationSec: Number.isFinite(duration) && duration >= 0 ? duration : null,
    }),
  );
}

export async function twilioRecording(organizationId: string, params: Record<string, string>): Promise<void> {
  if (params.RecordingStatus && params.RecordingStatus !== "completed") return;
  const recordingId = params.RecordingSid;
  const sid = params.CallSid;
  if (!recordingId || !sid) return;
  await withSystemOrgTx(organizationId, ({ db }) => recordingReady(db, organizationId, { providerCallId: sid, recordingId }));
}

/** A text in, or a delivery report for one we sent. */
export async function twilioSms(organizationId: string, params: Record<string, string>): Promise<void> {
  const id = params.MessageSid || params.SmsSid;
  if (params.MessageStatus && !params.Body) {
    if (id) await withSystemOrgTx(organizationId, ({ db }) => textStatus(db, organizationId, id, params.MessageStatus!));
    return;
  }
  if (!params.From || !params.To) return;
  await withSystemOrgTx(organizationId, ({ db }) =>
    receiveText(db, organizationId, {
      provider: "twilio",
      from: params.From!,
      to: params.To!,
      body: params.Body ?? "",
      providerMessageId: id ?? null,
    }),
  );
}
