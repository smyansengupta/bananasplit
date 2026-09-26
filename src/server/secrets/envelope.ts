// The KEK, the plaintext of every org secret and the fingerprint key live
// here. `server-only` makes a client import a build error, not a review item.
import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { kekFor, type Keyring } from "./keyring";

/**
 * AES-256-GCM envelope encryption ('Secrets at rest' decision). Pure: no
 * database, no environment (the keyring is passed in).
 *
 * - Each secret gets a fresh random 256-bit data key (DEK). The plaintext
 *   is encrypted with the DEK; the DEK is wrapped (encrypted) with the
 *   current KEK. Both use a random 96-bit IV and a 128-bit tag.
 * - Additional authenticated data binds the ciphertext to its place:
 *     cbc-secret:v1|{orgId}|{integrationId}|{provider}|{kind}
 *   so a row copied to another org, integration or kind fails to decrypt.
 *   (The plan's AAD names the secret row id; the row id does not exist
 *   before the first write, and (org, integration, kind) is the row's
 *   unique key, so binding those is equivalent.)
 * - The wrapped DEK is bound to the same AAD plus the KEK version, so a
 *   wrapped key cannot be moved between rows or relabelled to another KEK.
 * - KEK rotation rewraps the DEK only (rewrapSecret); the ciphertext stays.
 */

export interface SecretLocator {
  orgId: string;
  integrationId: string;
  provider: string;
  kind: string;
}

export interface EncryptedSecret {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  wrappedDek: Buffer;
  dekIv: Buffer;
  dekTag: Buffer;
  kekVersion: number;
}

export class SecretDecryptError extends Error {
  constructor() {
    super("secret could not be decrypted (tampered, moved, or wrong key)");
    this.name = "SecretDecryptError";
  }
}

const ALGORITHM = "aes-256-gcm";

export function secretAad(loc: SecretLocator): Buffer {
  for (const [name, value] of Object.entries(loc)) {
    if (!value || value.includes("|")) throw new TypeError(`secret ${name} is empty or contains "|"`);
  }
  return Buffer.from(
    `cbc-secret:v1|${loc.orgId}|${loc.integrationId}|${loc.provider}|${loc.kind}`,
    "utf8",
  );
}

function dekAad(aad: Buffer, kekVersion: number): Buffer {
  return Buffer.concat([Buffer.from(`cbc-dek:v1|kek${kekVersion}|`, "utf8"), aad]);
}

function seal(key: Buffer, plaintext: Buffer, aad: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ciphertext, iv, tag: cipher.getAuthTag() };
}

function open(key: Buffer, ciphertext: Buffer, iv: Buffer, tag: Buffer, aad: Buffer): Buffer {
  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new SecretDecryptError();
  }
}

function wrapDek(ring: Keyring, version: number, dek: Buffer, aad: Buffer) {
  const sealed = seal(kekFor(ring, version), dek, dekAad(aad, version));
  return { wrappedDek: sealed.ciphertext, dekIv: sealed.iv, dekTag: sealed.tag };
}

function unwrapDek(ring: Keyring, record: EncryptedSecret, aad: Buffer): Buffer {
  return open(
    kekFor(ring, record.kekVersion),
    record.wrappedDek,
    record.dekIv,
    record.dekTag,
    dekAad(aad, record.kekVersion),
  );
}

export function encryptSecret(plaintext: string, loc: SecretLocator, ring: Keyring): EncryptedSecret {
  const aad = secretAad(loc);
  const dek = randomBytes(32);
  try {
    const sealed = seal(dek, Buffer.from(plaintext, "utf8"), aad);
    return {
      ciphertext: sealed.ciphertext,
      iv: sealed.iv,
      authTag: sealed.tag,
      ...wrapDek(ring, ring.current, dek, aad),
      kekVersion: ring.current,
    };
  } finally {
    dek.fill(0);
  }
}

export function decryptSecret(record: EncryptedSecret, loc: SecretLocator, ring: Keyring): string {
  const aad = secretAad(loc);
  const dek = unwrapDek(ring, record, aad);
  try {
    return open(dek, record.ciphertext, record.iv, record.authTag, aad).toString("utf8");
  } finally {
    dek.fill(0);
  }
}

/** Rewraps the data key under `toVersion` (default: the current KEK). */
export function rewrapSecret(
  record: EncryptedSecret,
  loc: SecretLocator,
  ring: Keyring,
  toVersion: number = ring.current,
): EncryptedSecret {
  const aad = secretAad(loc);
  const dek = unwrapDek(ring, record, aad);
  try {
    return { ...record, ...wrapDek(ring, toVersion, dek, aad), kekVersion: toVersion };
  } finally {
    dek.fill(0);
  }
}
