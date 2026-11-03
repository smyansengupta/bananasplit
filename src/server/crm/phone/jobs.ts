import type { Prisma } from "@/generated/prisma/client";
import { maskNumber } from "@/lib/crm/phone";
import { withSystemOrgTx } from "@/server/db/context";
import { enqueueJob } from "@/server/jobs/enqueue";
import { PermanentJobError, type JobHandler } from "@/server/jobs/types";
import { sendOrgSms } from "@/server/sms";
import { deleteBlobs, getBlob, putBlob, randomKeyId } from "@/server/storage";

import { AUDIO_EXT, sniffAudio } from "./audio";
import { syncCallActivity } from "./calls";
import { deepgramKey, loadPhoneConnection, phoneWebhookUrls } from "./connection";
import {
  deepgramTranscribe,
  downloadRecording,
  ProviderError,
  telnyxRecordingUrl,
  telnyxSendText,
  transcriptText,
  twilioRecordingUrl,
  twilioSendText,
} from "./providers";
import { summarizeTranscript, summaryText } from "./summary";
import { NO_DEEPGRAM_NOTE } from "./voice-notes";

/**
 * The phone's jobs (src/server/jobs/registry.ts rows crm-text-send,
 * crm-call-audio and crm-transcribe). The network work (the provider, the
 * store, Deepgram, the model) runs here with no transaction open; each
 * write is its own short withSystemOrgTx in the job's organization. Each is
 * idempotent: a text already sent isn't sent again, a recording already
 * stored isn't fetched again, a transcript already written isn't redone.
 */

function permanentIf(error: unknown): never {
  if (error instanceof ProviderError && error.permanent) throw new PermanentJobError(error.message);
  throw error;
}

// ---- Texts ----------------------------------------------------------------------------

export const crmTextSendJob: JobHandler<{ textId: string }> = async (run) => {
  const orgId = run.organizationId;
  if (!orgId) throw new PermanentJobError("crm-text-send needs an organization");
  const text = await withSystemOrgTx(orgId, ({ db }) =>
    db.crmTextMessage.findFirst({ where: { id: run.payload.textId, organizationId: orgId } }),
  );
  if (!text || text.direction !== "OUTBOUND") return;
  if (!["queued", "scheduled", "failed"].includes(text.status)) return;
  // A STOP or do-not-contact that came in after it was written wins.
  const person = text.personId
    ? await withSystemOrgTx(orgId, ({ db }) =>
        db.crmPerson.findFirst({ where: { id: text.personId!, organizationId: orgId }, select: { doNotContact: true, consent: true } }),
      )
    : null;
  const consent = (person?.consent ?? {}) as { text?: { granted?: boolean } };
  if (!person || person.doNotContact || consent.text?.granted !== true) {
    await setTextStatus(orgId, text.id, "cancelled");
    return;
  }
  const conn = await loadPhoneConnection(orgId, text.provider === "twilio" ? "twilio" : "telnyx");
  if (!conn) {
    await setTextStatus(orgId, text.id, "failed");
    throw new PermanentJobError("the phone provider was disconnected");
  }
  const urls = phoneWebhookUrls(orgId);
  try {
    const sent = await sendOrgSms(text.toNumber, text.body, () =>
      conn.provider === "telnyx"
        ? telnyxSendText(conn.apiKey, { from: text.fromNumber, to: text.toNumber, body: text.body, webhookUrl: urls.telnyx }, run.signal)
        : twilioSendText(
            conn.accountSid,
            conn.authToken,
            { from: text.fromNumber, to: text.toNumber, body: text.body, statusCallback: urls.twilioSms },
            run.signal,
          ),
    );
    await withSystemOrgTx(orgId, async ({ db }) => {
      await db.crmTextMessage.update({
        where: { id: text.id },
        data: { status: sent.delivery === "off" ? "held" : "sent", providerMessageId: sent.id, sentAt: new Date() },
      });
      if (text.activityId) {
        await db.crmActivity.updateMany({
          where: { id: text.activityId, organizationId: orgId },
          data: { meta: { textId: text.id, status: "sent" } as Prisma.InputJsonObject },
        });
      }
    });
  } catch (error) {
    console.warn(`[crm:text] text to ${maskNumber(text.toNumber)} failed: ${error instanceof Error ? error.message : "error"}`);
    if (run.attempt >= run.maxAttempts || (error instanceof ProviderError && error.permanent)) {
      await setTextStatus(orgId, text.id, "failed");
    }
    permanentIf(error);
  }
};

async function setTextStatus(orgId: string, textId: string, status: string) {
  await withSystemOrgTx(orgId, ({ db }) =>
    db.crmTextMessage.updateMany({ where: { id: textId, organizationId: orgId }, data: { status } }),
  );
}

// ---- Call recordings ------------------------------------------------------------------

