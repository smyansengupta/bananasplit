import { AI_VENDORS } from "@/lib/ai/vendors";

/**
 * Whose keys pay for what in the CRM (docs/features/crm.md, "Whose keys pay
 * for what"). Every per-use cost (AI, web research, lookups, texts, calls,
 * transcripts, bulk email) runs on a key the organization saved, never on a
 * key of ours. Pure and client-safe: the org keys card renders from here,
 * and the server's messages use the same words.
 */

/** Where an owner or admin adds and changes the organization's keys. */
export const ORG_KEYS_PLACE = "CRM settings > AI";

export type OrgKeyId =
  | "anthropic"
  | "openai"
  | "tavily"
  | "hunter"
  | "prospeo"
  | "telnyx"
  | "twilio"
  | "deepgram"
  | "resend";

export type OrgKeyGroup = "ai" | "research" | "phone" | "email";

export const ORG_KEY_GROUPS: readonly { id: OrgKeyGroup; label: string; body: string }[] = [
  { id: "ai", label: "AI", body: "Drafts, summaries, Ask, AI fields and the agents. One is enough; Claude is tried first." },
  { id: "research", label: "Research and lookups", body: "Web research, enrichment and AI fields that search the web." },
  { id: "phone", label: "Calls and texts", body: "Calls and texts from your own number, and call transcripts." },
  { id: "email", label: "Bulk email", body: "Bulk email and campaigns go out from your own verified domain." },
];

export interface OrgKeyField {
  name: string;
  label: string;
  /** secret: write-only, never shown again; text: shown and kept; select: one of `options`. */
  type: "secret" | "text" | "select";
  placeholder?: string;
  optional?: boolean;
  options?: readonly { value: string; label: string }[];
}

export interface OrgKeyInfo {
  id: OrgKeyId;
  group: OrgKeyGroup;
  label: string;
  /** What it pays for, in a line. */
  body: string;
  /** Where to make a key. */
  keyUrl: string;
  /** The start of a key, for the mask ("sk-ant-…4f2a"); null when keys don't share one. */
  prefix: string | null;
  fields: readonly OrgKeyField[];
  /** Rough list price per use, for the estimate ("about $0.008 a search"). */
  priceNote: string;
}

export const ORG_KEYS: readonly OrgKeyInfo[] = [
  {
    id: "anthropic",
    group: "ai",
    label: "Claude (Anthropic)",
    body: "Your organization's Claude key. Also lets research search the web without Tavily.",
    keyUrl: "https://console.anthropic.com/settings/keys",
    prefix: "sk-ant-",
    fields: [{ name: "apiKey", label: "API key", type: "secret", placeholder: "sk-ant-…" }],
    priceNote: "Billed by Anthropic per token; a draft is usually under $0.02.",
  },
  {
    id: "openai",
    group: "ai",
    label: "OpenAI or another model",
    body: "Used when there's no Claude key. OpenAI, Gemini, OpenRouter, Mistral and others.",
    keyUrl: "https://platform.openai.com/api-keys",
    prefix: null,
    fields: [
      {
        name: "vendor",
        label: "Provider",
        type: "select",
        options: AI_VENDORS.map((v) => ({ value: v.id, label: v.label })),
      },
      { name: "model", label: "Model", type: "text", placeholder: "gpt-4.1-mini" },
      { name: "apiKey", label: "API key", type: "secret", placeholder: "sk-…" },
    ],
    priceNote: "Billed by the provider per token.",
  },
  {
    id: "tavily",
    group: "research",
    label: "Tavily",
    body: "Web search for the research agent, enrichment and AI fields.",
    keyUrl: "https://app.tavily.com",
    prefix: "tvly-",
    fields: [{ name: "apiKey", label: "API key", type: "secret", placeholder: "tvly-…" }],
    priceNote: "About $0.008 a search.",
  },
  {
    id: "hunter",
    group: "research",
    label: "Hunter",
    body: "Titles, companies and socials from an email address or a domain.",
    keyUrl: "https://hunter.io/api-keys",
    prefix: null,
    fields: [{ name: "apiKey", label: "API key", type: "secret" }],
    priceNote: "About $0.03 a lookup.",
  },
  {
    id: "prospeo",
    group: "research",
    label: "Prospeo",
    body: "People details from an email or a LinkedIn profile.",
    keyUrl: "https://app.prospeo.io/api",
    prefix: null,
    fields: [{ name: "apiKey", label: "API key", type: "secret" }],
    priceNote: "About $0.02 a lookup.",
  },
  {
    id: "telnyx",
    group: "phone",
    label: "Telnyx",
    body: "Calls and texts from your Telnyx number.",
    keyUrl: "https://portal.telnyx.com/#/app/api-keys",
    prefix: "KEY",
    fields: [
      { name: "apiKey", label: "API key", type: "secret", placeholder: "KEY…" },
      { name: "publicKey", label: "Public key", type: "text", placeholder: "From Keys and credentials, Public key" },
      { name: "connectionId", label: "Credential connection ID", type: "text", optional: true, placeholder: "For calls from the browser" },
    ],
    priceNote: "About $0.008 a text and $0.014 a minute.",
  },
  {
    id: "twilio",
    group: "phone",
    label: "Twilio",
    body: "Calls and texts from your Twilio number.",
    keyUrl: "https://console.twilio.com",
    prefix: null,
    fields: [
      { name: "accountSid", label: "Account SID", type: "text", placeholder: "AC…" },
      { name: "authToken", label: "Auth token", type: "secret" },
    ],
    priceNote: "About $0.008 a text and $0.014 a minute.",
  },
  {
    id: "deepgram",
    group: "phone",
    label: "Deepgram",
    body: "Writes out recorded calls and voice notes.",
    keyUrl: "https://console.deepgram.com",
    prefix: null,
    fields: [{ name: "apiKey", label: "API key", type: "secret" }],
    priceNote: "About $0.0043 a minute of audio.",
  },
  {
    id: "resend",
    group: "email",
    label: "Resend",
    body: "Bulk email from your own domain. Verify the domain in Resend first.",
    keyUrl: "https://resend.com/api-keys",
    prefix: "re_",
    fields: [
      { name: "fromName", label: "Sender name", type: "text", placeholder: "Harbor Robotics" },
      { name: "fromAddress", label: "From address", type: "text", placeholder: "hello@yourdomain.org" },
      { name: "apiKey", label: "API key", type: "secret", placeholder: "re_…" },
    ],
    priceNote: "About $0.0009 an email past Resend's free emails.",
  },
];

