import { createHmac, generateKeyPairSync, sign } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({ requireUser: vi.fn(), getSession: vi.fn() }));
vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));

import { apiKeyStore, bearerKey, hashApiKey, newApiKey, parseApiKey, verifyApiKey } from "./api/keys";
import { afterCursor, CursorError, decodeCursor, encodeCursor, page, parseLimit } from "./api/pagination";
import { formParams, isTelnyxPublicKey, twilioSignature, verifyTelnyx, verifyTwilio } from "./phone/signatures";
import { phoneHttp, telnyxNumbers, twilioAccessToken, transcriptText, ProviderError } from "./phone/providers";
import { readClientState, clientState } from "./phone/live";
import { sniffAudio, signAudioLink, verifyAudioLink } from "./phone/audio";
import { standinSummary, summaryText } from "./phone/summary";
import { webhookEventsFor } from "./webhooks/events";
import { checkWebhookUrl, isBlockedAddress, localAllowed, UnsafeUrlError } from "./webhooks/guard";
import { newSigningSecret, signWebhook, verifyWebhookSignature } from "./webhooks";

/**
 * Phase 5's pure and seam-tested parts: provider signatures, API keys and
 * pagination, webhook signing, the SSRF guard, the softphone token and
 * the providers' HTTP behind phoneHttp (no real call leaves the test).
 */

afterEach(() => vi.restoreAllMocks());

describe("Telnyx signatures (ed25519)", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(12).toString("base64");
  const body = JSON.stringify({ data: { event_type: "call.hangup" } });
  const now = 1_762_000_000_000;
  const ts = String(Math.floor(now / 1000));
  const sig = sign(null, Buffer.from(`${ts}|${body}`), privateKey).toString("base64");

  it("accepts the account's own signature, fresh", () => {
    expect(isTelnyxPublicKey(raw)).toBe(true);
    expect(verifyTelnyx({ rawBody: body, signature: sig, timestamp: ts, publicKey: raw, now })).toBe(true);
  });

  it("refuses a changed body, another key, an old timestamp or nothing", () => {
    expect(verifyTelnyx({ rawBody: body + " ", signature: sig, timestamp: ts, publicKey: raw, now })).toBe(false);
    const other = generateKeyPairSync("ed25519").publicKey.export({ format: "der", type: "spki" }).subarray(12).toString("base64");
    expect(verifyTelnyx({ rawBody: body, signature: sig, timestamp: ts, publicKey: other, now })).toBe(false);
    expect(verifyTelnyx({ rawBody: body, signature: sig, timestamp: ts, publicKey: raw, now: now + 301_000 })).toBe(false);
    expect(verifyTelnyx({ rawBody: body, signature: null, timestamp: ts, publicKey: raw, now })).toBe(false);
    expect(verifyTelnyx({ rawBody: body, signature: sig, timestamp: ts, publicKey: null, now })).toBe(false);
    expect(isTelnyxPublicKey("not a key")).toBe(false);
  });
});

describe("Twilio signatures (HMAC-SHA1)", () => {
  // Twilio's documented example (Security, Validating requests).
  const token = "12345";
  const url = "https://mycompany.com/myapp.php?foo=1&bar=2";
  const params = {
    CallSid: "CA1234567890ABCDE",
    Caller: "+12349013030",
    Digits: "1234",
    From: "+12349013030",
    To: "+18005551212",
  };

  it("matches Twilio's own example", () => {
    expect(twilioSignature(token, url, params)).toBe("0/KCTR6DLpKmkAf8muzZqo1nDgQ=");
    expect(verifyTwilio({ url, params, signature: "0/KCTR6DLpKmkAf8muzZqo1nDgQ=", authToken: token })).toBe(true);
  });

  it("refuses another URL, a changed parameter or another token", () => {
    const good = twilioSignature(token, url, params);
    expect(verifyTwilio({ url: url + "&x=1", params, signature: good, authToken: token })).toBe(false);
    expect(verifyTwilio({ url, params: { ...params, To: "+1" }, signature: good, authToken: token })).toBe(false);
    expect(verifyTwilio({ url, params, signature: good, authToken: "other" })).toBe(false);
    expect(verifyTwilio({ url, params, signature: null, authToken: token })).toBe(false);
  });

  it("reads a form body", () => {
    expect(formParams("Body=STOP&From=%2B15551234567")).toEqual({ Body: "STOP", From: "+15551234567" });
  });
});

