import { SHOT_IMAGE_TYPES, type ShotImageType } from "@/lib/ai/calendar-shot";
import { NotFoundError } from "@/lib/auth/errors";
import { getSession } from "@/lib/auth/session";
import { sniffMimeType } from "@/lib/finance/file-sniff";
import { isCrossSite } from "@/lib/http/cross-site";
import { checkRateLimit, rateLimitKey, retryAfterText } from "@/lib/rate-limit";
import { resolveAiCredentials } from "@/server/ai/connections";
import { AiImportError } from "@/server/ai/generate";
import { readCalendarShot } from "@/server/ai/imports";
import { auditAiRead, loadImportContext } from "@/server/ai/route-context";
import { readUpload, uploadErrorResponse } from "@/server/storage/upload";

/**
 * POST /api/orgs/{orgId}/ai/calendar-screenshot  multipart `file` (+ `connection`)
 *
 * Owners and admins (events.write, who add calendar events): the club's
 * connected AI model reads a screenshot of a calendar item (an invite, an
 * email, a flyer) and proposes events. The image is checked by its bytes,
 * sent to the model once and never stored; nothing is created here. The
 * admin reviews the proposal and adds what they keep through the normal
 * event action. Rate-limited, audited without the image.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PER_MEMBER_PER_HOUR = 20;
const PER_CLUB_PER_HOUR = 120;

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
  if (!ctx.canCreateEvents) {
    return json(403, { error: "Only owners and admins can add calendar events." });
  }

  for (const [key, limit] of [
    [rateLimitKey("ai-import-member", orgId, session.user.id), PER_MEMBER_PER_HOUR],
    [rateLimitKey("ai-import-club", orgId), PER_CLUB_PER_HOUR],
  ] as const) {
    const hit = await checkRateLimit(key, limit, 60 * 60);
    if (!hit.allowed) return json(429, { error: `Too many AI imports for now. Try again ${retryAfterText(hit)}.` });
  }

  const upload = await readUpload(request).catch(uploadErrorResponse);
  if (upload instanceof Response) return upload;
  const type = sniffMimeType(upload.file.bytes);
  if (!type || !(SHOT_IMAGE_TYPES as readonly string[]).includes(type)) {
    return json(415, { error: "Upload a screenshot (PNG, JPEG, WebP or GIF)." });
  }

  const creds = await resolveAiCredentials(orgId, upload.fields.connection);
  if (!creds) {
    return json(409, {
      error: "No AI model is connected yet. An owner or admin can connect one in Settings › Integrations.",
      code: "no-connection",
    });
  }

  try {
    const result = await readCalendarShot({
      creds,
      image: { mediaType: type as ShotImageType, base64: upload.file.bytes.toString("base64") },
      today: ctx.today,
      timezone: ctx.timezone,
    });
    await auditAiRead(orgId, "ai.calendar_screenshot_read", {
      connection: creds.id,
      model: result.model,
      bytes: upload.file.bytes.length,
      events: result.events.length,
    });
    return json(200, {
      events: result.events,
      notes: result.notes,
      readBy: result.label,
      timezone: ctx.timezone,
      members: ctx.members.map((m) => ({ id: m.userId, name: m.name, title: m.title })),
    });
  } catch (error) {
    if (error instanceof AiImportError) return json(error.status, { error: error.message });
    throw error;
  }
}