export const ORG_KEY_IDS = ORG_KEYS.map((k) => k.id) as [OrgKeyId, ...OrgKeyId[]];

export function orgKeyInfo(id: string): OrgKeyInfo | null {
  return ORG_KEYS.find((k) => k.id === id) ?? null;
}

/** "sk-ant-…4f2a" from a prefix and the last four characters; null when nothing is saved. */
export function maskKey(prefix: string | null, last4: string | null | undefined): string | null {
  if (!last4) return null;
  return `${prefix ?? ""}…${last4}`;
}

/** The usage meter's provider names (AiUsage.provider) for each key. */
export const METER_PROVIDERS: Record<OrgKeyId, readonly string[]> = {
  anthropic: ["claude"],
  openai: ["openai_compatible"],
  tavily: ["tavily"],
  hunter: ["hunter"],
  prospeo: ["prospeo"],
  telnyx: ["telnyx"],
  twilio: ["twilio"],
  deepgram: ["deepgram"],
  resend: ["resend"],
};

/** The key a meter row belongs to, if any. */
export function keyOfMeterProvider(provider: string): OrgKeyId | null {
  for (const [id, list] of Object.entries(METER_PROVIDERS) as [OrgKeyId, readonly string[]][]) {
    if (list.includes(provider)) return id;
  }
  return null;
}

// ---------------------------------------------------------------- the words people read

/** No AI key saved: what to do about it. */
export const NO_AI_KEY_MESSAGE = `No AI key is saved yet. An owner or admin can add your organization's Claude or OpenAI key in ${ORG_KEYS_PLACE}.`;

/** A provider's key is missing: what to do about it. */
export function missingKeyMessage(what: string): string {
  return `Add your ${what} key in ${ORG_KEYS_PLACE} first.`;
}

/** Past the monthly spending cap. */
export function capReachedMessage(capCents: number | null): string {
  const amount = capCents === null ? "" : ` of ${formatCents(capCents)}`;
  return `Your organization has reached this month's spending cap${amount}. An owner or admin can raise it in ${ORG_KEYS_PLACE}.`;
}

export function formatCents(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export interface OrgKeyState {
  id: OrgKeyId;
  group: OrgKeyGroup;
  label: string;
  /** "sk-ant-…4f2a", or null when no key is saved. */
  masked: string | null;
  /** saved and tested: connected; saved, failing: attention; saved, not yet tested: untested. */
  status: "none" | "connected" | "attention" | "untested";
  lastError: string | null;
  checkedAt: string | null;
  /** Non-secret values for the form (provider, model, sender, account SID...). */
  values: Record<string, string>;
  /** This month, on this key: estimated cost and how many uses. */
  spentMicros: number;
  uses: number;
}

export interface OrgKeysView {
  keys: OrgKeyState[];
  /** The organization's monthly spending cap in cents; null: no cap. */
  capCents: number | null;
  /** This month's estimated spend on all its keys. */
  spentMicros: number;
  /** "November 2026" */
  month: string;
  /** Whether the viewer may remove keys (owners). */
  canRemove: boolean;
  /** AI keys work on plans that include AI; false: saved AI keys aren't used yet. */
  aiOnPlan: boolean;
}
