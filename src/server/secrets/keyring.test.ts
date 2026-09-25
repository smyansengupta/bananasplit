// @vitest-environment node
import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { kekFingerprint, loadKeyring, SecretsConfigError } from "./keyring";

/**
 * The KEK is the root of secrets at rest, and it comes from an environment
 * variable someone pastes by hand. Validating only the decoded length let
 * Buffer.from's lenient base64 through: it skips characters outside the
 * alphabet and tolerates a missing pad, so 43 'a' characters "decoded" to
 * 32 bytes and were accepted as a 256-bit key.
 */

const KEY_1 = randomBytes(32).toString("base64");
const KEY_2 = randomBytes(32).toString("base64");

function rejected(env: Record<string, string | undefined>): string {
  try {
    loadKeyring(env);
  } catch (error) {
    if (error instanceof SecretsConfigError) return error.message;
    throw error;
  }
  throw new Error("expected a SecretsConfigError");
}

describe("loadKeyring KEK validation", () => {
  it("accepts canonical base64 of 32 random bytes, with surrounding whitespace", () => {
    const ring = loadKeyring({ SECRETS_KEK_V1: `  ${KEY_1}\n`, SECRETS_KEK_CURRENT: "1" });
    expect(ring.current).toBe(1);
    expect(ring.keys.get(1)?.toString("base64")).toBe(KEY_1);
  });

  it("refuses a passphrase that happens to decode to 32 bytes", () => {
    // The reported bypass: 43 characters, with and without the padding.
    expect(rejected({ SECRETS_KEK_V1: "a".repeat(43), SECRETS_KEK_CURRENT: "1" })).toMatch(
      /32 random bytes/,
    );
    expect(rejected({ SECRETS_KEK_V1: `${"a".repeat(43)}=`, SECRETS_KEK_CURRENT: "1" })).toMatch(
      /32 random bytes/,
    );
    // Both are what the old length-only check accepted.
    expect(Buffer.from("a".repeat(43), "base64")).toHaveLength(32);
  });

  it("refuses characters outside the base64 alphabet, which decode silently", () => {
    const withSpaces = `${KEY_1.slice(0, 20)} ${KEY_1.slice(20)}`;
    const base64url = `${"-".repeat(2)}${KEY_1.slice(2, 43)}=`;
    const hex = randomBytes(32).toString("hex"); // 64 characters, decodes to 48 bytes
    for (const value of [withSpaces, base64url, hex, "not a key at all!!!"]) {
      expect(rejected({ SECRETS_KEK_V1: value, SECRETS_KEK_CURRENT: "1" })).toMatch(
        /must be base64 of exactly 32 random bytes/,
      );
    }
  });

  it("refuses a non-canonical final character, whose low bits are dropped", () => {
    // 'a' is not a valid last character for 32 bytes: decoding discards two
    // of its bits, so it does not re-encode to itself.
    const sloppy = `${KEY_1.slice(0, 42)}a=`;
    expect(Buffer.from(sloppy, "base64")).toHaveLength(32);
    expect(rejected({ SECRETS_KEK_V1: sloppy, SECRETS_KEK_CURRENT: "1" })).toMatch(/32 random bytes/);
  });

  it("refuses the wrong key size and names the variable", () => {
    expect(rejected({ SECRETS_KEK_V2: randomBytes(16).toString("base64"), SECRETS_KEK_CURRENT: "2" })).toMatch(
      /^SECRETS_KEK_V2 must be/,
    );
  });

  it("still reports a missing keyring and a SECRETS_KEK_CURRENT that names no key", () => {
    expect(rejected({})).toMatch(/no KEK configured/);
    expect(rejected({ SECRETS_KEK_V1: KEY_1, SECRETS_KEK_CURRENT: "3" })).toMatch(/names no configured KEK/);
  });

  it("loads several versions and fingerprints only the current one", () => {
    const ring = loadKeyring({ SECRETS_KEK_V1: KEY_1, SECRETS_KEK_V2: KEY_2, SECRETS_KEK_CURRENT: "2" });
    expect([...ring.keys.keys()].toSorted()).toEqual([1, 2]);
    expect(ring.current).toBe(2);
    expect(kekFingerprint(ring)).toHaveLength(16);
    expect(kekFingerprint(ring)).not.toBe(
      kekFingerprint(loadKeyring({ SECRETS_KEK_V1: KEY_1, SECRETS_KEK_CURRENT: "1" })),
    );
  });
});
