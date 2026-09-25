import { createHash } from "node:crypto";

import { withSystemOrgTx } from "@/server/db/context";

/**
 * Shared plumbing of the public, read-only events endpoints
 * (/api/public/[orgSlug]/events and /events.ics).
 *
 * - The slug resolves through app.resolve_org_slug. A retired slug (the org
 *   was renamed) answers 307 to the canonical URL with no-store; retired
 *   slugs are reserved forever, so no other org can take one over.
 * - The feed is opt-in: OrgSettings.publicEventsEnabled. An unknown slug and
 *   a disabled org get the SAME 404 (same body, same headers), so the
 *   endpoint does not reveal which orgs exist.
 * - Responses carry CORS *, an ETag with 304 support and a CDN
 *   Cache-Control (s-maxage=300, stale-while-revalidate=86400). No cookies
 *   are read or set.
 */

export const PUBLIC_CACHE_CONTROL = "public, s-maxage=300, stale-while-revalidate=86400";
export const NOT_FOUND_CACHE_CONTROL = "public, s-maxage=60";

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Expose-Headers": "ETag",
};

export type FeedOrg =
  | { kind: "ok"; organizationId: string; slug: string }
  | { kind: "redirect"; canonicalSlug: string }
  | { kind: "not-found" };

/** Test seam: the two reads. */
export const feedStore = {
  async resolveSlug(
    slug: string,
  ): Promise<{ organizationId: string; canonicalSlug: string; isRetired: boolean } | null> {
    return withSystemOrgTx(null, async ({ db }) => {
      const rows = await db.$queryRaw<
        { organizationId: string; canonicalSlug: string; isRetired: boolean }[]
      >`SELECT "organizationId", "canonicalSlug", "isRetired" FROM app.resolve_org_slug(${slug})`;
      return rows[0] ?? null;
    });
  },
  async isEnabled(organizationId: string): Promise<boolean> {
    return withSystemOrgTx(organizationId, async ({ db }) => {
      const settings = await db.orgSettings.findUnique({
        where: { organizationId },
        select: { publicEventsEnabled: true },
      });
      return settings?.publicEventsEnabled === true;
    });
  },
};

/** Resolves a slug for the public feed. Malformed slugs never reach the database. */
export async function resolveFeedOrg(slug: string): Promise<FeedOrg> {
  const clean = slug.toLowerCase();
  if (!SLUG.test(clean)) return { kind: "not-found" };
  const resolved = await feedStore.resolveSlug(clean);
  if (!resolved) return { kind: "not-found" };
  if (resolved.isRetired) return { kind: "redirect", canonicalSlug: resolved.canonicalSlug };
  if (!(await feedStore.isEnabled(resolved.organizationId))) return { kind: "not-found" };
  return { kind: "ok", organizationId: resolved.organizationId, slug: resolved.canonicalSlug };
}

/** A strong ETag over the exact response bytes. */
export function etagOf(body: string): string {
  return `"${createHash("sha256").update(body, "utf8").digest("base64url")}"`;
}

/** True when If-None-Match names `etag` (or is *). Weak prefixes compare equal (RFC 9110 13.1.2). */
export function matchesIfNoneMatch(header: string | null, etag: string): boolean {
  if (!header) return false;
  const strip = (t: string) => t.trim().replace(/^W\//, "");
  const target = strip(etag);
  return header.split(",").some((t) => {
    const v = t.trim();
    return v === "*" || strip(v) === target;
  });
}

export interface FeedBody {
  body: string;
  contentType: string;
  /** Extra headers (Content-Disposition for the .ics). */
  headers?: Record<string, string>;
}

/** 200 with the body, or 304 when the client already has these bytes. */
export function feedResponse(request: Request, feed: FeedBody): Response {
  const etag = etagOf(feed.body);
  const headers: Record<string, string> = {
    ...CORS_HEADERS,
    "Cache-Control": PUBLIC_CACHE_CONTROL,
    ETag: etag,
    ...(feed.headers ?? {}),
  };
  if (matchesIfNoneMatch(request.headers.get("if-none-match"), etag)) {
    return new Response(null, { status: 304, headers });
  }
  const bytes = Buffer.from(feed.body, "utf8");
  return new Response(request.method === "HEAD" ? null : bytes, {
    status: 200,
    headers: {
      ...headers,
      "Content-Type": feed.contentType,
      "Content-Length": String(bytes.length),
    },
  });
}

/** The one 404 for unknown and disabled orgs alike. */
export function feedNotFound(format: "json" | "ics"): Response {
  const body = format === "json" ? JSON.stringify({ error: "Not found" }) : "Not found\n";
  return new Response(body, {
    status: 404,
    headers: {
      ...CORS_HEADERS,
      "Cache-Control": NOT_FOUND_CACHE_CONTROL,
      "Content-Type":
        format === "json" ? "application/json; charset=utf-8" : "text/plain; charset=utf-8",
    },
  });
}

/** 307 to the canonical slug's feed; never cached (the slug may be renamed again). */
export function feedRedirect(request: Request, canonicalSlug: string, leaf: string): Response {
  const target = new URL(`/api/public/${encodeURIComponent(canonicalSlug)}/${leaf}`, request.url);
  target.search = new URL(request.url).search;
  return new Response(null, {
    status: 307,
    headers: { ...CORS_HEADERS, "Cache-Control": "no-store", Location: target.toString() },
  });
}

/** CORS preflight. */
export function feedOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      ...CORS_HEADERS,
      "Access-Control-Allow-Headers": "If-None-Match",
      "Access-Control-Max-Age": "86400",
    },
  });
}
