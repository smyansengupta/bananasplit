"use server";

import type { Prisma } from "@/generated/prisma/client";
import { readConsent, readPhoneSettings, type ConsentChannel } from "@/lib/crm/phone";
import { phoneStatus } from "@/server/crm/phone/connection";
import { CrmError } from "@/server/crm/access";
import { logCall, startCall, type LogCallInput, type StartedCall } from "@/server/crm/phone/calls";
import { dropVoicemail, softphoneToken, startRecording, type SoftphoneToken } from "@/server/crm/phone/live";
import { queueText, setConsent } from "@/server/crm/phone/texts";

import { crmAction, crmGate, toResult, type CrmResult } from "./run";

/**
 * Calls, texts and the phone settings (docs/features/crm.md, Phase 5).
 * Everything that only touches the database runs in one member transaction
 * (crmAction). What talks to Telnyx or Twilio first commits the member's
 * check (crmGate), then calls the provider with no transaction open.
 */

export const logCallAction = crmAction(async (ctx, _access, input: LogCallInput) => logCall(ctx, input));

export const startCallAction = crmAction(
  async (ctx, _access, input: { personId: string; record?: boolean }): Promise<{ call: StartedCall }> => ({
    call: await startCall(ctx, input),
  }),
);

export async function softphoneTokenAction(orgId: string): Promise<CrmResult<{ phone: SoftphoneToken }>> {
  try {
    const me = await crmGate(orgId);
    return { ok: true, phone: await softphoneToken(orgId, me.userId) };
  } catch (error) {
    return toResult(error);
  }
}

export async function recordCallAction(orgId: string, callId: string): Promise<CrmResult> {
  try {
    const me = await crmGate(orgId);
    await startRecording(orgId, String(callId), me.userId);
    return { ok: true };
  } catch (error) {
    return toResult(error);
  }
}

export async function dropVoicemailAction(orgId: string, callId: string): Promise<CrmResult> {
  try {
    const me = await crmGate(orgId);
    await dropVoicemail(orgId, String(callId), me.userId);
    return { ok: true };
  } catch (error) {
    return toResult(error);
  }
}

export const setConsentAction = crmAction(
  async (ctx, _access, personId: string, channel: ConsentChannel, input: { granted: boolean; how: string }) => {
    if (!["email", "text", "call"].includes(channel)) throw new CrmError("Pick text, email or calls.");
    await setConsent(ctx, personId, channel, input);
    return {};
  },
);

/** One person's texts, whether texting is set up, and their consent: the text window anywhere. */
export const textThreadAction = crmAction(async (ctx, _access, personId: string) => {
  const p = await ctx.db.crmPerson.findFirst({
    where: { id: String(personId), organizationId: ctx.organizationId },
    select: { id: true, name: true, phone: true, doNotContact: true, consent: true },
  });
  if (!p) throw new CrmError("That person isn't in the CRM any more.");
  const texts = (
    await ctx.db.crmTextMessage.findMany({
      where: { organizationId: ctx.organizationId, personId: p.id },
      orderBy: { sentAt: "desc" },
      take: 30,
      select: { id: true, direction: true, body: true, status: true, sentAt: true },
    })
  ).reverse();
  const status = await phoneStatus(ctx.organizationId);
  const consent = readConsent(p.consent).text;
  return {
    name: p.name,
    texts: texts.map((t) => ({ ...t, sentAt: t.sentAt.toISOString() })),
    consent: (consent ? (consent.granted ? "granted" : "opted-out") : "none") as "granted" | "opted-out" | "none",
    enabled: Boolean(status.active && status.number) && !p.doNotContact && Boolean(p.phone),
  };
});

export const sendTextAction = crmAction(async (ctx, _access, personId: string, body: string) => {
  const r = await queueText(ctx, { personId, body: String(body ?? "") });
  return { textId: r.textId, waiting: r.waiting, sendAt: r.sendAt.toISOString() };
});

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The organization's phone settings (owners and admins). */
export const savePhoneSettingsAction = crmAction(
  async (
    ctx,
    _access,
    patch: Partial<{
      provider: "telnyx" | "twilio" | null;
      recording: "ask" | "never";
      notice: string;
      quietStart: string;
      quietEnd: string;
      callStart: string;
      callEnd: string;
      clearVoicemail: boolean;
    }>,
  ) => {
    const s = await ctx.db.crmSettings.findUnique({ where: { organizationId: ctx.organizationId }, select: { phone: true } });
    const current = (s?.phone ?? {}) as Record<string, unknown>;
    const next: Record<string, unknown> = { ...current };
    if (patch.provider !== undefined) {
      if (patch.provider !== null && patch.provider !== "telnyx" && patch.provider !== "twilio") throw new CrmError("Pick Telnyx or Twilio.");
      next.provider = patch.provider;
    }
    if (patch.recording !== undefined) next.recording = patch.recording === "never" ? "never" : "ask";
    if (patch.notice !== undefined) {
      const n = patch.notice.trim();
      if (n.length < 10 || n.length > 300) throw new CrmError("The notice should say, in a sentence or two, that the call is recorded.");
      if (!/record/i.test(n)) throw new CrmError("The notice has to say the call is recorded.");
      next.notice = n;
    }
    for (const k of ["quietStart", "quietEnd", "callStart", "callEnd"] as const) {
      if (patch[k] !== undefined) {
        if (!HHMM.test(patch[k]!)) throw new CrmError("Use times like 21:00.");
        next[k] = patch[k];
      }
    }
    if (patch.clearVoicemail) next.voicemailKey = null;
    await ctx.db.crmSettings.update({
      where: { organizationId: ctx.organizationId },
      data: { phone: next as Prisma.InputJsonObject },
    });
    return { settings: readPhoneSettings(next) };
  },
  { admin: true },
);
