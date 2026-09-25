// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";

import Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/secrets", () => ({ getSecret: vi.fn() }));
vi.mock("@/server/db/context", () => ({ assertNoTx: vi.fn(), withSystemOrgTx: vi.fn() }));

import { OrgChartParseSchema } from "@/lib/org-chart/schema";

import {
  anthropicClientFactory,
  buildParseRequest,
  ClaudeParseError,
  claudeConnectionTest,
  DEFAULT_MODEL,
  FALLBACK_BETA,
  MAX_INPUT_TOKENS,
  parseWithClaude,
  readClaudeSettings,
  SYSTEM_PROMPT,
  THINKING_BUDGET_TOKENS,
} from "./claude";
import type { ExtractedSource } from "./extract";

const dir = path.resolve("src/lib/org-chart/__fixtures__");
const rawJson = readFileSync(path.join(dir, "cbc-fall-2026.raw.json"), "utf8");
const injectionMd = readFileSync(path.join(dir, "cbc-injection.md"), "utf8");
const injectionRaw = readFileSync(path.join(dir, "cbc-injection.raw.json"), "utf8");

type CreateArgs = [Record<string, unknown>, Record<string, unknown>?];

function message(over: Partial<Anthropic.Beta.BetaMessage> & { text?: string }): Anthropic.Beta.BetaMessage {
  const { text, ...rest } = over;
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: DEFAULT_MODEL,
    stop_reason: "end_turn",
    stop_sequence: null,
    stop_details: null,
    content: text === undefined ? [] : [{ type: "text", text, citations: null }],
    usage: {
      input_tokens: 2100,
      output_tokens: 1800,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
    ...rest,
  } as unknown as Anthropic.Beta.BetaMessage;
}

function fakeClient(responses: Array<Anthropic.Beta.BetaMessage | Error>, tokens = 2100) {
  const create = vi.fn(async (..._args: CreateArgs) => {
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    if (next instanceof Error) throw next;
    return next;
  });
  const countTokens = vi.fn(async () => ({ input_tokens: tokens }));
  const retrieve = vi.fn(async () => ({ id: DEFAULT_MODEL }));
  const client = { beta: { messages: { create, countTokens } }, models: { retrieve } };
  return { client: client as unknown as Anthropic, create, countTokens, retrieve };
}

const textSource: ExtractedSource = { type: "text", text: "President: Jackson", format: "markdown" };
const config = { apiKey: "sk-ant-test-0000", model: DEFAULT_MODEL, fallbacks: true };

let factory: ReturnType<typeof vi.spyOn>;
afterEach(() => factory?.mockRestore());

function installClient(fake: ReturnType<typeof fakeClient>) {
  factory = vi.spyOn(anthropicClientFactory, "create").mockReturnValue(fake.client);
}

describe("buildParseRequest", () => {
  it("sends the document as a document block, framed as data, with no tools", () => {
    const req = buildParseRequest({ type: "text", text: injectionMd, format: "markdown" }, "board <v2>.md");
    expect(req.system).toBe(SYSTEM_PROMPT);
    expect(req.system).toMatch(/untrusted data/);
    expect(req).not.toHaveProperty("tools");
    const content = req.messages[0].content as Anthropic.Beta.BetaContentBlockParam[];
    expect(content[0]).toMatchObject({
      type: "document",
      title: "board  v2 .md",
      source: { type: "text", media_type: "text/plain" },
    });
    // The injection text is only ever inside the document block.
    expect(JSON.stringify(content.slice(1))).not.toMatch(/OWNER|attacker/);
    expect(req.system).not.toMatch(/attacker/);
  });

  it("sends a PDF natively", () => {
    const req = buildParseRequest({ type: "pdf", base64: "JVBERi0=", pages: 1 }, "chart.pdf");
    const content = req.messages[0].content as Anthropic.Beta.BetaContentBlockParam[];
    expect(content[0]).toMatchObject({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: "JVBERi0=" },
    });
  });
});

