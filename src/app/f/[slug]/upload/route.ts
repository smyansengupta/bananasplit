import { getSession } from "@/lib/auth/session";
import { FORM_LIMITS } from "@/lib/forms/questions";
import { isCrossSite } from "@/lib/http/cross-site";
import { checkRateLimit, rateLimitKey, retryAfterText } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-ip";
import { formPageTarget } from "@/server/forms/public";
import { FormUploadError, storeFormUpload } from "@/server/forms/uploads";
import { inRouteMaxBytes } from "@/server/storage/direct";
import { readUpload, uploadErrorResponse } from "@/server/storage/upload";

/**
 * POST /f/{slug}/upload: a file for a form's upload question (multipart
 * `file` and `questionId`), from anyone who may answer the form, signed in
 * or not. Returns { id, name }; the answer carries the id. Rate-limited per
 * address; the type is sniffed from the bytes (src/server/forms/uploads.ts).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UPLOADS_PER_HOUR = 30;

function json(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (isCrossSite(request)) return json(403, { error: "Forbidden." });
  const { slug } = await params;
  const target = await formPageTarget(slug);
  if (!target) return json(404, { error: "This form isn't taking answers." });

  const limit = await checkRateLimit(
    rateLimitKey("form-upload", await getClientIp()),
    UPLOADS_PER_HOUR,
    60 * 60,
  );
  if (!limit.allowed)
    return json(429, { error: `Too many uploads. Try again ${retryAfterText(limit)}.` });

  const upload = await readUpload(request, {
    maxBytes: Math.min(FORM_LIMITS.uploadBytes, inRouteMaxBytes()),
  }).catch(uploadErrorResponse);
  if (upload instanceof Response) return upload;

  const session = await getSession();
  try {
    const file = await storeFormUpload(
      target,
      upload.fields.questionId ?? "",
      { bytes: upload.file.bytes, filename: upload.file.filename },
      {
        userId: session?.user.id ?? null,
        name: session?.user.name ?? null,
        email: session?.user.email ?? null,
      },
    );
    return json(200, file);
  } catch (error) {
    if (error instanceof FormUploadError) return json(error.status, { error: error.message });
    console.error("[forms] upload failed", error);
    return json(500, { error: "That didn't upload. Try again." });
  }
}
