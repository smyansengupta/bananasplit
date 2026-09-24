// @vitest-environment node
import Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db/context", async () =>
  (await import("@/test/fake-context")).fakeContextModule(),
);

import { toIntegrationDto } from "./catalog";
import {
  clients,
  isNetlifyHookUrl,
  claudeConnectionTest,
  testNetlifyHook,
  testResendDomain,
} from "./providers";

const signal = new AbortController().signal;
const ctx = (secret: string | null, config: Record<string, unknown> = {}) => ({
  secret,
  config,
  signal,
});

beforeEach(() => vi.restoreAllMocks());

describe("Claude test (models.list)", () => {
  function models(ids: string[]) {
    return {
      models: {
        list: () =>
          (async function* () {
            for (const id of ids) yield { id };
          })(),
      },
    };
  }

  it("passes when the key lists the default model", async () => {
    vi.spyOn(clients, "anthropic").mockReturnValue(
      models(["claude-opus-5", "claude-haiku-4-5"]) as never,
    );
    expect(await claudeConnectionTest(ctx("sk-ant-x", { model: "claude-opus-5" }))).toMatchObject({
      ok: true,
    });
  });

  it("fails when the default model is not available to the key", async () => {
    vi.spyOn(clients, "anthropic").mockReturnValue(models(["claude-haiku-4-5"]) as never);
    const r = await claudeConnectionTest(ctx("sk-ant-x", { model: "claude-opus-5" }));
    expect(r).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/cannot use claude-opus-5/),
    });
  });

  it("maps an authentication error without echoing the key", async () => {
    vi.spyOn(clients, "anthropic").mockReturnValue({
      models: {
        list: () =>
          (async function* () {
            throw new Anthropic.AuthenticationError(
              401,
              { error: {} },
              "invalid x-api-key",
              new Headers(),
            );
          })(),
      },
    } as never);
    const r = await claudeConnectionTest(ctx("sk-ant-SECRET-KEY-VALUE"));
    expect(r).toEqual({ ok: false, reason: "Claude rejected this API key." });
  });

  it("needs a key", async () => {
    expect(await claudeConnectionTest(ctx(null))).toMatchObject({ ok: false });
  });
});

describe("Resend domain check", () => {
  const domains = (list: { name: string; status: string }[] | null, error: unknown = null) =>
    ({ domains: { list: async () => ({ data: list ? { data: list } : null, error }) } }) as never;

  it("passes only for a verified domain of the from address, and records it", async () => {
    vi.spyOn(clients, "resend").mockReturnValue(
      domains([{ name: "mail.club.org", status: "verified" }]),
    );
    const r = await testResendDomain(ctx("re_x", { fromAddress: "team@mail.club.org" }));
    expect(r).toMatchObject({
      ok: true,
      config: { domain: "mail.club.org", domainStatus: "verified" },
    });
  });

  it("explains a pending or missing domain", async () => {
    vi.spyOn(clients, "resend").mockReturnValue(
      domains([{ name: "mail.club.org", status: "pending" }]),
    );
    expect(await testResendDomain(ctx("re_x", { fromAddress: "a@mail.club.org" }))).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/pending/),
    });
    vi.spyOn(clients, "resend").mockReturnValue(domains([]));
    expect(await testResendDomain(ctx("re_x", { fromAddress: "a@other.org" }))).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/not a domain in this Resend account/),
    });
  });

  it("reports a rejected key", async () => {
    vi.spyOn(clients, "resend").mockReturnValue(
      domains(null, { name: "validation_error", message: "API key is invalid" }),
    );
    expect(await testResendDomain(ctx("re_x", { fromAddress: "a@b.org" }))).toMatchObject({
      ok: false,
    });
  });
});

