import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

import { assertNoTx } from "@/server/db/context";

import type { AiCredentials } from "./connections";

/**
 * One schema-bound answer from whichever model the club connected.
 *
 * The rules every call follows (the same as the org chart's Claude reader):
 * - What the member pasted or uploaded is untrusted data. It goes in the user
 *   turn, wrapped and labelled as data; the system prompt says never to
 *   follow instructions inside it. The request has NO tools, so a model that
 *   is talked into something can only write text.
 * - The answer must match a zod schema (Claude: structured outputs; OpenAI-
 *   compatible APIs: a strict json_schema response format, or JSON mode with
 *   the schema in the prompt for a vendor without it) and is validated again
 *   here. Nothing it says is acted on until a person reviews it.
 * - Bounded: one request, capped output tokens, a timeout under the route's
 *   maxDuration, fixed hosts only (redirects refused).
 * - Errors are short and say what to do; they never contain the input.
 */

export class AiImportError extends Error {
  readonly status: number;
  constructor(message: string, status = 422) {
    super(message);
    this.name = "AiImportError";
    this.status = status;
  }
}

export interface AiImage {
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  base64: string;
}

/** A PDF: Claude reads it natively; OpenAI-compatible vendors get it as a file part (not all accept one). */
export interface AiDocument {
  mediaType: "application/pdf";
  base64: string;
  fileName: string;
}

export interface StructuredRequest<S extends z.ZodObject> {
  system: string;
  /** The member's material, already wrapped as data, plus the instruction. */
  text: string;
  image?: AiImage;
  document?: AiDocument;
  schema: S;
  /** A short schema name (OpenAI-compatible APIs want one). */
  name: string;
  maxOutputTokens: number;
  /** The local stand-in's answer (no model involved). */
  standin: () => z.infer<S>;
}

export interface StructuredResult<T> {
  data: T;
  usage: { input: number; output: number } | null;
  model: string;
  label: string;
}

const TIMEOUT_MS = 50_000;

/** Test seams: the SDK client and fetch. */
export const aiClients = {
  anthropic(apiKey: string): Pick<Anthropic, "beta"> {
    return new Anthropic({ apiKey, maxRetries: 1, timeout: TIMEOUT_MS });
  },
  fetch: (url: string, init: RequestInit): Promise<Response> => fetch(url, init),
};

export async function generateStructured<S extends z.ZodObject>(
  creds: AiCredentials,
  req: StructuredRequest<S>,
): Promise<StructuredResult<z.infer<S>>> {
  assertNoTx("generateStructured");
  switch (creds.protocol) {
    case "standin":
      return { data: req.schema.parse(req.standin()), usage: null, model: creds.model, label: creds.label };
    case "anthropic":
      return anthropicStructured(creds, req);
    case "openai":
      return openAiStructured(creds, req);
  }
}

// ---------------------------------------------------------------- Claude

function anthropicError(error: unknown, model: string, attachment: "image" | "pdf" | null): AiImportError {
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new AiImportError(
      "Claude rejected the API key. An owner or admin can update it in Settings › Integrations.",
      502,
    );
  }
  if (error instanceof Anthropic.NotFoundError) {
    return new AiImportError(`${model} isn't available to this API key. Pick another model in Settings.`, 502);
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new AiImportError("Claude is busy right now (rate limit). Try again in a minute.", 429);
  }
  if (error instanceof Anthropic.BadRequestError) {
    return new AiImportError(
      attachment === "image"
        ? "That image couldn't be read. Try a clearer screenshot."
        : attachment === "pdf"
          ? "That PDF couldn't be read. Try a smaller one (100 pages at most), or export the data as CSV."
          : "Claude couldn't read that. Try shortening it.",
      422,
    );
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError || error instanceof Anthropic.APIConnectionError) {
    return new AiImportError("Claude took too long to answer. Try again.", 504);
  }
  console.error("[ai] Claude call failed", error instanceof Error ? error.name : typeof error);
  return new AiImportError("The AI model couldn't be reached. Try again in a moment.", 502);
}

async function anthropicStructured<S extends z.ZodObject>(
  creds: Extract<AiCredentials, { protocol: "anthropic" }>,
  req: StructuredRequest<S>,
): Promise<StructuredResult<z.infer<S>>> {
  const format = betaZodOutputFormat(req.schema);
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (req.image) {
    content.push({ type: "image", source: { type: "base64", media_type: req.image.mediaType, data: req.image.base64 } });
  }
  if (req.document) {
    content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: req.document.base64 } });
  }
  content.push({ type: "text", text: req.text });
  let response: Anthropic.Beta.BetaMessage;
  try {
    response = await aiClients.anthropic(creds.apiKey).beta.messages.create({
      model: creds.model,
      max_tokens: req.maxOutputTokens,
      system: req.system,
      output_config: { format },
      messages: [{ role: "user", content }],
    });
  } catch (error) {
    throw anthropicError(error, creds.model, req.image ? "image" : req.document ? "pdf" : null);
  }
  if (response.stop_reason === "refusal") {
    throw new AiImportError("The model declined to read this. Try rewording it, or another model.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new AiImportError("That's too much to read in one go. Split it into smaller parts.");
  }
  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  let data: z.infer<S>;
  try {
    data = format.parse(text) as z.infer<S>;
  } catch {
    throw new AiImportError("The model's answer didn't come back in the expected shape. Try again.", 502);
  }
  return {
    data,
    usage: { input: response.usage.input_tokens, output: response.usage.output_tokens },
    model: creds.model,
    label: creds.label,
  };
}

