import { createHash } from "node:crypto";

/**
 * The key-encryption-key (KEK) keyring, from the environment:
 *
 *   SECRETS_KEK_V1, SECRETS_KEK_V2, ...  base64 of 32 random bytes each
 *   SECRETS_KEK_CURRENT                   the version new secrets are wrapped with
 *
 * Rotation: add SECRETS_KEK_V{n+1}, set SECRETS_KEK_CURRENT to n+1, deploy,
 * run `pnpm secrets:rotate-kek` (rewraps every data key; the ciphertext is
 * untouched), then remove the old version once nothing uses it.
 *
 * Previews have their own keyring (D9) and set SECRETS_KEK_ENV=preview;
 * /api/health compares kekFingerprint() with PREVIEW_KEK_FINGERPRINT so a
 * preview can never run with production's KEK.
 */

export interface Keyring {
  current: number;
  keys: ReadonlyMap<number, Buffer>;
}

export class SecretsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretsConfigError";
  }
}

type Env = Record<string, string | undefined>;

const KEK_ENV = /^SECRETS_KEK_V(\d+)$/;

function decodeKey(name: string, value: string): Buffer {
  const key = Buffer.from(value.trim(), "base64");
  if (key.length !== 32) {
    throw new SecretsConfigError(`${name} must be base64 of exactly 32 bytes`);
  }
  return key;
}

/** Loads the keyring. Throws SecretsConfigError when it is missing or malformed. */
export function loadKeyring(env: Env = process.env): Keyring {
  const keys = new Map<number, Buffer>();
  for (const [name, value] of Object.entries(env)) {
    const m = KEK_ENV.exec(name);
    if (!m || !value) continue;
    keys.set(Number(m[1]), decodeKey(name, value));
  }
  if (keys.size === 0) {
    throw new SecretsConfigError("no KEK configured: set SECRETS_KEK_V1 and SECRETS_KEK_CURRENT");
  }
  const current = env.SECRETS_KEK_CURRENT ? Number(env.SECRETS_KEK_CURRENT) : Math.max(...keys.keys());
  if (!Number.isInteger(current) || !keys.has(current)) {
    throw new SecretsConfigError(`SECRETS_KEK_CURRENT=${env.SECRETS_KEK_CURRENT} names no configured KEK`);
  }
  return { current, keys };
}

let cached: { signature: string; ring: Keyring } | null = null;

function keyringSignature(env: Env): string {
  return Object.keys(env)
    .filter((k) => KEK_ENV.test(k) || k === "SECRETS_KEK_CURRENT")
    .sort()
    .map((k) => `${k}=${env[k] ?? ""}`)
    .join("\n");
}

/** The process keyring from process.env (reloaded if the KEK variables change). */
export function keyring(): Keyring {
  const signature = keyringSignature(process.env);
  if (!cached || cached.signature !== signature) {
    cached = { signature, ring: loadKeyring(process.env) };
  }
  return cached.ring;
}

/** The KEK for `version`, or a SecretsConfigError. */
export function kekFor(ring: Keyring, version: number): Buffer {
  const key = ring.keys.get(version);
  if (!key) throw new SecretsConfigError(`KEK version ${version} is not configured`);
  return key;
}

/**
 * A short, non-reversible fingerprint of the CURRENT KEK (for the preview
 * isolation check). Never the key itself.
 */
export function kekFingerprint(ring: Keyring = keyring()): string {
  return createHash("sha256")
    .update(`cbc-kek-fingerprint:v${ring.current}:`)
    .update(kekFor(ring, ring.current))
    .digest("hex")
    .slice(0, 16);
}