describe("API keys", () => {
  it("makes keys that name their organization, kept only as a hash", () => {
    const made = newApiKey("org_abc");
    expect(made.key).toMatch(/^bsk_org_abc\.[A-Za-z0-9_-]{43}$/);
    expect(made.keyHash).toBe(hashApiKey(made.key));
    expect(made.keyHash).not.toContain(made.key.split(".")[1]!);
    expect(made.prefix).toMatch(/^bsk_…[A-Za-z0-9_-]{8}$/);
    expect(parseApiKey(made.key)).toEqual({ organizationId: "org_abc", secret: made.key.split(".")[1] });
    expect(parseApiKey("bsk_org_abc.short")).toBeNull();
    expect(bearerKey("Bearer abc")).toBe("abc");
    expect(bearerKey("bearer  abc ")).toBe("abc");
    expect(bearerKey("Basic abc")).toBeNull();
    expect(bearerKey(null)).toBeNull();
  });

  it("verifies against the stored hash and the CRM being on", async () => {
    const made = newApiKey("org_abc");
    const find = vi.spyOn(apiKeyStore, "find");
    find.mockResolvedValueOnce(null);
    expect(await verifyApiKey(`Bearer ${made.key}`)).toMatchObject({ ok: false, status: 401 });
    expect(find).toHaveBeenCalledWith("org_abc", made.keyHash);
    find.mockResolvedValueOnce({ id: "k1", scopes: ["read", "write", "admin"], createdById: "u1", lastUsedAt: null, crm: true });
    expect(await verifyApiKey(`Bearer ${made.key}`)).toEqual({
      ok: true,
      key: { keyId: "k1", organizationId: "org_abc", scopes: ["read", "write"], createdById: "u1" },
    });
    find.mockResolvedValueOnce({ id: "k1", scopes: ["read"], createdById: null, lastUsedAt: null, crm: false });
    expect(await verifyApiKey(`Bearer ${made.key}`)).toMatchObject({ ok: false, status: 403, code: "crm_off" });
    expect(await verifyApiKey(null)).toMatchObject({ ok: false, status: 401 });
    expect(await verifyApiKey("Bearer bsk_nope")).toMatchObject({ ok: false, status: 401 });
  });
});

describe("cursor pagination", () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({ id: `r${i}`, createdAt: new Date(Date.UTC(2026, 0, 10 - i)) }));

  it("round-trips a cursor and pages newest first", () => {
    const c = encodeCursor(rows[2]!);
    expect(decodeCursor(c)).toEqual({ createdAt: rows[2]!.createdAt, id: "r2" });
    expect(decodeCursor(null)).toBeNull();
    const p = page(rows, 2);
    expect(p.rows.map((r) => r.id)).toEqual(["r0", "r1"]);
    expect(p.hasMore).toBe(true);
    expect(decodeCursor(p.nextCursor)).toEqual({ createdAt: rows[1]!.createdAt, id: "r1" });
    expect(page(rows.slice(0, 2), 2)).toMatchObject({ hasMore: false, nextCursor: null });
    expect(afterCursor(decodeCursor(c))).toEqual({
      OR: [{ createdAt: { lt: rows[2]!.createdAt } }, { createdAt: rows[2]!.createdAt, id: { lt: "r2" } }],
    });
  });

  it("refuses made-up cursors and clamps the limit", () => {
    expect(() => decodeCursor("not a cursor!")).toThrow(CursorError);
    expect(() => decodeCursor(Buffer.from('["x","y"]').toString("base64url"))).toThrow(CursorError);
    expect(() => decodeCursor(Buffer.from('["2026-01-01T00:00:00Z","a b"]').toString("base64url"))).toThrow(CursorError);
    expect(parseLimit(null)).toBe(25);
    expect(parseLimit("500")).toBe(100);
    expect(parseLimit("0")).toBe(25);
    expect(parseLimit("abc")).toBe(25);
  });
});

