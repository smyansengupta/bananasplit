import { getSession } from "@/lib/auth/session";
import { sniffMimeType } from "@/lib/finance/file-sniff";
import { isCrossSite } from "@/lib/http/cross-site";
import { checkRateLimit, rateLimitKey, retryAfterText } from "@/lib/rate-limit";
import {
  readScheduleScreenshot,
  ScheduleImportError,
  type ScheduleImageType,
} from "@/server/availability/screenshot";
import { readUpload, uploadErrorResponse } from "@/server/storage/upload";

/**
 * POST /api/profile/availability/screenshot (multipart `file`): the busy
 * blocks Claude reads from a schedule screenshot, for the member to review.
 * Nothing is stored: not the image, not the blocks (they are saved only
 * when the member saves their week).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const IMPORTS_PER_HOUR = 10;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function json(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (isCrossSite(request)) return json(403, { error: "Forbidden." });
  const session = await getSession();
  if (!session) return json(401, { error: "Sign in first." });

  const limit = await checkRateLimit(rateLimitKey("schedule-import", session.user.id), IMPORTS_PER_HOUR, 60 * 60);
  if (!limit.allowed) return json(429, { error: `Too many imports. Try again ${retryAfterText(limit)}.` });

  const upload = await readUpload(request).catch(uploadErrorResponse);
  if (upload instanceof Response) return upload;
  const type = sniffMimeType(upload.file.bytes);
  if (!type || !IMAGE_TYPES.has(type)) return json(415, { error: "Upload a screenshot (PNG, JPEG, WebP or GIF)." });

  try {
    const blocks = await readScheduleScreenshot(upload.file.bytes, type as ScheduleImageType);
    return json(200, { blocks });
  } catch (error) {
    if (error instanceof ScheduleImportError) return json(error.status, { error: error.message });
    throw error;
  }
}