describe("Netlify build hook", () => {
  it("accepts only https://api.netlify.com/build_hooks/<id>", () => {
    expect(isNetlifyHookUrl("https://api.netlify.com/build_hooks/64f0c1a2b3")).toBe(true);
    for (const bad of [
      "http://api.netlify.com/build_hooks/abc",
      "https://api.netlify.com.evil.com/build_hooks/abc",
      "https://api.netlify.com/build_hooks/abc?x=1",
      "https://api.netlify.com/build_hooks/../hooks",
      "https://evil.com/build_hooks/abc",
      "https://api.netlify.com/build_hooks/",
    ]) {
      expect(isNetlifyHookUrl(bad), bad).toBe(false);
    }
  });

  it("test triggers a build through the hook", async () => {
    const fetchSpy = vi
      .spyOn(clients, "fetch")
      .mockResolvedValue(new Response("", { status: 200 }));
    expect(await testNetlifyHook(ctx("https://api.netlify.com/build_hooks/abc123"))).toEqual({
      ok: true,
    });
    expect(fetchSpy.mock.calls[0][0]).toMatch(
      /^https:\/\/api\.netlify\.com\/build_hooks\/abc123\?trigger_title=/,
    );
    vi.spyOn(clients, "fetch").mockResolvedValue(new Response("", { status: 404 }));
    expect(await testNetlifyHook(ctx("https://api.netlify.com/build_hooks/abc123"))).toMatchObject({
      ok: false,
    });
  });
});

describe("integration DTOs never carry secrets", () => {
  it("whitelists config keys and drops the fingerprint", () => {
    const dto = toIntegrationDto("CLAUDE", {
      provider: "CLAUDE",
      status: "CONNECTED",
      secretLast4: "WXYZ",
      lastVerifiedAt: new Date("2026-09-01T00:00:00Z"),
      lastError: null,
      config: { model: "claude-opus-5", apiKey: "sk-ant-LEAKED", secretFingerprint: "abc" },
      updatedAt: new Date("2026-09-01T00:00:00Z"),
      connectedBy: { name: "Owner" },
      ...({ secretFingerprint: "hmac-value" } as object),
    } as never);
    const text = JSON.stringify(dto);
    expect(dto.config).toEqual({ model: "claude-opus-5" });
    expect(text).not.toContain("sk-ant-LEAKED");
    expect(text).not.toContain("hmac-value");
    expect(dto).toMatchObject({ last4: "WXYZ", hasSecret: true, status: "CONNECTED" });
  });

  it("shows NOT_SET_UP when there is no row", () => {
    expect(toIntegrationDto("NETLIFY_BUILD_HOOK", null)).toMatchObject({
      status: "NOT_SET_UP",
      hasSecret: false,
    });
  });

  /**
   * secretLast4 is null for a credential under 16 characters, so reading
   * "is a secret stored?" off it hid a short-but-valid one: Settings said
   * "Not saved" and hid Remove, and an OWNER could not revoke a credential
   * the app was still using. hasSecret comes from secretFingerprint, which
   * every stored secret has, and the fingerprint stays out of the DTO.
   */
  const row = {
    provider: "NETLIFY_BUILD_HOOK",
    status: "CONNECTED",
    lastVerifiedAt: null,
    lastError: null,
    config: {},
    updatedAt: new Date("2026-09-01T00:00:00Z"),
    connectedBy: null,
  } as const;

  it("reports a short secret as saved, with no last4 to show", () => {
    const dto = toIntegrationDto("NETLIFY_BUILD_HOOK", {
      ...row,
      secretFingerprint: "0f1e2d3c4b5a69788796a5b4c3d2e1f0",
      secretLast4: null,
    });
    expect(dto).toMatchObject({ hasSecret: true, last4: null });
    expect(JSON.stringify(dto)).not.toContain("0f1e2d3c4b5a69788796a5b4c3d2e1f0");
  });

  it("reports no secret only when the fingerprint is gone (removeSecret clears both)", () => {
    const dto = toIntegrationDto("NETLIFY_BUILD_HOOK", {
      ...row,
      status: "DISCONNECTED",
      secretFingerprint: null,
      secretLast4: null,
    });
    expect(dto).toMatchObject({ hasSecret: false, last4: null });
  });
});
