import { createHmac, timingSafeEqual } from "node:crypto";

import type { AUDIO_TYPES } from "@/server/storage/kinds";

/**
 * Audio in the CRM: call recordings, voice notes and the voicemail to drop
 * (storage kind crm-audio, private). What a file really is comes from its
 * first bytes, never from the browser's word; the voicemail's address for
 * the provider is a short-lived signed link, because the provider fetches
 * it without a session.
 */

export type AudioType = (typeof AUDIO_TYPES)[number];

export const AUDIO_EXT: Record<AudioType, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/mp4": "m4a",
};

export function sniffAudio(bytes: Uint8Array): AudioType | null {
  const b = bytes;
  const at = (i: number, ...v: number[]) => v.every((x, j) => b[i + j] === x);
  if (b.length < 12) return null;
  if (at(0, 0x1a, 0x45, 0xdf, 0xa3)) return "audio/webm";
  if (at(0, 0x4f, 0x67, 0x67, 0x53)) return "audio/ogg";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x41, 0x56, 0x45)) return "audio/wav";
  if (at(4, 0x66, 0x74, 0x79, 0x70)) return "audio/mp4";
  if (at(0, 0x49, 0x44, 0x33)) return "audio/mpeg";
  if (b[0] === 0xff && ((b[1] ?? 0) & 0xe0) === 0xe0) return "audio/mpeg";
  return null;
}

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is required to sign voicemail links");
  return createHmac("sha256", s).update("crm-voicemail-link").digest("hex");
}

function mac(organizationId: string, key: string, expires: number): string {
  return createHmac("sha256", secret()).update(`${organizationId}|${key}|${expires}`).digest("base64url");
}

/** `{expires}.{mac}` for the voicemail drop link (ten minutes, one org, one file). */
export function signAudioLink(organizationId: string, key: string, ttlMs = 10 * 60_000, now = Date.now()): string {
  const expires = now + ttlMs;
  return `${expires}.${mac(organizationId, key, expires)}`;
}

export function verifyAudioLink(organizationId: string, key: string, token: string, now = Date.now()): boolean {
  const [exp, given] = token.split(".");
  const expires = Number(exp);
  if (!given || !Number.isFinite(expires) || expires < now) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(mac(organizationId, key, expires));
  return a.length === b.length && timingSafeEqual(a, b);
}
