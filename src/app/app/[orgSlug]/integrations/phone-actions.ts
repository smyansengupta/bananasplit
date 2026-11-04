"use server";

import { z } from "zod";

import { ForbiddenError, NotFoundError } from "@/lib/auth/errors";
import {
  saveDeepgram,
  saveTelnyx,
  saveTwilio,
  setPhoneNumber,
  type ConnectResult,
} from "@/server/crm/phone/connect";
import { resolveActor, type OrgActor } from "@/server/integrations/service";

/**
 * The Telnyx, Twilio and Deepgram cards' actions (src/server/crm/phone/
 * connect.ts). Like the other integration actions: not withOrgAction,
 * because saving a secret and testing it run on the service path with no
 * transaction open; the caller's role is resolved by the database first.
 * Test and Remove use the shared testIntegrationAction and
 * removeIntegrationAction.
 */

const id = z.string().min(1).max(100);
const secret = z.string().max(600).optional();

async function run(orgId: string, fn: (actor: OrgActor) => Promise<ConnectResult>): Promise<ConnectResult> {
  try {
    const actor = await resolveActor(id.parse(orgId));
    return await fn(actor);
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, error: error.message };
    if (error instanceof NotFoundError) return { ok: false, error: "Not found." };
    if (error instanceof z.ZodError) return { ok: false, error: "Check what you typed." };
    throw error;
  }
}

const telnyxInput = z.object({ apiKey: secret, publicKey: z.string().max(200).optional(), connectionId: z.string().max(40).optional() });
const twilioInput = z.object({ accountSid: z.string().max(60), authToken: secret });

export async function saveTelnyxAction(orgId: string, input: z.input<typeof telnyxInput>) {
  return run(orgId, (actor) => saveTelnyx(orgId, actor, telnyxInput.parse(input)));
}

export async function saveTwilioAction(orgId: string, input: z.input<typeof twilioInput>) {
  return run(orgId, (actor) => saveTwilio(orgId, actor, twilioInput.parse(input)));
}

export async function saveDeepgramAction(orgId: string, apiKey: string) {
  return run(orgId, (actor) => saveDeepgram(orgId, actor, { apiKey: z.string().max(200).parse(apiKey) }));
}

export async function setPhoneNumberAction(orgId: string, provider: "TELNYX" | "TWILIO", number: string) {
  return run(orgId, (actor) =>
    setPhoneNumber(orgId, actor, z.enum(["TELNYX", "TWILIO"]).parse(provider), z.string().max(40).parse(number)),
  );
}
