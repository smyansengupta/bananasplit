import Anthropic from "@anthropic-ai/sdk";
import pg from "pg";
import { Resend } from "resend";

import { assertNoTx } from "@/server/db/context";
import type { IntegrationTestContext, IntegrationTestResult } from "@/server/secrets";

import { NETLIFY_HOOK_PATTERN, supabaseConfigSchema } from "./catalog";

/**
 * The network checks behind "Test" for each integration. Each runs inside
 * testIntegration (src/server/secrets): with NO transaction open, a 10 s
 * timeout (ctx.signal), the decrypted secret in hand, and a result that is
 * only ok or a short reason (sanitized again before it is stored). Every
 * host is fixed or derived: no free-form URLs (SSRF).
 *
 * `clients` is the test seam for the three SDK/driver clients.
 */

export const clients = {
  anthropic: (apiKey: string) =>
    new Anthropic({ apiKey, maxRetries: 0, timeout: 10_000 }) as Pick<Anthropic, "models">,
  resend: (apiKey: string) => new Resend(apiKey) as Pick<Resend, "domains">,
  pg: (config: pg.ClientConfig) =>
    new pg.Client(config) as Pick<pg.Client, "connect" | "query" | "end">,
  fetch: (url: string, init: RequestInit) => fetch(url, init),
};

// ---------------------------------------------------------------- Claude

/** Lists the models the key can use and checks the default model is among them. */
export async function testClaude(ctx: IntegrationTestContext): Promise<IntegrationTestResult> {
  assertNoTx("claude test");
  if (!ctx.secret) return { ok: false, reason: "Add an API key first." };
  const client = clients.anthropic(ctx.secret);
  const ids: string[] = [];
  try {
    for await (const model of client.models.list({ limit: 100 }, { signal: ctx.signal })) {
      ids.push(model.id);
      if (ids.length >= 500) break;
    }
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError)
      return { ok: false, reason: "Claude rejected this API key." };
    if (error instanceof Anthropic.PermissionDeniedError) {
      return { ok: false, reason: "This API key is not allowed to list models." };
    }
    if (error instanceof Anthropic.RateLimitError)
      return { ok: false, reason: "Claude rate-limited the test. Try again shortly." };
    if (error instanceof Anthropic.APIError)
      return { ok: false, reason: `Claude answered ${error.status ?? "an error"}.` };
    throw error;
  }
  const model = typeof ctx.config.defaultModel === "string" ? ctx.config.defaultModel : null;
  if (model && !ids.includes(model)) {
    return {
      ok: false,
      reason: `The key works, but it cannot use ${model}. Pick another default model.`,
    };
  }
  return { ok: true, config: { modelsCheckedAt: new Date().toISOString() } };
}

// ---------------------------------------------------------------- Resend

export function domainOfAddress(address: string): string {
  return address.slice(address.lastIndexOf("@") + 1).toLowerCase();
}

/**
 * The domain check: the from address's domain must be a VERIFIED domain in
 * the Resend account the key belongs to. Records domain status in config
 * (domainVerifiedAt switches org mail routing to this sender).
 */
export async function testResendDomain(
  ctx: IntegrationTestContext,
): Promise<IntegrationTestResult> {
  assertNoTx("resend domain check");
  if (!ctx.secret) return { ok: false, reason: "Add a Resend API key first." };
  const fromAddress = typeof ctx.config.fromAddress === "string" ? ctx.config.fromAddress : "";
  if (!fromAddress) return { ok: false, reason: "Set a from address first." };
  const domain = domainOfAddress(fromAddress);
  const { data, error } = await clients.resend(ctx.secret).domains.list();
  if (error) {
    const reason =
      error.name === "validation_error" || /api key/i.test(error.message)
        ? "Resend rejected this API key (it needs full access to read domains)."
        : `Resend answered: ${error.message}`;
    return { ok: false, reason };
  }
  const found = (data?.data ?? []).find((d) => d.name.toLowerCase() === domain);
  if (!found) {
    return {
      ok: false,
      reason: `${domain} is not a domain in this Resend account. Add and verify it in Resend first.`,
    };
  }
  if (found.status !== "verified") {
    return {
      ok: false,
      reason: `${domain} is ${found.status.replace(/_/g, " ")} in Resend. Finish the DNS records, then test again.`,
    };
  }
  return {
    ok: true,
    config: { domain, domainStatus: found.status, domainVerifiedAt: new Date().toISOString() },
  };
}

