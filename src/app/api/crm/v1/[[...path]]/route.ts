import { NextResponse } from "next/server";

import { appUrl } from "@/lib/app-url";
import { checkRateLimit, rateLimitKey, retryAfterText } from "@/lib/rate-limit";
import { clientIpFrom } from "@/lib/request-ip";
import { apiError, handleApi, type ApiResponse } from "@/server/crm/api/handlers";
import { verifyApiKey } from "@/server/crm/api/keys";
import { openApiDocument } from "@/server/crm/api/openapi";

/**
 * The public CRM API (docs/features/crm.md module 11; the contract is
 * /api/crm/v1/openapi.json). In order: the key (Authorization: Bearer,
 * checked against its hash in its own organization), the key's rate limits
 * (300 a minute, 60 of them writes; bad keys are limited per IP), then the
 * request, in one service transaction in that organization only. JSON in,
 * JSON out, errors as { error: { code, message } }.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_BODY = 1024 * 1024;

function json(r: ApiResponse, headers: Record<string, string> = {}): NextResponse {
  return NextResponse.json(r.body, { status: r.status, headers: { "Cache-Control": "no-store", ...headers } });
}

async function serve(request: Request, ctx: { params: Promise<{ path?: string[] }> }): Promise<NextResponse> {
  const { path = [] } = await ctx.params;
  const ip = clientIpFrom(request.headers);

  if (request.method === "GET" && path.length === 1 && path[0] === "openapi.json") {
    const limited = await checkRateLimit(rateLimitKey("crm-api-doc", ip), 120, 60);
    if (!limited.allowed) return json(apiError(429, "rate_limited", "Too many requests. Try again in a minute."));
    return NextResponse.json(openApiDocument(appUrl("/api/crm/v1")), {
      headers: { "Cache-Control": "public, max-age=300" },
    });
  }

  const verified = await verifyApiKey(request.headers.get("authorization"));
  if (!verified.ok) {
    const bad = await checkRateLimit(rateLimitKey("crm-api-badkey", ip), 60, 600);
    if (!bad.allowed) return json(apiError(429, "rate_limited", `Too many bad keys. Try again ${retryAfterText(bad)}.`));
    return json(apiError(verified.status, verified.code, verified.message));
  }
  const { key } = verified;
  const writing = request.method === "POST" || request.method === "PATCH";
  const limited = await checkRateLimit(rateLimitKey("crm-api", key.keyId), 300, 60);
  const writeLimited = writing ? await checkRateLimit(rateLimitKey("crm-api-write", key.keyId), 60, 60) : { allowed: true };
  if (!limited.allowed || !writeLimited.allowed) {
    const over = (!limited.allowed ? limited : writeLimited) as { retryAfterMs?: number };
    return json(apiError(429, "rate_limited", "This key is over its limit. Slow down and try again."), {
      "Retry-After": String(Math.max(1, Math.ceil((over.retryAfterMs ?? 60_000) / 1000))),
    });
  }

  let body: unknown = undefined;
  if (writing) {
    const length = Number(request.headers.get("content-length") ?? "0");
    if (length > MAX_BODY) return json(apiError(413, "too_large", "Keep a request under 1 MB."));
    if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
      return json(apiError(415, "json_only", "Send JSON with Content-Type: application/json."));
    }
    const raw = await request.text();
    if (raw.length > MAX_BODY) return json(apiError(413, "too_large", "Keep a request under 1 MB."));
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      return json(apiError(400, "bad_json", "The body isn't valid JSON."));
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return json(apiError(400, "bad_json", "Send one JSON object."));
  }

  try {
    return json(await handleApi(key, request.method, path, new URL(request.url).searchParams, body));
  } catch (error) {
    console.error("[crm:api] request failed", error instanceof Error ? error.name : "error");
    return json(apiError(500, "internal", "Something went wrong on our side. Try again."));
  }
}

export const GET = serve;
export const POST = serve;
export const PATCH = serve;
