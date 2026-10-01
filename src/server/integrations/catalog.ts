import { z } from "zod";

import type { IntegrationProvider, IntegrationStatus } from "@/generated/prisma/enums";
import { AI_MODEL_ID_PATTERN, AI_VENDOR_IDS } from "@/lib/ai/vendors";

/**
 * The org integrations (Settings > Integrations): what each one stores as
 * non-secret config, which secret kind holds its credential, and the DTO the
 * pages render. Secrets live only in OrgSecret (src/server/secrets); a DTO
 * carries status, the last four characters and whitelisted config fields,
 * never a secret, a fingerprint or ciphertext.
 */

// The model list, prices and per-model request rules live with the org
// chart, which first called Claude (the AI imports use the same key; B3 owns
// src/lib/org-chart/**). Haiku 4.5 is the default: the built-in parser
// reads most documents, so Claude only has to handle the awkward ones.
export { CLAUDE_MODELS, DEFAULT_CLAUDE_MODEL } from "@/lib/org-chart/models";

import { CLAUDE_MODELS as MODELS, DEFAULT_CLAUDE_MODEL as DEFAULT_MODEL } from "@/lib/org-chart/models";

/**
 * OrgIntegration.config for CLAUDE: { model, fallbacks }, the keys the org
 * chart parser reads (src/server/org-chart/claude.ts readClaudeSettings).
 * fallbacks: send Anthropic's server-side refusal fallbacks (default on,
 * and only sent to a model that supports them).
 */
export const claudeConfigSchema = z.object({
  model: z.enum(MODELS.map((m) => m.id) as [string, ...string[]]).default(DEFAULT_MODEL),
  fallbacks: z.boolean().default(true),
});

/**
 * OrgIntegration.config for OPENAI_COMPATIBLE: which vendor (a fixed
 * address from src/lib/ai/vendors.ts, never a URL) and which of its models.
 */
export const aiModelConfigSchema = z.object({
  vendor: z.enum(AI_VENDOR_IDS),
  model: z.string().trim().regex(AI_MODEL_ID_PATTERN, "Enter the model id exactly as your provider lists it."),
});

export const emailSenderConfigSchema = z.object({
  fromName: z.string().trim().min(1, "Enter a sender name").max(80),
  fromAddress: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email("Enter a valid from address"))
    .pipe(z.string().max(254)),
  replyTo: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .optional()
    .transform((v) => (v ? v : undefined))
    .pipe(z.email("Enter a valid reply-to address").optional()),
});

export const SUPABASE_POOLER_REGIONS = [
  "us-east-1",
  "us-east-2",
  "us-west-1",
  "us-west-2",
  "ca-central-1",
  "sa-east-1",
  "eu-west-1",
  "eu-west-2",
  "eu-west-3",
  "eu-central-1",
  "eu-central-2",
  "eu-north-1",
  "ap-south-1",
  "ap-southeast-1",
  "ap-southeast-2",
  "ap-northeast-1",
  "ap-northeast-2",
] as const;

export const supabaseConfigSchema = z.object({
  projectRef: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^[a-z]{20}$/,
      "The project ref is the 20 letters in your project URL (https://<ref>.supabase.co).",
    ),
  poolerRegion: z.enum(SUPABASE_POOLER_REGIONS),
  poolerPrefix: z.enum(["aws-0", "aws-1"]),
  roleName: z
    .string()
    .trim()
    .regex(
      /^[a-z_][a-z0-9_]{0,62}$/,
      "Use the database role's name (lowercase letters, digits, underscores).",
    )
    .default("cbc_suite_reader"),
});

export const NETLIFY_HOOK_PATTERN = /^https:\/\/api\.netlify\.com\/build_hooks\/[A-Za-z0-9]+$/;

export const googleCalendarConfigSchema = z.object({
  publicCalendarId: z.string().max(300).nullable().optional(),
  internalCalendarId: z.string().max(300).nullable().optional(),
});

export type ProviderKey = IntegrationProvider;

export interface ProviderInfo {
  provider: IntegrationProvider;
  /** Settings sub-page segment. */
  segment: string;
  label: string;
  description: string;
  secretKind: "API_KEY" | "REFRESH_TOKEN" | "DB_PASSWORD" | "HOOK_URL";
  /** Non-secret config keys a DTO may carry. */
  configKeys: readonly string[];
}

