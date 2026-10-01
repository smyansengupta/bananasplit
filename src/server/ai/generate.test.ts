// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("@/server/db/context", () => ({ assertNoTx: () => undefined }));

import type { AiCredentials } from "./connections";
import { aiClients, AiImportError, extractJson, generateStructured, strictJsonSchema } from "./generate";

const Schema = z.object({ items: z.array(z.object({ title: z.string(), due: z.string().nullable() })), notes: z.array(z.string()) });
const answer = { items: [{ title: "Book the room", due: null }], notes: [] };

const openai: AiCredentials = {
  id: "ai-model",
  protocol: "openai",
  apiKey: "sk-test-key-123456789",
  model: "gpt-test",
  label: "OpenAI · gpt-test",
  vendorId: "openai",
  baseUrl: "https://api.openai.com/v1",
  maxTokensParam: "max_completion_tokens",
};
const claude: AiCredentials = { id: "claude", protocol: "anthropic", apiKey: "sk-ant-test", model: "claude-haiku-4-5", label: "Claude Haiku 4.5" };

const request = (over: Partial<Parameters<typeof generateStructured>[1]> = {}) => ({
  system: "You read lists.",
  text: "<items>\n- book the room\n</items>",
  schema: Schema,
  name: "action_items",
  maxOutputTokens: 1000,
  standin: () => answer,
  ...over,
});

function reply(status: number, body: unknown): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => vi.restoreAllMocks());

describe("strictJsonSchema", () => {
  it("closes every object and requires every property", () => {
    const s = strictJsonSchema(Schema) as Record<string, unknown>;
    expect(s.$schema).toBeUndefined();
    expect(s.additionalProperties).toBe(false);
    expect(s.required).toEqual(["items", "notes"]);
    const inner = ((s.properties as Record<string, { items: Record<string, unknown> }>).items.items) as Record<string, unknown>;
    expect(inner.required).toEqual(["title", "due"]);
    expect(inner.additionalProperties).toBe(false);
  });
});

describe("extractJson", () => {
  it("reads plain and fenced JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
});

describe("OpenAI-compatible models", () => {
  it("asks for a strict JSON schema with no tools, at the vendor's fixed address", async () => {
    const fetchMock = vi
      .spyOn(aiClients, "fetch")
      .mockResolvedValue(reply(200, { choices: [{ message: { content: JSON.stringify(answer) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }));
    const result = await generateStructured(openai, request());
    expect(result.data).toEqual(answer);
    expect(result.usage).toEqual({ input: 10, output: 5 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(init.redirect).toBe("error");
    const body = JSON.parse(String(init.body));
    expect(body.tools).toBeUndefined();
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.max_completion_tokens).toBe(1000);
    expect(body.messages[0]).toEqual({ role: "system", content: "You read lists." });
  });

  it("falls back to JSON mode when the vendor has no strict schemas", async () => {
    const fetchMock = vi
      .spyOn(aiClients, "fetch")
      .mockResolvedValueOnce(reply(400, { error: { message: "response_format json_schema is not supported" } }))
      .mockResolvedValueOnce(reply(200, { choices: [{ message: { content: "```json\n" + JSON.stringify(answer) + "\n```" } }] }));
    const result = await generateStructured(openai, request());
    expect(result.data).toEqual(answer);
    const second = JSON.parse(String(fetchMock.mock.calls[1][1].body));
    expect(second.response_format).toEqual({ type: "json_object" });
    expect(second.messages[0].content).toContain("JSON Schema");
  });

  it("sends an image as a data URL next to the text", async () => {
    const fetchMock = vi
      .spyOn(aiClients, "fetch")
      .mockResolvedValue(reply(200, { choices: [{ message: { content: JSON.stringify(answer) } }] }));
    await generateStructured(openai, request({ image: { mediaType: "image/png", base64: "iVBORw0KGgo=" } }));
    const content = JSON.parse(String(fetchMock.mock.calls[0][1].body)).messages[1].content;
    expect(content[1]).toEqual({ type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } });
  });

  it("says what to do when the key, the model or the answer is wrong", async () => {
    const fetchMock = vi.spyOn(aiClients, "fetch");
    fetchMock.mockResolvedValueOnce(reply(401, { error: "bad key" }));
    await expect(generateStructured(openai, request())).rejects.toThrow(/rejected the API key/);
    fetchMock.mockResolvedValueOnce(reply(404, {}));
    await expect(generateStructured(openai, request())).rejects.toThrow(/doesn't know the model gpt-test/);
    fetchMock.mockResolvedValueOnce(reply(429, {}));
    await expect(generateStructured(openai, request())).rejects.toMatchObject({ status: 429 });
    fetchMock.mockResolvedValueOnce(reply(200, { choices: [{ message: { content: '{"items": "nope"}' } }] }));
    await expect(generateStructured(openai, request())).rejects.toThrow(/expected shape/);
    fetchMock.mockResolvedValueOnce(reply(200, { choices: [{ finish_reason: "length", message: { content: "{" } }] }));
    await expect(generateStructured(openai, request())).rejects.toThrow(/too much to read/);
    fetchMock.mockResolvedValueOnce(reply(200, { choices: [{ message: { refusal: "no", content: null } }] }));
    await expect(generateStructured(openai, request())).rejects.toBeInstanceOf(AiImportError);
  });
});

describe("Claude", () => {
  function claudeClient(response: unknown) {
    const create = vi.fn().mockResolvedValue(response);
    vi.spyOn(aiClients, "anthropic").mockReturnValue({ beta: { messages: { create } } } as never);
    return create;
  }

  it("uses structured outputs, no tools, and returns the parsed answer", async () => {
    const create = claudeClient({
      stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify(answer) }],
      usage: { input_tokens: 20, output_tokens: 7 },
    });
    const result = await generateStructured(claude, request());
    expect(result).toMatchObject({ data: answer, usage: { input: 20, output: 7 }, model: "claude-haiku-4-5" });
    const sent = create.mock.calls[0][0];
    expect(sent.tools).toBeUndefined();
    expect(sent.output_config.format).toBeTruthy();
    expect(sent.system).toBe("You read lists.");
  });

  it("refuses to use a declined or cut-off answer", async () => {
    claudeClient({ stop_reason: "refusal", content: [], usage: { input_tokens: 1, output_tokens: 0 } });
    await expect(generateStructured(claude, request())).rejects.toThrow(/declined/);
    claudeClient({ stop_reason: "max_tokens", content: [{ type: "text", text: "{" }], usage: { input_tokens: 1, output_tokens: 1 } });
    await expect(generateStructured(claude, request())).rejects.toThrow(/too much/);
  });
});

describe("the local stand-in", () => {
  it("answers without any network call", async () => {
    const fetchMock = vi.spyOn(aiClients, "fetch");
    const result = await generateStructured(
      { id: "standin", protocol: "standin", model: "stand-in", label: "Local stand-in" },
      request(),
    );
    expect(result.data).toEqual(answer);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
