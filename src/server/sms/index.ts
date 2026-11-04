import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { assertNoTx } from "@/server/db/context";

/**
 * Text messages (RSVP reminders, docs/features/rsvp.md), sent through
 * Twilio's REST API. Off until the platform's Twilio account is set up:
 *
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN   the account (Console > Account info)
 *   TWILIO_FROM                             the sending number (+1...) or a
 *                                           Messaging Service SID (MG...)
 *   SMS_DELIVERY=live|sink|off              unset: live when the three are
 *                                           set; otherwise the sink locally
 *                                           (.data/sms/) and off elsewhere
 *
 * Previews never text anyone (the sink, which only logs on Vercel). Twilio
 * handles STOP/START replies itself, so an opted-out number is refused
 * there and the send fails without a retry storm (4xx is permanent).
 */

export type SmsDelivery = "live" | "sink" | "off";

type Env = Record<string, string | undefined>;

export function twilioConfigured(env: Env = process.env): boolean {
  return Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM);
}

export function smsDelivery(env: Env = process.env): SmsDelivery {
  const raw = (env.SMS_DELIVERY ?? "").trim().toLowerCase();
  if (raw === "off") return "off";
  if (env.VERCEL_ENV === "preview") return "sink";
  if (raw === "sink") return "sink";
  if (raw === "live") return twilioConfigured(env) ? "live" : "off";
  if (twilioConfigured(env)) return "live";
  return env.VERCEL ? "off" : "sink";
}

export class SmsSendError extends Error {
  /** A 4xx from Twilio (bad or opted-out number): retrying won't help. */
  readonly permanent: boolean;
  constructor(message: string, permanent: boolean) {
    super(message);
    this.name = "SmsSendError";
    this.permanent = permanent;
  }
}

export interface SmsResult {
  id: string | null;
  delivery: SmsDelivery;
}

const SMS_DIR = path.join(process.cwd(), ".data", "sms");

/**
 * Where an organization's own texts go (the CRM, on its Telnyx or Twilio
 * key): live in production; the sink locally and on previews unless
 * SMS_DELIVERY=live; nowhere with SMS_DELIVERY=off.
 */
export function orgSmsDelivery(env: Env = process.env): SmsDelivery {
  const raw = (env.SMS_DELIVERY ?? "").trim().toLowerCase();
  if (raw === "off") return "off";
  if (env.VERCEL_ENV === "preview") return "sink";
  if (raw === "sink") return "sink";
  if (raw === "live") return "live";
  return env.VERCEL ? "live" : "sink";
}

/**
 * Sends one text on an organization's own provider (the CRM's two-way
 * texting, src/server/crm/phone/texts.ts). The caller passes the provider
 * call; this decides whether it runs (live), is written to the sink, or is
 * held (off), exactly as for the platform's own texts. Outside any
 * transaction.
 */
export async function sendOrgSms(
  to: string,
  body: string,
  send: () => Promise<string | null>,
  options: { env?: Env } = {},
): Promise<SmsResult> {
  assertNoTx("sms send");
  const env = options.env ?? process.env;
  const delivery = orgSmsDelivery(env);
  if (delivery === "off") return { id: null, delivery };
  if (delivery === "sink") {
    const id = `sms-${randomBytes(6).toString("hex")}`;
    if (!env.VERCEL) {
      await mkdir(SMS_DIR, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      await writeFile(
        path.join(SMS_DIR, `${stamp}-${id}.json`),
        JSON.stringify({ id, sentAt: new Date().toISOString(), to, body }, null, 2),
        "utf8",
      );
    }
    console.info(`[sms:sink] organization text (${id}) not sent: SMS sink`);
    return { id, delivery };
  }
  return { id: await send(), delivery };
}

/** Sends one text. Outside any transaction. */
export async function sendSms(
  to: string,
  body: string,
  options: { signal?: AbortSignal; env?: Env } = {},
): Promise<SmsResult> {
  assertNoTx("sms send");
  const env = options.env ?? process.env;
  const delivery = smsDelivery(env);
  if (delivery === "off") return { id: null, delivery };

  if (delivery === "sink") {
    const id = `sms-${randomBytes(6).toString("hex")}`;
    if (env.VERCEL) {
      console.info(`[sms:sink] text (${id}) not sent: SMS sink`);
      return { id, delivery };
    }
    await mkdir(SMS_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await writeFile(
      path.join(SMS_DIR, `${stamp}-${id}.json`),
      JSON.stringify({ id, sentAt: new Date().toISOString(), to, body }, null, 2),
      "utf8",
    );
    console.info(`[sms:sink] text to ${to} -> .data/sms/${stamp}-${id}.json`);
    return { id, delivery };
  }

  const sid = env.TWILIO_ACCOUNT_SID!;
  const from = env.TWILIO_FROM!;
  const form = new URLSearchParams({ To: to, Body: body });
  form.set(from.startsWith("MG") ? "MessagingServiceSid" : "From", from);
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${env.TWILIO_AUTH_TOKEN}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
      signal: options.signal,
    },
  );
  if (!response.ok) {
    // Twilio's error body names the code, never the auth token; keep it short.
    const detail = (await response.text().catch(() => "")).slice(0, 200);
    throw new SmsSendError(
      `Twilio refused the text (${response.status}): ${detail}`,
      response.status >= 400 && response.status < 500 && response.status !== 429,
    );
  }
  const json = (await response.json().catch(() => ({}))) as { sid?: string };
  return { id: json.sid ?? null, delivery };
}