describe("parseWithClaude", () => {
  it("counts tokens, then asks Haiku for the strict schema with a thinking budget and no effort", async () => {
    const fake = fakeClient([message({ text: rawJson })]);
    installClient(fake);
    const result = await parseWithClaude({ config, source: textSource, filename: "cbc.md", timeoutMs: 120_000 });

    expect(DEFAULT_MODEL).toBe("claude-haiku-4-5-20251001");
    expect(result.parse).toEqual(OrgChartParseSchema.parse(JSON.parse(rawJson)));
    expect(result.usage).toMatchObject({ inputTokens: 2100, outputTokens: 1800, fallbackUsed: false });
    // 2,100 input and 1,800 output tokens on Haiku 4.5 ($1/$5 per MTok).
    expect(result.usage.costUsd).toBeCloseTo(0.0021 + 0.009, 6);
    expect(factory).toHaveBeenCalledWith(config.apiKey, 120_000);
    expect(fake.countTokens).toHaveBeenCalledTimes(1);
    const [body, options] = fake.create.mock.calls[0];
    expect(body).toMatchObject({
      model: DEFAULT_MODEL,
      max_tokens: 16_000,
      // Haiku 4.5 takes a budget, and rejects output_config.effort.
      thinking: { type: "enabled", budget_tokens: THINKING_BUDGET_TOKENS },
      output_config: { format: { type: "json_schema" } },
    });
    expect(body.output_config).not.toHaveProperty("effort");
    expect(body).not.toHaveProperty("betas");
    expect(body).not.toHaveProperty("fallbacks");
    expect(body).not.toHaveProperty("tools");
    expect(options).toMatchObject({ timeout: 120_000 });
  });

  it("asks a 4.6-family model for adaptive thinking, effort high and server-side fallbacks", async () => {
    const fake = fakeClient([message({ text: rawJson, model: "claude-opus-5" })]);
    installClient(fake);
    const result = await parseWithClaude({
      config: { ...config, model: "claude-opus-5" },
      source: textSource,
      filename: "cbc.md",
      timeoutMs: 1000,
    });
    const [body] = fake.create.mock.calls[0];
    expect(body).toMatchObject({
      model: "claude-opus-5",
      thinking: { type: "adaptive" },
      output_config: { effort: "high", format: { type: "json_schema" } },
      betas: [FALLBACK_BETA],
      fallbacks: "default",
    });
    // 2,100 input and 1,800 output tokens on Opus 5 ($5/$25 per MTok):
    // about five times what the same parse costs on Haiku.
    expect(result.usage.costUsd).toBeCloseTo(0.0105 + 0.045, 6);
  });

  it("never sends fallbacks to a model that does not take them", async () => {
    const fake = fakeClient([message({ text: rawJson })]);
    installClient(fake);
    await parseWithClaude({
      config: { ...config, model: "claude-sonnet-5", fallbacks: true },
      source: textSource,
      filename: null,
      timeoutMs: 1000,
    });
    expect(fake.create).toHaveBeenCalledTimes(1);
    expect(fake.create.mock.calls[0][0]).not.toHaveProperty("fallbacks");
  });

  it("refuses a document over the token budget without calling the model", async () => {
    const fake = fakeClient([], MAX_INPUT_TOKENS + 1);
    installClient(fake);
    const err = await parseWithClaude({ config, source: textSource, filename: null, timeoutMs: 1000 }).catch((e) => e);
    expect(err).toBeInstanceOf(ClaudeParseError);
    expect(err.retryable).toBe(false);
    expect(err.message).toMatch(/too long/);
    expect(fake.create).not.toHaveBeenCalled();
  });

  it("fails a refusal and a max_tokens stop without reading the content, and never retries them", async () => {
    for (const stop of ["refusal", "max_tokens"] as const) {
      const fake = fakeClient([message({ stop_reason: stop, text: '{"positions": [' })]);
      installClient(fake);
      const err = await parseWithClaude({ config, source: textSource, filename: null, timeoutMs: 1000 }).catch(
        (e) => e,
      );
      expect(err).toBeInstanceOf(ClaudeParseError);
      expect(err.retryable).toBe(false);
      expect(err.message).toMatch(stop === "refusal" ? /declined/ : /too long for Claude to finish/);
      factory.mockRestore();
    }
  });

  it("treats output that breaks the schema as a retryable failure", async () => {
    const fake = fakeClient([message({ text: '{"positions": [{"id": 1}], "open_items": []}' })]);
    installClient(fake);
    const err = await parseWithClaude({ config, source: textSource, filename: null, timeoutMs: 1000 }).catch((e) => e);
    expect(err).toBeInstanceOf(ClaudeParseError);
    expect(err.retryable).toBe(true);
  });

  it("resends once without fallbacks when the API rejects the parameter", async () => {
    const rejection = new Anthropic.BadRequestError(
      400,
      { type: "error", error: { type: "invalid_request_error", message: "fallbacks: not supported" } },
      "fallbacks: not supported",
      new Headers(),
    );
    const fake = fakeClient([rejection, message({ text: rawJson, model: "claude-opus-5" })]);
    installClient(fake);
    await parseWithClaude({
      config: { ...config, model: "claude-opus-5" },
      source: textSource,
      filename: null,
      timeoutMs: 1000,
    });
    expect(fake.create).toHaveBeenCalledTimes(2);
    expect(fake.create.mock.calls[0][0]).toHaveProperty("fallbacks");
    expect(fake.create.mock.calls[1][0]).not.toHaveProperty("fallbacks");
  });

  it("maps SDK errors to safe messages and retry decisions, never echoing the key", async () => {
    const cases: [Error, boolean, RegExp][] = [
      [new Anthropic.AuthenticationError(401, undefined, "invalid x-api-key sk-ant-test-0000", new Headers()), false, /rejected/],
      [new Anthropic.RateLimitError(429, undefined, "rate limited", new Headers()), true, /rate-limiting/],
      [new Anthropic.InternalServerError(529, undefined, "overloaded", new Headers()), true, /could not be reached/],
      [new Anthropic.APIConnectionTimeoutError(), true, /too long to answer/],
    ];
    for (const [error, retryable, pattern] of cases) {
      installClient(fakeClient([error]));
      const err = await parseWithClaude({ config, source: textSource, filename: null, timeoutMs: 1000 }).catch(
        (e) => e,
      );
      expect(err).toBeInstanceOf(ClaudeParseError);
      expect(err.retryable).toBe(retryable);
      expect(err.message).toMatch(pattern);
      expect(err.message).not.toContain("sk-ant");
      factory.mockRestore();
    }
  });

  it("parses the injection fixture's answer into schema-valid data only", async () => {
    installClient(fakeClient([message({ text: injectionRaw })]));
    const result = await parseWithClaude({
      config,
      source: { type: "text", text: injectionMd, format: "markdown" },
      filename: "board.md",
      timeoutMs: 1000,
    });
    expect(OrgChartParseSchema.safeParse(result.parse).success).toBe(true);
    expect(Object.keys(result.parse).sort()).toEqual(["open_items", "positions"]);
  });
});

describe("settings", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads the model and fallbacks from the integration config, ignoring junk", () => {
    expect(readClaudeSettings({})).toEqual({ model: DEFAULT_MODEL, fallbacks: true });
    expect(readClaudeSettings({ model: "claude-sonnet-5", fallbacks: false })).toEqual({
      model: "claude-sonnet-5",
      fallbacks: false,
    });
    expect(readClaudeSettings({ model: "gpt-5; drop table" }).model).toBe(DEFAULT_MODEL);
  });

  it("tests a key by retrieving the configured model", async () => {
    const fake = fakeClient([]);
    installClient(fake);
    const ok = await claudeConnectionTest({ secret: "sk", config: {}, signal: new AbortController().signal });
    expect(ok).toEqual({ ok: true, config: { model: DEFAULT_MODEL } });
    expect(fake.retrieve).toHaveBeenCalledWith(DEFAULT_MODEL, {}, expect.anything());
    expect(await claudeConnectionTest({ secret: null, config: {}, signal: new AbortController().signal })).toMatchObject({
      ok: false,
    });
  });
});
