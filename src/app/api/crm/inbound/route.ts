import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { addressList, cleanMessageId, ourAddresses, type InboundMessage } from "@/lib/crm/outreach/inbound";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { withSystemOrgTx } from "@/server/db/context";
import { ingestEmail, type IngestResult } from "@/server/crm/outreach/inbound";
import { inboundDomain } from "@/server/crm/outreach/mailbox";
import { publicTarget } from "@/server/crm/outreach/public";

/**
 * Where incoming mail arrives (docs/features/crm.md, "Whose mailbox"): a
 * Cloudflare Email Worker on CRM_INBOUND_DOMAIN parses each message and
 * POSTs it here with the shared secret (CRM_INBOUND_SECRET) as a bearer
 * token. The recipients say whose it is: log+{token}@ is a member's BCC
 * address, reply+{token}@ the Reply-To of an email the CRM sent. Each goes
 * to ingestEmail in its own organization. The Worker script and setup are
 * in docs/features/crm.md, "Phase 2 as built".
 */

export const maxDuration = 30;

const MAX_BYTES = 2_000_000;

const body = z.object({
  from: z.string().max(1000),
  to: z.array(z.string().max(1000)).max(100).default([]),
  headers: z.record(z.string().max(100), z.string().max(20_000)).default({}),
  text: z.string().max(1_000_000).default(""),
  html: z.string().max(1_000_000).nullish(),
});

function authorized(request: Request): boolean {
  const secret = process.env.CRM_INBOUND_SECRET;
  if (!secret || secret.length < 24) return false;
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const domain = inboundDomain();
  if (!domain) return NextResponse.json({ error: "CRM_INBOUND_DOMAIN is not set" }, { status: 503 });
  const limited = await checkRateLimit(rateLimitKey("crm-inbound", "worker"), 1200, 60);
  if (!limited.allowed) return NextResponse.json({ error: "slow down" }, { status: 429 });
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_BYTES) return NextResponse.json({ error: "too large" }, { status: 413 });
  const raw = await request.text();
  if (raw.length > MAX_BYTES) return NextResponse.json({ error: "too large" }, { status: 413 });
  let parsed: z.infer<typeof body>;
  try {
    parsed = body.parse(JSON.parse(raw));
  } catch {
    return NextResponse.json({ error: "bad message" }, { status: 400 });
  }
  const h = Object.fromEntries(Object.entries(parsed.headers).map(([k, v]) => [k.toLowerCase(), v]));
  const dateHeader = h["date"] ? new Date(h["date"]) : null;
  const message: InboundMessage = {
    messageId: cleanMessageId(h["message-id"]),
    inReplyTo: cleanMessageId(h["in-reply-to"]),
    references: (h["references"] ?? "")
      .split(/\s+/)
      .map((r) => cleanMessageId(r))
      .filter((r): r is string => Boolean(r))
      .slice(-20),
    from: h["from"] ?? parsed.from,
    to: addressList(h["to"] ?? ""),
    cc: addressList(h["cc"] ?? ""),
    envelopeTo: addressList(parsed.to),
    subject: (h["subject"] ?? "").slice(0, 1000),
    text: parsed.text,
    html: parsed.html ?? null,
    date: dateHeader && !Number.isNaN(dateHeader.getTime()) ? dateHeader : null,
    headers: h,
  };
  const ours = ourAddresses([...(message.envelopeTo ?? []), ...message.to, ...message.cc], domain);
  const results: IngestResult[] = [];
  for (const token of [...new Set(ours.bcc)].slice(0, 5)) {
    const t = await publicTarget("bcc", token);
    if (!t) continue;
    const settings = await withSystemOrgTx(t.organizationId, ({ db }) =>
      db.crmMemberSettings.findFirst({ where: { id: t.id, organizationId: t.organizationId }, select: { userId: true } }),
    );
    if (!settings) continue;
    results.push(await ingestEmail({ kind: "bcc", organizationId: t.organizationId, userId: settings.userId }, message));
  }
  for (const token of [...new Set(ours.reply)].slice(0, 5)) {
    if (!/^[a-f0-9]{24}$/.test(token)) continue;
    const t = await publicTarget("track", token);
    if (!t) continue;
    results.push(await ingestEmail({ kind: "reply", organizationId: t.organizationId, messageId: t.id }, message));
  }
  return NextResponse.json({ ok: true, results: results.map((r) => r.status) });
}
