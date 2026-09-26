// @vitest-environment node
import { describe, expect, it } from "vitest";

import { signBridgeRequest, verifyBridgeRequest } from "./bridge";
import { signCollabToken } from "./token";

const SECRET = "s".repeat(40);
const NOW = 1_790_000_000_000;
const body = JSON.stringify({ documentName: "note:org_1:note_1", userId: "user_1" });
const headersOf = (h: Record<string, string>) => (name: string) => h[name] ?? null;

describe("bridge request signatures", () => {
  it("verifies the operation and body it was made for", () => {
    const headers = signBridgeRequest("store", body, SECRET, NOW);
    expect(verifyBridgeRequest("store", body, headersOf(headers), SECRET, NOW)).toBe(true);
  });

  it("refuses another operation, another body, another secret or a missing header", () => {
    const headers = signBridgeRequest("load", body, SECRET, NOW);
    expect(verifyBridgeRequest("store", body, headersOf(headers), SECRET, NOW)).toBe(false);
    expect(
      verifyBridgeRequest(
        "load",
        body.replace("user_1", "user_2"),
        headersOf(headers),
        SECRET,
        NOW,
      ),
    ).toBe(false);
    expect(verifyBridgeRequest("load", body, headersOf(headers), "t".repeat(40), NOW)).toBe(false);
    expect(verifyBridgeRequest("load", body, headersOf({}), SECRET, NOW)).toBe(false);
  });

  it("refuses a signature more than 5 minutes off", () => {
    const headers = signBridgeRequest("load", body, SECRET, NOW);
    expect(verifyBridgeRequest("load", body, headersOf(headers), SECRET, NOW + 299_000)).toBe(true);
    expect(verifyBridgeRequest("load", body, headersOf(headers), SECRET, NOW + 301_000)).toBe(
      false,
    );
    expect(verifyBridgeRequest("load", body, headersOf(headers), SECRET, NOW - 301_000)).toBe(
      false,
    );
  });

  it("is not interchangeable with a user token (separate keys)", () => {
    const { token } = signCollabToken(
      { sub: "u", org: "o", doc: "note:o:n", perm: "write", name: "U", slot: 1 },
      SECRET,
      NOW,
    );
    const signature = token.split(".")[2];
    const headers = { "x-collab-timestamp": String(NOW), "x-collab-signature": signature };
    expect(verifyBridgeRequest("load", body, headersOf(headers), SECRET, NOW)).toBe(false);
  });
});