export const PROVIDERS: readonly ProviderInfo[] = [
  {
    provider: "EMAIL_RESEND",
    segment: "email",
    label: "Email sender",
    description: "Send notification email from your own address through Resend.",
    secretKind: "API_KEY",
    configKeys: [
      "fromName",
      "fromAddress",
      "replyTo",
      "domain",
      "domainStatus",
      "domainVerifiedAt",
    ],
  },
  {
    provider: "CLAUDE",
    segment: "claude",
    label: "Claude API",
    description: "Optional backup reader for org-chart imports the portal cannot parse itself.",
    secretKind: "API_KEY",
    configKeys: ["model", "fallbacks"],
  },
  {
    provider: "OPENAI_COMPATIBLE",
    segment: "ai-model",
    label: "Other AI models",
    description: "OpenAI, Gemini, OpenRouter and other model APIs, for the AI imports.",
    secretKind: "API_KEY",
    configKeys: ["vendor", "model"],
  },
  {
    provider: "GOOGLE_CALENDAR",
    segment: "google-calendar",
    label: "Google Calendar",
    description: "Mirrors events to your Google calendars.",
    secretKind: "REFRESH_TOKEN",
    configKeys: [
      "accountEmail",
      "scopes",
      "calendars",
      "publicCalendarId",
      "internalCalendarId",
      "connectedAt",
    ],
  },
  {
    provider: "SUPABASE_SOURCE",
    segment: "data-source",
    label: "Website data (Supabase)",
    description: "Syncs check-ins, signups and ballots from your website's database.",
    secretKind: "DB_PASSWORD",
    configKeys: ["projectRef", "poolerRegion", "poolerPrefix", "roleName", "contractVersion"],
  },
  {
    provider: "NETLIFY_BUILD_HOOK",
    segment: "website",
    label: "Website build hook",
    description: "Rebuilds your Netlify site when public events change.",
    secretKind: "HOOK_URL",
    configKeys: [],
  },
];

export function providerInfo(provider: IntegrationProvider): ProviderInfo {
  const info = PROVIDERS.find((p) => p.provider === provider);
  if (!info) throw new TypeError(`unknown provider ${provider}`);
  return info;
}

export interface IntegrationDto {
  provider: IntegrationProvider;
  status: IntegrationStatus | "NOT_SET_UP";
  /** Last four characters of the stored secret, for recognition only. */
  last4: string | null;
  hasSecret: boolean;
  lastVerifiedAt: string | null;
  /** Sanitized at write (no tokens, no email addresses). */
  lastError: string | null;
  config: Record<string, unknown>;
  connectedByName: string | null;
  updatedAt: string | null;
}

export interface IntegrationRowForDto {
  provider: IntegrationProvider;
  status: IntegrationStatus;
  /** Whether a secret is stored. Set for every secret; last4 is not. */
  secretFingerprint: string | null;
  secretLast4: string | null;
  lastVerifiedAt: Date | null;
  lastError: string | null;
  config: unknown;
  updatedAt: Date;
  connectedBy: { name: string | null } | null;
}

/**
 * The only shape an integration reaches a page in: whitelisted config keys,
 * status and last4. Never the fingerprint, never ciphertext, never a value
 * that is not in the provider's configKeys.
 *
 * `hasSecret` comes from secretFingerprint, not from last4: secretLast4 is
 * null for a credential shorter than 16 characters (four characters of a
 * short secret would give too much of it away), and reading "is a secret
 * stored?" off it made a short-but-valid credential look absent. Settings
 * then showed "Not saved" and hid Remove, so an OWNER could not revoke a
 * credential the app was still using.
 */
export function toIntegrationDto(
  provider: IntegrationProvider,
  row: IntegrationRowForDto | null,
): IntegrationDto {
  if (!row) {
    return {
      provider,
      status: "NOT_SET_UP",
      last4: null,
      hasSecret: false,
      lastVerifiedAt: null,
      lastError: null,
      config: {},
      connectedByName: null,
      updatedAt: null,
    };
  }
  const allowed = providerInfo(provider).configKeys;
  const raw =
    row.config && typeof row.config === "object" ? (row.config as Record<string, unknown>) : {};
  const config: Record<string, unknown> = {};
  for (const key of allowed) if (key in raw) config[key] = raw[key];
  return {
    provider,
    status: row.status,
    last4: row.secretLast4,
    hasSecret: row.secretFingerprint !== null,
    lastVerifiedAt: row.lastVerifiedAt?.toISOString() ?? null,
    lastError: row.lastError,
    config,
    connectedByName: row.connectedBy?.name ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}
