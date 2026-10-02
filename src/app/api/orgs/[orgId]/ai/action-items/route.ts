import { z } from "zod";

import { MAX_ACTION_TEXT } from "@/lib/ai/action-items";
import { NotFoundError } from "@/lib/auth/errors";
import { getSession } from "@/lib/auth/session";
import { isCrossSite } from "@/lib/http/cross-site";
import { checkRateLimit, rateLimitKey, retryAfterText } from "@/lib/rate-limit";
import { resolveAiCredentials } from "@/server/ai/connections";
import { AiImportError } from "@/server/ai/generate";
import { readActionItems } from "@/server/ai/imports";
import { auditAiRead, loadImportContext } from "@/server/ai/route-context";

/**
 * POST /api/orgs/{orgId}/ai/action-items  { text, connection? }
 *
 * Any member: the club's connected AI model reads a pasted list of action
 * items (or a note) and proposes tasks and events, with owners matched to
 * members. Nothing is created here; the member reviews and edits the
 * proposal, and only then creates what they keep (through the normal task
 * and event actions, with their permissions). Rate-limited per member and
 * per club, since the club's key pays. Audited without the text.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PER_MEMBER_PER_HOUR = 20;
const PER_CLUB_PER_HOUR = 120;
const MAX_BODY_BYTES = 200_000;

const bodySchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, "Paste some action items first.")
    .max(MAX_ACTION_TEXT, `That's more than ${MAX_ACTION_TEXT.toLocaleString()} characters. Split it into smaller parts.`),
  connection: z.string().max(20).optional(),
});

function json(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  if (isCrossSite(request)) return json(403, { error: "Forbidden." });
  const session = await getSession();
  if (!session) return json(401, { error: "Sign in first." });

  let ctx;
  try {
    ctx = await loadImportContext(orgId);
  } catch (error) {
    if (error instanceof NotFoundError) return json(404, { error: "Not found." });
    throw error;
  }

  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return json(413, { error: "That's too much text for one import. Split it into smaller parts." });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json(400, { error: parsed.error.issues[0]?.message ?? "Paste some action items first." });

  for (const [key, limit] of [
    [rateLimitKey("ai-import-member", orgId, session.user.id), PER_MEMBER_PER_HOUR],
    [rateLimitKey("ai-import-club", orgId), PER_CLUB_PER_HOUR],
  ] as const) {
    const hit = await checkRateLimit(key, limit, 60 * 60);
    if (!hit.allowed) return json(429, { error: `Too many AI imports for now. Try again ${retryAfterText(hit)}.` });
  }

  const creds = await resolveAiCredentials(orgId, parsed.data.connection);
  if (!creds) {
    return json(409, {
      error: "No AI model is connected yet. An owner or admin can connect one in Settings › Integrations.",
      code: "no-connection",
    });
  }

  try {
    const result = await readActionItems({
      creds,
      text: parsed.data.text,
      members: ctx.members,
      today: ctx.today,
      timezone: ctx.timezone,
    });
    await auditAiRead(orgId, "ai.action_items_read", {
      connection: creds.id,
      model: result.model,
      characters: parsed.data.text.length,
      items: result.items.length,
    });
    return json(200, {
      items: result.items,
      notes: result.notes,
      members: ctx.members.map((m) => ({ id: m.userId, name: m.name, title: m.title })),
      readBy: result.label,
      canCreateEvents: ctx.canCreateEvents,
      rules: ctx.rules,
      timezone: ctx.timezone,
      today: ctx.today,
    });
  } catch (error) {
    if (error instanceof AiImportError) return json(error.status, { error: error.message });
    throw error;
  }
}
