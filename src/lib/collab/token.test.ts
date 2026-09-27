// @vitest-environment node
import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { COLLAB_TOKEN_TTL_SECONDS, signCollabToken, verifyCollabToken } from "./token";

const SECRET = "s".repeat(40);
const NOW = Date.UTC(2026, 8, 26, 12, 0, 0);
const input = {
  sub: "user_1",
  org: "org_1",
  doc: "note:org_1:note_1",
  perm: "write" as const,
  name: "Kristine",
  slot: 3,
};

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

/** A token signed correctly but with arbitrary header and claims. */
function forge(header: unknown, claims: unknown, secret = SECRET) {
  const body = `${b64(header)}.${b64(claims)}`;
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}

describe("collaboration tokens", () => {
  it("round-trips the claims and expires after the TTL", () => {
    const { token, expiresAt } = signCollabToken(input, SECRET, NOW);
    expect(expiresAt).toBe(NOW + COLLAB_TOKEN_TTL_SECONDS * 1000);
    expect(verifyCollabToken(token, SECRET, NOW)).toMatchObject({
      ...input,
      iss: "cbc-portal",
      aud: "cbc-collab",
      iat: NOW / 1000,
      exp: NOW / 1000 + COLLAB_TOKEN_TTL_SECONDS,
    });
  });

  it("is a standard HS256 JWT", () => {
    const { token } = signCollabToken(input, SECRET, NOW);
    const [header] = token.split(".");
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({
      alg: "HS256",
      typ: "JWT",
    });
  });

  it("refuses another secret, a changed claim or a changed signature", () => {
    const { token } = signCollabToken(input, SECRET, NOW);
    expect(verifyCollabToken(token, "t".repeat(40), NOW)).toBeNull();

    const [header, payload, signature] = token.split(".");
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    const impersonated = `${header}.${b64({ ...claims, sub: "someone_else" })}.${signature}`;
    expect(verifyCollabToken(impersonated, SECRET, NOW)).toBeNull();

    // Buffer's base64url decoder ignores stray characters; the check must not.
    expect(verifyCollabToken(`${token}A`, SECRET, NOW)).toBeNull();
    expect(verifyCollabToken(`${token}.`, SECRET, NOW)).toBeNull();
    expect(verifyCollabToken("", SECRET, NOW)).toBeNull();
    expect(verifyCollabToken("a.b", SECRET, NOW)).toBeNull();
  });

  it("refuses expired and future tokens, allowing 30s of clock skew", () => {
    const { token } = signCollabToken(input, SECRET, NOW);
    const ttl = COLLAB_TOKEN_TTL_SECONDS * 1000;
    expect(verifyCollabToken(token, SECRET, NOW + ttl + 29_000)).not.toBeNull();
    expect(verifyCollabToken(token, SECRET, NOW + ttl + 31_000)).toBeNull();
    expect(verifyCollabToken(token, SECRET, NOW - 29_000)).not.toBeNull();
    expect(verifyCollabToken(token, SECRET, NOW - 31_000)).toBeNull();
  });

  it("accepts only its own header, audience and a bounded lifetime", () => {
    const iat = NOW / 1000;
    const claims = { iss: "cbc-portal", aud: "cbc-collab", ...input, iat, exp: iat + 60 };
    // A valid signature is not enough: alg negotiation is refused outright.
    expect(verifyCollabToken(forge({ alg: "none", typ: "JWT" }, claims), SECRET, NOW)).toBeNull();
    expect(verifyCollabToken(forge({ typ: "JWT", alg: "HS256" }, claims), SECRET, NOW)).toBeNull();
    expect(
      verifyCollabToken(
        forge({ alg: "HS256", typ: "JWT" }, { ...claims, aud: "other" }),
        SECRET,
        NOW,
      ),
    ).toBeNull();
    expect(
      verifyCollabToken(
        forge({ alg: "HS256", typ: "JWT" }, { ...claims, exp: iat + 24 * 3600 }),
        SECRET,
        NOW,
      ),
    ).toBeNull();
    expect(
      verifyCollabToken(
        forge({ alg: "HS256", typ: "JWT" }, { ...claims, perm: "admin" }),
        SECRET,
        NOW,
      ),
    ).toBeNull();
    expect(
      verifyCollabToken(forge({ alg: "HS256", typ: "JWT" }, claims), SECRET, NOW),
    ).not.toBeNull();
  });
});