export const crmCallAudioJob: JobHandler<{ callId: string; recordingId: string }> = async (run) => {
  const orgId = run.organizationId;
  if (!orgId) throw new PermanentJobError("crm-call-audio needs an organization");
  const call = await withSystemOrgTx(orgId, ({ db }) =>
    db.crmCall.findFirst({ where: { id: run.payload.callId, organizationId: orgId } }),
  );
  if (!call) return;
  if (!call.recordingConsent) return;
  if (!call.recordingKey) {
    const conn = await loadPhoneConnection(orgId, call.provider === "twilio" ? "twilio" : "telnyx", { evenIfNotConnected: true });
    if (!conn) throw new PermanentJobError("the phone provider was disconnected");
    let audio: { body: Buffer; contentType: string };
    try {
      audio =
        conn.provider === "telnyx"
          ? await downloadRecording(await telnyxRecordingUrl(conn.apiKey, run.payload.recordingId, run.signal), null, run.signal)
          : await downloadRecording(
              twilioRecordingUrl(conn.accountSid, run.payload.recordingId),
              { accountSid: conn.accountSid, authToken: conn.authToken },
              run.signal,
            );
    } catch (error) {
      permanentIf(error);
    }
    const type = sniffAudio(audio.body) ?? "audio/mpeg";
    const stored = await putBlob("crm-audio", orgId, ["calls", `${randomKeyId()}.${AUDIO_EXT[type]}`], audio.body, {
      contentType: type,
      serverGenerated: true,
    });
    const kept = await withSystemOrgTx(orgId, async ({ db }) => {
      const r = await db.crmCall.updateMany({
        where: { id: call.id, organizationId: orgId, recordingKey: null },
        data: { recordingKey: stored.key },
      });
      if (r.count > 0) await syncCallActivity(db, orgId, call.id);
      return r.count > 0;
    });
    if (!kept) {
      await deleteBlobs([stored.key]);
    }
  }
  await withSystemOrgTx(orgId, ({ db }) =>
    enqueueJob(db, {
      orgId,
      kind: "crm-transcribe",
      key: `call:${call.id}`,
      payload: { callId: call.id },
    }),
  );
};

// ---- Transcripts and summaries --------------------------------------------------------

/**
 * Writes out a recorded call or a voice note with the organization's
 * Deepgram key, then sums it up on its AI (the cap applies), and puts both
 * on the timeline. Without Deepgram it does nothing (a voice note already
 * says it's audio only); without AI the transcript still lands.
 */
export const crmTranscribeJob: JobHandler<{ callId?: string; activityId?: string }> = async (run) => {
  const orgId = run.organizationId;
  if (!orgId) throw new PermanentJobError("crm-transcribe needs an organization");
  const { callId, activityId } = run.payload;
  const key = await deepgramKey(orgId);

  if (callId) {
    const call = await withSystemOrgTx(orgId, ({ db }) =>
      db.crmCall.findFirst({
        where: { id: callId, organizationId: orgId },
        include: { person: { select: { name: true } } },
      }),
    );
    if (!call?.recordingKey || call.transcript) return;
    if (!key) return;
    const audio = await getBlob(call.recordingKey);
    if (!audio) return;
    let text: string;
    try {
      text = transcriptText(await deepgramTranscribe(key, audio, run.signal));
    } catch (error) {
      permanentIf(error);
    }
    const summary = text
      ? await summarizeTranscript(orgId, { transcript: text, kind: "call", about: call.person?.name, userId: call.userId })
      : null;
    await withSystemOrgTx(orgId, async ({ db }) => {
      await db.crmCall.update({
        where: { id: call.id },
        data: {
          transcript: text || "(Nothing was said.)",
          summary: summary?.ok ? summaryText(summary.summary) : null,
        },
      });
      await syncCallActivity(db, orgId, call.id);
    });
    return;
  }

  if (activityId) {
    const note = await withSystemOrgTx(orgId, ({ db }) =>
      db.crmActivity.findFirst({
        where: { id: activityId, organizationId: orgId, deletedAt: null },
        select: { id: true, meta: true, createdById: true, targets: { select: { targetKind: true, targetId: true } } },
      }),
    );
    const meta = (note?.meta ?? {}) as Record<string, unknown>;
    if (!note || meta.voiceNote !== true || typeof meta.audioKey !== "string" || meta.transcribed === true) return;
    if (!key) {
      await withSystemOrgTx(orgId, ({ db }) =>
        db.crmActivity.update({
          where: { id: note.id },
          data: { body: NO_DEEPGRAM_NOTE, meta: { ...meta, transcribing: false } as Prisma.InputJsonObject },
        }),
      );
      return;
    }
    const audio = await getBlob(meta.audioKey);
    if (!audio) return;
    let text: string;
    try {
      text = transcriptText(await deepgramTranscribe(key, audio, run.signal));
    } catch (error) {
      if (run.attempt >= run.maxAttempts || (error instanceof ProviderError && error.permanent)) {
        await withSystemOrgTx(orgId, ({ db }) =>
          db.crmActivity.update({
            where: { id: note.id },
            data: {
              body: "Voice note, kept as audio. Deepgram couldn't write it out.",
              meta: { ...meta, transcribing: false } as Prisma.InputJsonObject,
            },
          }),
        );
      }
      permanentIf(error);
    }
    const personId = note.targets.find((t) => t.targetKind === "person")?.targetId;
    const about = personId
      ? (await withSystemOrgTx(orgId, ({ db }) =>
          db.crmPerson.findFirst({ where: { id: personId, organizationId: orgId }, select: { name: true } }),
        ))?.name
      : null;
    const summary = text
      ? await summarizeTranscript(orgId, { transcript: text, kind: "voice note", about, userId: note.createdById })
      : null;
    const body = [summary?.ok ? summaryText(summary.summary) : null, text ? `Transcript:\n${text}` : "Nothing was said."]
      .filter(Boolean)
      .join("\n\n");
    await withSystemOrgTx(orgId, ({ db }) =>
      db.crmActivity.update({
        where: { id: note.id },
        data: {
          body: body.slice(0, 20_000),
          meta: {
            ...meta,
            transcribing: false,
            transcribed: true,
            ...(summary && !summary.ok ? { summaryNote: summary.message } : {}),
          } as Prisma.InputJsonObject,
        },
      }),
    );
  }
};