describe("webhook signing", () => {
  it("signs t.body with HMAC-SHA256 and verifies within five minutes", () => {
    const secret = newSigningSecret();
    expect(secret).toMatch(/^whsec_/);
    const body = '{"event":"person.created"}';
    const header = signWebhook(secret, body, 1_762_000_000);
    const mac = createHmac("sha256", secret).update(`1762000000.${body}`).digest("hex");
    expect(header).toBe(`t=1762000000,v1=${mac}`);
    expect(verifyWebhookSignature(secret, body, header, 1_762_000_100)).toBe(true);
    expect(verifyWebhookSignature(secret, body, header, 1_762_000_400)).toBe(false);
    expect(verifyWebhookSignature(secret, body + " ", header, 1_762_000_100)).toBe(false);
    expect(verifyWebhookSignature("whsec_other", body, header, 1_762_000_100)).toBe(false);
  });

  it("turns CRM events into webhook events", () => {
    expect(webhookEventsFor({ type: "record.changed", targetKind: "person", fields: ["created"] })).toEqual(["person.created"]);
    expect(webhookEventsFor({ type: "record.changed", targetKind: "person", fields: ["title"] })).toEqual(["person.updated"]);
    expect(webhookEventsFor({ type: "record.changed", targetKind: "company", fields: ["created"] })).toEqual(["company.created"]);
    expect(webhookEventsFor({ type: "record.changed", targetKind: "company", fields: ["name"] })).toEqual([]);
    expect(webhookEventsFor({ type: "record.changed", targetKind: "deal", fields: ["created"] })).toEqual(["deal.created"]);
    expect(webhookEventsFor({ type: "record.changed", targetKind: "deal", fields: ["stageId", "closeReason"] })).toEqual([
      "deal.stage_changed",
      "deal.closed",
    ]);
    expect(webhookEventsFor({ type: "call.logged", targetKind: "person", fields: [] })).toEqual(["call.logged"]);
    expect(webhookEventsFor({ type: "activity.logged", targetKind: "deal", fields: [] })).toEqual(["activity.logged"]);
    expect(webhookEventsFor({ type: "email.replied", targetKind: "person", fields: [] })).toEqual([]);
  });
});

describe("the SSRF guard", () => {
  const prod = { NODE_ENV: "production" };
  it("blocks private, loopback, link-local and reserved addresses", () => {
    for (const a of ["10.0.0.1", "127.0.0.1", "169.254.169.254", "172.16.5.4", "192.168.1.1", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "224.0.0.1"]) {
      expect(isBlockedAddress(a), a).toBe(true);
    }
    for (const a of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) expect(isBlockedAddress(a), a).toBe(false);
    expect(isBlockedAddress("not-an-ip")).toBe(true);
  });

  it("takes https only, refuses literal private hosts, and localhost only off production", () => {
    expect(checkWebhookUrl("https://hooks.zapier.com/hooks/catch/1/abc", prod).hostname).toBe("hooks.zapier.com");
    expect(() => checkWebhookUrl("http://hooks.zapier.com/x", prod)).toThrow(UnsafeUrlError);
    expect(() => checkWebhookUrl("https://10.0.0.5/x", prod)).toThrow(/private/);
    expect(() => checkWebhookUrl("https://[::1]/x", prod)).toThrow(UnsafeUrlError);
    expect(() => checkWebhookUrl("https://user:pw@example.com/x", prod)).toThrow(/password/);
    expect(() => checkWebhookUrl("https://intranet/x", prod)).toThrow(/domain/);
    expect(() => checkWebhookUrl("ftp://example.com", prod)).toThrow(UnsafeUrlError);
    expect(() => checkWebhookUrl("http://localhost:4000/hook", prod)).toThrow(/own addresses/);
    expect(checkWebhookUrl("http://localhost:4000/hook", { NODE_ENV: "development" }).port).toBe("4000");
    expect(localAllowed({ NODE_ENV: "production", CRM_WEBHOOKS_ALLOW_LOCAL: "1" })).toBe(true);
    expect(localAllowed({ NODE_ENV: "development", VERCEL: "1" })).toBe(false);
  });
});

