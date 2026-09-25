// @vitest-environment node
import { randomBytes } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  decryptSecret,
  encryptSecret,
  rewrapSecret,
  SecretDecryptError,
  type SecretLocator,
} from "./envelope";
import { secretFingerprint, secretLast4 } from "./fingerprint";
import { kekFingerprint, keyring, loadKeyring, SecretsConfigError } from "./keyring";

const k1 = randomBytes(32).toString("base64");
const k2 = randomBytes(32).toString("base64");
const ring1 = loadKeyring({ SECRETS_KEK_V1: k1, SECRETS_KEK_CURRENT: "1" });
const ring12 = loadKeyring({ SECRETS_KEK_V1: k1, SECRETS_KEK_V2: k2, SECRETS_KEK_CURRENT: "2" });
const loc: SecretLocator = {
  orgId: "org_A",
  integrationId: "int_1",
  provider: "CLAUDE",
  kind: "API_KEY",
};
const SECRET = "sk-ant-api03-example-secret-value";

describe("envelope encryption", () => {
  it("round-trips, with a fresh IV and data key every time", () => {
    const a = encryptSecret(SECRET, loc, ring1);
    const b = encryptSecret(SECRET, loc, ring1);
    expect(decryptSecret(a, loc, ring1)).toBe(SECRET);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
    expect(a.wrappedDek.equals(b.wrappedDek)).toBe(false);
    expect(a.kekVersion).toBe(1);
    expect(a.ciphertext.toString("utf8")).not.toContain("sk-ant");
  });

  it("detects tampering with the ciphertext, the tag or the wrapped key", () => {
    const rec = encryptSecret(SECRET, loc, ring1);
    const flip = (b: Buffer) => {
      const c = Buffer.from(b);
      c[0] = c[0]! ^ 0xff;
      return c;
    };
    expect(() => decryptSecret({ ...rec, ciphertext: flip(rec.ciphertext) }, loc, ring1)).toThrow(
      SecretDecryptError,
    );
    expect(() => decryptSecret({ ...rec, authTag: flip(rec.authTag) }, loc, ring1)).toThrow(
      SecretDecryptError,
    );
    expect(() => decryptSecret({ ...rec, wrappedDek: flip(rec.wrappedDek) }, loc, ring1)).toThrow(
      SecretDecryptError,
    );
  });

  it("binds the ciphertext to its org, integration, provider and kind (AAD)", () => {
    const rec = encryptSecret(SECRET, loc, ring1);
    for (const other of [
      { ...loc, orgId: "org_B" },
      { ...loc, integrationId: "int_2" },
      { ...loc, provider: "EMAIL_RESEND" },
      { ...loc, kind: "REFRESH_TOKEN" },
    ]) {
      expect(() => decryptSecret(rec, other, ring1)).toThrow(SecretDecryptError);
    }
  });

  it("cannot relabel a wrapped key to another KEK version", () => {
    const rec = encryptSecret(SECRET, loc, ring12);
    expect(() => decryptSecret({ ...rec, kekVersion: 1 }, loc, ring12)).toThrow(SecretDecryptError);
  });

  it("refuses an unknown kekVersion", () => {
    const rec = encryptSecret(SECRET, loc, ring12);
    expect(() => decryptSecret(rec, loc, ring1)).toThrow(SecretsConfigError);
  });

  it("rotation rewraps only the data key", () => {
    const old = encryptSecret(SECRET, loc, ring1);
    const rotated = rewrapSecret(old, loc, ring12);
    expect(rotated.kekVersion).toBe(2);
    expect(rotated.ciphertext.equals(old.ciphertext)).toBe(true);
    expect(rotated.wrappedDek.equals(old.wrappedDek)).toBe(false);
    expect(decryptSecret(rotated, loc, ring12)).toBe(SECRET);
    // The old KEK alone can no longer open it.
    expect(() => decryptSecret(rotated, loc, ring1)).toThrow(SecretsConfigError);
  });
});

describe("keyring", () => {
  it("requires 32-byte keys and a configured current version", () => {
    expect(() => loadKeyring({})).toThrow(SecretsConfigError);
    // The base64 text itself is validated in keyring.test.ts.
    expect(() => loadKeyring({ SECRETS_KEK_V1: Buffer.alloc(16).toString("base64") })).toThrow(
      /32 random bytes/,
    );
    expect(() => loadKeyring({ SECRETS_KEK_V1: k1, SECRETS_KEK_CURRENT: "2" })).toThrow(
      SecretsConfigError,
    );
    expect(loadKeyring({ SECRETS_KEK_V1: k1, SECRETS_KEK_V3: k2 }).current).toBe(3);
  });

  it("the process keyring reloads when the KEK variables change (rotation)", () => {
    vi.stubEnv("SECRETS_KEK_V1", k1);
    vi.stubEnv("SECRETS_KEK_CURRENT", "1");
    expect(keyring().current).toBe(1);
    vi.stubEnv("SECRETS_KEK_V2", k2);
    vi.stubEnv("SECRETS_KEK_CURRENT", "2");
    expect(keyring().current).toBe(2);
    expect(keyring().keys.size).toBe(2);
    vi.unstubAllEnvs();
  });

  it("fingerprints the current KEK without revealing it", () => {
    const fp = kekFingerprint(ring1);
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
    expect(kekFingerprint(ring1)).toBe(fp);
    expect(kekFingerprint(ring12)).not.toBe(fp);
  });
});

describe("display metadata", () => {
  it("fingerprints with the platform HMAC key and shows last4 only for long secrets", () => {
    const env = { SECRETS_FINGERPRINT_KEY: "fp-key" };
    expect(secretFingerprint(SECRET, env)).toMatch(/^[0-9a-f]{32}$/);
    expect(secretFingerprint(SECRET, env)).not.toBe(
      secretFingerprint(SECRET, { SECRETS_FINGERPRINT_KEY: "other" }),
    );
    expect(() => secretFingerprint(SECRET, {})).toThrow(SecretsConfigError);
    expect(secretLast4(SECRET)).toBe("alue");
    expect(secretLast4("short-pw")).toBeNull();
  });
});