// ---------------------------------------------------------------- OpenAI-compatible

/**
 * The zod schema as a strict JSON schema: every object closed and every
 * property required (nullable fields say null), which strict mode needs.
 */
export function strictJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== "object") return node;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === "$schema") continue;
      out[k] = walk(v);
    }
    if (out.type === "object" && out.properties && typeof out.properties === "object") {
      out.required = Object.keys(out.properties as Record<string, unknown>);
      out.additionalProperties = false;
    }
    return out;
  };
  return walk(z.toJSONSchema(schema)) as Record<string, unknown>;
}

interface ChatChoice {
  finish_reason?: string;
  message?: { content?: unknown; refusal?: unknown };
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof (part as { text?: unknown })?.text === "string" ? (part as { text: string }).text : ""))
      .join("");
  }
  return "";
}

/** The JSON in a reply, also when a model wraps it in a ```json fence. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return JSON.parse(fenced ? fenced[1] : trimmed);
}

async function openAiStructured<S extends z.ZodObject>(
  creds: Extract<AiCredentials, { protocol: "openai" }>,
  req: StructuredRequest<S>,
): Promise<StructuredResult<z.infer<S>>> {
  const schema = strictJsonSchema(req.schema);
  const userContent = req.image
    ? [
        { type: "text", text: req.text },
        { type: "image_url", image_url: { url: `data:${req.image.mediaType};base64,${req.image.base64}` } },
      ]
    : req.document
      ? [
          { type: "text", text: req.text },
          {
            type: "file",
            file: { filename: req.document.fileName, file_data: `data:application/pdf;base64,${req.document.base64}` },
          },
        ]
      : req.text;
  const send = (mode: "schema" | "json") =>
    aiClients.fetch(`${creds.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(creds.vendorId === "openrouter" ? { "X-Title": "Bananasplit" } : {}),
      },
      body: JSON.stringify({
        model: creds.model,
        messages: [
          {
            role: "system",
            content:
              mode === "schema"
                ? req.system
                : `${req.system}\n\nAnswer with ONE JSON object and nothing else. It must match this JSON Schema exactly:\n${JSON.stringify(schema)}`,
          },
          { role: "user", content: userContent },
        ],
        response_format:
          mode === "schema"
            ? { type: "json_schema", json_schema: { name: req.name, strict: true, schema } }
            : { type: "json_object" },
        [creds.maxTokensParam]: req.maxOutputTokens,
      }),
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

  const vendor = creds.label.split(" · ")[0];
  let res: Response;
  try {
    res = await send("schema");
    if (res.status === 400) {
      const body = await res.clone().text().catch(() => "");
      // A vendor (or model) without strict schemas: JSON mode, schema in the prompt.
      if (/response_format|json_schema|strict|schema/i.test(body)) res = await send("json");
    }
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new AiImportError(`${vendor} took too long to answer. Try again.`, 504);
    }
    console.error("[ai] model call failed", error instanceof Error ? error.name : typeof error);
    throw new AiImportError(`${vendor} couldn't be reached. Try again in a moment.`, 502);
  }

  if (res.status === 401 || res.status === 403) {
    throw new AiImportError(
      `${vendor} rejected the API key. An owner or admin can update it in Settings › Integrations.`,
      502,
    );
  }
  if (res.status === 404) {
    throw new AiImportError(`${vendor} doesn't know the model ${creds.model}. Check it in Settings › Integrations.`, 502);
  }
  if (res.status === 429) throw new AiImportError(`${vendor} is busy right now (rate limit). Try again in a minute.`, 429);
  if (res.status === 400 || res.status === 413 || res.status === 422) {
    throw new AiImportError(
      req.image
        ? `${creds.model} couldn't read the image. It may not accept images: pick a model that does, or a clearer screenshot.`
        : req.document
          ? `${creds.model} couldn't read the PDF. It may not accept PDFs: export the data as CSV, or use a Claude connection.`
          : `${vendor} couldn't read that. Try shortening it.`,
      422,
    );
  }
  if (!res.ok) throw new AiImportError(`${vendor} answered ${res.status}. Try again in a moment.`, 502);

  const json = (await res.json().catch(() => null)) as {
    choices?: ChatChoice[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  } | null;
  const choice = json?.choices?.[0];
  if (choice?.message?.refusal) {
    throw new AiImportError("The model declined to read this. Try rewording it, or another model.");
  }
  if (choice?.finish_reason === "length") {
    throw new AiImportError("That's too much to read in one go. Split it into smaller parts.");
  }
  let data: z.infer<S>;
  try {
    data = req.schema.parse(extractJson(messageText(choice?.message?.content))) as z.infer<S>;
  } catch {
    throw new AiImportError("The model's answer didn't come back in the expected shape. Try again or pick another model.", 502);
  }
  const usage = json?.usage;
  return {
    data,
    usage:
      usage && typeof usage.prompt_tokens === "number" && typeof usage.completion_tokens === "number"
        ? { input: usage.prompt_tokens, output: usage.completion_tokens }
        : null,
    model: creds.model,
    label: creds.label,
  };
}
