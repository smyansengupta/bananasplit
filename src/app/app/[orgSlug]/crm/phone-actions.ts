"use server";

import type { Prisma } from "@/generated/prisma/client";
import { readPhoneSettings } from "@/lib/crm/phone";
import { CrmError } from "@/server/crm/access";
import { logCall, startCall, type LogCallInput, type StartedCall } from "@/server/crm/phone/calls";
import { dropVoicemail, softphoneToken, startRecording, type SoftphoneToken } from "@/server/crm/phone/live";
import { addTextSender, queueText } from "@/server/crm/phone/texts";
import { assertCanSpend, costOf, textSegments } from "@/server/crm/spend";

import { crmAction, crmGate, toResult, type CrmResult } from "./run";

/**
 * Calls, texts and the phone settings (docs/features/crm.md, Phase 5).
 * Everything that only touches the database runs in one member transaction
 * (crmAction). What talks to Telnyx or Twilio first commits the member's
 * check (crmGate), then calls the provider with no transaction open.
 */

export const logCallAction = crmAction(async (ctx, _access, input: LogCallInput) => logCall(ctx, input));

const startCallTx = crmAction(
  async (ctx, _access, input: { personId: string; record?: boolean }): Promise<{ call: StartedCall }> => ({
    call: await startCall(ctx, input),
  }),
);

/** A call on the organization's own provider: refused past the monthly spending cap. */
export async function startCallAction(orgId: string, input: { personId: string; record?: boolean }): Promise<CrmResult<{ call: StartedCall }>> {
  try {
    await crmGate(orgId);
    await assertCanSpend(orgId, costOf("call.minute"));
  } catch (error) {
    return toResult(error);
  }
  return startCallTx(orgId, input);
}

export async function softphoneTokenAction(orgId: string): Promise<CrmResult<{ phone: SoftphoneToken }>> {
  try {
    const me = await crmGate(orgId);
    await assertCanSpend(orgId, costOf("call.minute"));
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

/** Adds whoever texted from a number not in the CRM, their texts moving onto their timeline. */
export const addTextSenderAction = crmAction(async (ctx, _access, textId: string, name: string | null) =>
  addTextSender(ctx, String(textId), typeof name === "string" ? name : null),
);

const sendTextTx = crmAction(async (ctx, _access, personId: string, body: string) => {
  const r = await queueText(ctx, { personId, body: String(body ?? "") });
  return { textId: r.textId, waiting: r.waiting, sendAt: r.sendAt.toISOString() };
});

/** A text on the organization's own number: refused past the monthly spending cap. */
export async function sendTextAction(
  orgId: string,
  personId: string,
  body: string,
): Promise<CrmResult<{ textId: string; waiting: boolean; sendAt: string }>> {
  try {
    await crmGate(orgId);
    await assertCanSpend(orgId, costOf("text.segment", textSegments(String(body ?? ""))));
  } catch (error) {
    return toResult(error);
  }
  return sendTextTx(orgId, personId, body);
}

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