describe("the providers behind their seam", () => {
  it("lists Telnyx numbers and never leaks the key in an error", async () => {
    const fetch = vi.spyOn(phoneHttp, "fetch");
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ phone_number: "+15551234567", connection_name: "Main" }] }), { status: 200 }));
    expect(await telnyxNumbers("KEYsecret")).toEqual([{ number: "+15551234567", label: "Main" }]);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toContain("api.telnyx.com/v2/phone_numbers");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer KEYsecret");
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ errors: [{ detail: "Bad number +15551234567" }] }), { status: 401 }));
    const err = await telnyxNumbers("KEYsecret").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).permanent).toBe(true);
    expect((err as Error).message).not.toContain("KEYsecret");
    expect((err as Error).message).not.toContain("5551234567");
  });

  it("signs a Twilio Voice access token for one member and the TwiML app", () => {
    const jwt = twilioAccessToken({
      accountSid: "AC" + "1".repeat(32),
      apiKeySid: "SK" + "2".repeat(32),
      apiKeySecret: "shh",
      appSid: "AP" + "3".repeat(32),
      identity: "user_1",
      now: 1_762_000_000_000,
    });
    const [h, p, s] = jwt.split(".");
    expect(JSON.parse(Buffer.from(h!, "base64url").toString())).toMatchObject({ alg: "HS256", cty: "twilio-fpa;v=1" });
    const payload = JSON.parse(Buffer.from(p!, "base64url").toString());
    expect(payload).toMatchObject({ iss: "SK" + "2".repeat(32), sub: "AC" + "1".repeat(32), exp: 1_762_000_000 + 3600 });
    expect(payload.grants).toEqual({
      identity: "user_1",
      voice: { incoming: { allow: false }, outgoing: { application_sid: "AP" + "3".repeat(32) } },
    });
    expect(s).toBe(createHmac("sha256", "shh").update(`${h}.${p}`).digest("base64url"));
  });

  it("carries the call id in Telnyx client_state and nothing else", () => {
    expect(readClientState(clientState("notice", "call_1"))).toEqual({ what: "notice", callId: "call_1" });
    expect(readClientState(Buffer.from("call:../x").toString("base64"))).toBeNull();
    expect(readClientState(123)).toBeNull();
  });

  it("labels speakers in a transcript only when there are two", () => {
    expect(transcriptText({ text: "hi there", lines: [{ speaker: 0, text: "hi there" }], durationSec: 2 })).toBe("hi there");
    expect(
      transcriptText({ text: "hi. hello", lines: [{ speaker: 0, text: "hi." }, { speaker: 1, text: "hello" }], durationSec: 2 }),
    ).toBe("Speaker 1: hi.\nSpeaker 2: hello");
  });
});

describe("audio and summaries", () => {
  it("knows audio by its bytes", () => {
    const pad = (b: number[]) => new Uint8Array([...b, ...new Array(16).fill(0)]);
    expect(sniffAudio(pad([0x1a, 0x45, 0xdf, 0xa3]))).toBe("audio/webm");
    expect(sniffAudio(pad([0x4f, 0x67, 0x67, 0x53]))).toBe("audio/ogg");
    expect(sniffAudio(pad([0x49, 0x44, 0x33]))).toBe("audio/mpeg");
    expect(sniffAudio(pad([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]))).toBe("audio/wav");
    expect(sniffAudio(pad([0x25, 0x50, 0x44, 0x46]))).toBeNull();
  });

  it("signs the voicemail link for one org and one file, for ten minutes", () => {
    vi.stubEnv("AUTH_SECRET", "test-secret");
    const now = 1_762_000_000_000;
    const t = signAudioLink("org_a", "crm-audio/org_a/voicemail/x.webm", 600_000, now);
    expect(verifyAudioLink("org_a", "crm-audio/org_a/voicemail/x.webm", t, now + 1000)).toBe(true);
    expect(verifyAudioLink("org_b", "crm-audio/org_a/voicemail/x.webm", t, now + 1000)).toBe(false);
    expect(verifyAudioLink("org_a", "crm-audio/org_a/voicemail/y.webm", t, now + 1000)).toBe(false);
    expect(verifyAudioLink("org_a", "crm-audio/org_a/voicemail/x.webm", t, now + 601_000)).toBe(false);
    vi.unstubAllEnvs();
  });

  it("the stand-in summary keeps promises as next steps", () => {
    const s = standinSummary("Speaker 1: Thanks for calling. Speaker 2: We will send the deck by Friday. Great.");
    expect(s.nextSteps).toEqual(["We will send the deck by Friday"]);
    expect(summaryText(s)).toMatch(/Next steps:\n- We will send the deck by Friday/);
  });
});
