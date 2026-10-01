/**
 * The model APIs an org can connect besides Claude, for the AI imports
 * (action items into tasks, calendar screenshots into events). Every one of
 * them speaks the OpenAI chat-completions protocol at a FIXED address: the
 * org picks a vendor from this list and never types a URL, so the server
 * only ever calls these hosts (no SSRF through a settings field).
 *
 * Pure and client-safe: Settings renders the list and the hints from here.
 */

export interface AiVendor {
  id: string;
  label: string;
  /** chat/completions and models live under this. https, fixed. */
  baseUrl: string;
  /** What a key from this vendor looks like (shown as the placeholder). */
  keyHint: string;
  /** An example model id, for the placeholder. Any id the vendor serves works. */
  exampleModel: string;
  /** Where to make a key. */
  keysUrl: string;
  /** OpenAI's newer models take max_completion_tokens and refuse max_tokens. */
  maxTokensParam: "max_tokens" | "max_completion_tokens";
}

export const AI_VENDORS = [
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    keyHint: "sk-…",
    exampleModel: "gpt-4.1-mini",
    keysUrl: "platform.openai.com/api-keys",
    maxTokensParam: "max_completion_tokens",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    keyHint: "AIza…",
    exampleModel: "gemini-2.5-flash",
    keysUrl: "aistudio.google.com/apikey",
    maxTokensParam: "max_tokens",
  },
  {
    id: "openrouter",
    label: "OpenRouter (many models, one key)",
    baseUrl: "https://openrouter.ai/api/v1",
    keyHint: "sk-or-…",
    exampleModel: "openai/gpt-4.1-mini",
    keysUrl: "openrouter.ai/keys",
    maxTokensParam: "max_tokens",
  },
  {
    id: "mistral",
    label: "Mistral",
    baseUrl: "https://api.mistral.ai/v1",
    keyHint: "your Mistral key",
    exampleModel: "mistral-medium-latest",
    keysUrl: "console.mistral.ai/api-keys",
    maxTokensParam: "max_tokens",
  },
  {
    id: "groq",
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    keyHint: "gsk_…",
    exampleModel: "meta-llama/llama-4-scout-17b-16e-instruct",
    keysUrl: "console.groq.com/keys",
    maxTokensParam: "max_tokens",
  },
  {
    id: "together",
    label: "Together AI",
    baseUrl: "https://api.together.xyz/v1",
    keyHint: "your Together key",
    exampleModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    keysUrl: "api.together.ai/settings/api-keys",
    maxTokensParam: "max_tokens",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    keyHint: "sk-…",
    exampleModel: "deepseek-chat",
    keysUrl: "platform.deepseek.com/api_keys",
    maxTokensParam: "max_tokens",
  },
  {
    id: "xai",
    label: "xAI (Grok)",
    baseUrl: "https://api.x.ai/v1",
    keyHint: "xai-…",
    exampleModel: "grok-3-mini",
    keysUrl: "console.x.ai",
    maxTokensParam: "max_tokens",
  },
] as const satisfies readonly AiVendor[];

export type AiVendorId = (typeof AI_VENDORS)[number]["id"];

export const AI_VENDOR_IDS = AI_VENDORS.map((v) => v.id) as [AiVendorId, ...AiVendorId[]];

export function aiVendor(id: string | null | undefined): AiVendor | null {
  return AI_VENDORS.find((v) => v.id === id) ?? null;
}

/** Model ids as vendors write them: "gpt-4.1-mini", "openai/gpt-4.1", "models/gemini-2.5-flash". */
export const AI_MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,119}$/;
