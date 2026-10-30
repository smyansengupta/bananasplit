import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { Resend } from "resend";

import { assertNoTx } from "@/server/db/context";

import { emailDelivery, type EmailDelivery } from "./config";

/**
 * Email transports. The EmailTransport interface is where SMTP (nodemailer)
 * would plug in later ('Email sender' decision).
 *
 * - resend: sends through the Resend API and checks its { error } result
 *   (the old email.ts ignored it, so failures were silent).
 * - sink:   never sends. Logs one line to the console and, off Vercel, writes
 *           the message to .data/mail/ (an .html file to open in a browser
 *           and a .json with the headers and text part).
 * - off:    sends nothing and says so (EMAIL_DELIVERY=off).
 *
 * Every send asserts that no database transaction is open: mail is network
 * I/O and must never run for a write that could still roll back.
 */

export interface OutgoingEmail {
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
}

export interface SendOptions {
  signal?: AbortSignal;
  /** Resend de-duplicates sends with the same key for 24 hours. */
  idempotencyKey?: string;
}

export interface SendResult {
  id: string | null;
  transport: EmailDelivery;
}

export interface EmailTransport {
  readonly name: EmailDelivery;
  send(message: OutgoingEmail, options?: SendOptions): Promise<SendResult>;
}

/** Missing or invalid email configuration (a retry will not help until it is fixed). */
export class EmailConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailConfigError";
  }
}

/** The provider refused or failed the send. */
export class EmailSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailSendError";
  }
}

export function resendTransport(apiKey: string): EmailTransport {
  if (!apiKey) throw new EmailConfigError("no Resend API key");
  const client = new Resend(apiKey);
  return {
    name: "live",
    async send(message, options = {}) {
      assertNoTx("email send");
      if (options.signal?.aborted) throw new EmailSendError("send aborted");
      const { data, error } = await client.emails.send(
        {
          from: message.from,
          to: message.to,
          replyTo: message.replyTo,
          subject: message.subject,
          html: message.html,
          text: message.text,
        },
        options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : undefined,
      );
      if (error) {
        throw new EmailSendError(
          `Resend refused the message: ${error.name ?? "error"}: ${error.message}`,
        );
      }
      return { id: data?.id ?? null, transport: "live" };
    },
  };
}

const MAIL_DIR = path.join(process.cwd(), ".data", "mail");

export function sinkTransport(dir: string = MAIL_DIR): EmailTransport {
  return {
    name: "sink",
    async send(message) {
      assertNoTx("email send");
      const id = `sink-${randomBytes(6).toString("hex")}`;
      // Vercel's filesystem is read-only: previews log only.
      if (process.env.VERCEL) {
        console.info(`[email:sink] "${message.subject}" (${id}) not sent: mail sink`);
        return { id, transport: "sink" };
      }
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const base = path.join(dir, `${stamp}-${id}`);
      await mkdir(dir, { recursive: true });
      await writeFile(`${base}.html`, message.html, "utf8");
      await writeFile(
        `${base}.json`,
        JSON.stringify(
          {
            id,
            sentAt: new Date().toISOString(),
            from: message.from,
            to: message.to,
            replyTo: message.replyTo ?? null,
            subject: message.subject,
            text: message.text,
          },
          null,
          2,
        ),
        "utf8",
      );
      console.info(
        `[email:sink] "${message.subject}" to ${message.to} -> ${path.relative(process.cwd(), base)}.html`,
      );
      return { id, transport: "sink" };
    },
  };
}

export function offTransport(): EmailTransport {
  return {
    name: "off",
    async send(message) {
      console.warn(`[email] EMAIL_DELIVERY=off: not sending "${message.subject}"`);
      return { id: null, transport: "off" };
    },
  };
}

/**
 * The transport for a sender whose live key is `apiKey` (the platform key
 * or an org's own Resend key), honouring EMAIL_DELIVERY and preview rules.
 */
export function transportFor(
  apiKey: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): EmailTransport {
  const delivery = emailDelivery(env);
  if (delivery === "off") return offTransport();
  if (delivery === "sink") return sinkTransport();
  if (!apiKey) {
    throw new EmailConfigError("RESEND_API_KEY is not set (or set EMAIL_DELIVERY=sink/off)");
  }
  return resendTransport(apiKey);
}
