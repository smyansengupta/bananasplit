import Anthropic from "@anthropic-ai/sdk";
import { Resend } from "resend";

import { assertNoTx } from "@/server/db/context";
import type { IntegrationTestContext, IntegrationTestResult } from "@/server/secrets";

import { NETLIFY_HOOK_PATTERN } from "./catalog";

/**
 * The network checks behind "Test" for each integration. Each runs inside
 * testIntegration (src/server/secrets): with NO transaction open, a 10 s
 * timeout (ctx.signal), the decrypted secret in hand, and a result that is
 * only ok or a short reason (sanitized again before it is stored). Every
 * host is fixed or derived: no free-form URLs (SSRF).
 *
 * `clients` is the test seam for the SDK clients and fetch.
 */

export const clients = {
  anthropic: (apiKey: string) =>
    new Anthropic({ apiKey, maxRetries: 0, timeout: 10_000 }) as Pick<Anthropic, "models">,
  resend: (apiKey: string) => new Resend(apiKey) as Pick<Resend, "domains">,
  fetch: (url: string, init: RequestInit) => fetch(url, init),
};

// ---------------------------------------------------------------- Claude

/**
 * The Claude key's "Test connection": lists the models the key can use
 * (models.list) and checks the configured model is among them. Same name
 * and signature as the org chart's claudeConnectionTest
 * (src/server/org-chart/claude.ts), which the integration may point at.
 */
export async function claudeConnectionTest(
  ctx: IntegrationTestContext,
): Promise<IntegrationTestResult> {
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
  const model = typeof ctx.config.model === "string" ? ctx.config.model : null;
  if (model && !ids.includes(model)) {
    return {
      ok: false,
      reason: `The key works, but it cannot use ${model}. Pick another default model.`,
    };
  }
  return { ok: true, config: model ? { model } : {} };
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
//
// The website data source's connection test lives with the sync that uses
// it: testSupabaseSource in src/server/sync/connection.ts. It derives the
// same fixed host from the same structured fields (no free-form host ever
// reaches a socket), and additionally understands the local stand-in
// config and refuses an export contract version this suite cannot read.
// Settings and the guided setup both call that one, so they cannot
// disagree about whether the website is reachable.

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