// ---------------------------------------------------------------- Supabase

/** The pooler host and user are derived from structured fields; free-form hosts are never accepted. */
export function supabaseConnection(
  config: unknown,
  password: string,
  env: Record<string, string | undefined> = process.env,
): pg.ClientConfig {
  const c = supabaseConfigSchema.parse(config);
  const host = `${c.poolerPrefix}-${c.poolerRegion}.pooler.supabase.com`;
  const ca = env.SUPABASE_ROOT_CA?.replace(/\\n/g, "\n").trim();
  return {
    host,
    port: 5432, // session mode
    database: "postgres",
    user: `${c.roleName}.${c.projectRef}`,
    password,
    // verify-full: the certificate must chain to the Supabase root CA (or the
    // system store when SUPABASE_ROOT_CA is unset) and match the host.
    ssl: { rejectUnauthorized: true, servername: host, ...(ca ? { ca } : {}) },
    connectionTimeoutMillis: 8_000,
    statement_timeout: 8_000,
    query_timeout: 9_000,
    application_name: "cbc-portal-settings-test",
  };
}

/** Connects read-only and asks the website export contract for its version. */
export async function testSupabase(ctx: IntegrationTestContext): Promise<IntegrationTestResult> {
  assertNoTx("supabase test");
  if (!ctx.secret) return { ok: false, reason: "Add the database password first." };
  let config: pg.ClientConfig;
  try {
    config = supabaseConnection(ctx.config, ctx.secret);
  } catch {
    return { ok: false, reason: "Fill in the project ref, pooler region, prefix and role first." };
  }
  const client = clients.pg(config);
  try {
    await client.connect();
    await client.query("SET default_transaction_read_only = on");
    const res = await client.query("SELECT suite_export.contract_version() AS v");
    const version = res.rows?.[0]?.v;
    return {
      ok: true,
      config: { contractVersion: version === undefined ? null : String(version).slice(0, 40) },
    };
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "28P01" || code === "28000")
      return { ok: false, reason: "The database refused the role name or password." };
    if (code === "3F000" || code === "42883") {
      return {
        ok: false,
        reason:
          "Connected, but suite_export.contract_version() is missing. Apply supabase/suite-export.sql in the website project.",
      };
    }
    if (code === "42501")
      return {
        ok: false,
        reason: "Connected, but the role may not run suite_export.contract_version().",
      };
    if (code === "ENOTFOUND" || code === "ECONNREFUSED" || code === "ETIMEDOUT") {
      return {
        ok: false,
        reason: "Could not reach the Supabase pooler. Check the region and the aws-0/aws-1 prefix.",
      };
    }
    if (error instanceof Error && /certificate|self[- ]signed|SSL/i.test(error.message)) {
      return {
        ok: false,
        reason: "The TLS certificate could not be verified (set SUPABASE_ROOT_CA on the platform).",
      };
    }
    return { ok: false, reason: error instanceof Error ? error.message : "The connection failed." };
  } finally {
    await client.end().catch(() => undefined);
  }
}

// ---------------------------------------------------------------- Netlify

export function isNetlifyHookUrl(url: string): boolean {
  return NETLIFY_HOOK_PATTERN.test(url.trim());
}

/** Triggers one build through the hook (the only way to prove a hook works). */
export async function testNetlifyHook(ctx: IntegrationTestContext): Promise<IntegrationTestResult> {
  assertNoTx("netlify hook test");
  if (!ctx.secret || !isNetlifyHookUrl(ctx.secret))
    return { ok: false, reason: "Add a valid Netlify build hook URL first." };
  const res = await clients.fetch(
    `${ctx.secret}?trigger_title=${encodeURIComponent("CBC Portal test build")}`,
    {
      method: "POST",
      signal: ctx.signal,
      redirect: "error",
      cache: "no-store",
    },
  );
  if (res.status === 404)
    return { ok: false, reason: "Netlify doesn't know this build hook. It may have been deleted." };
  if (!res.ok) return { ok: false, reason: `Netlify answered ${res.status}.` };
  return { ok: true };
}
