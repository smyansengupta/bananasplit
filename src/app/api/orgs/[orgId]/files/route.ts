import { NotFoundError } from "@/lib/auth/errors";
import { getSession } from "@/lib/auth/session";
import { isCrossSite } from "@/lib/http/cross-site";
import { checkRateLimit, rateLimitKey, retryAfterText } from "@/lib/rate-limit";
import { FileRejectedError, storeNoteFile } from "@/server/notes/files";
import { STORAGE_NOT_SET_UP, StorageConfigError } from "@/server/storage";
import { readUpload, uploadErrorResponse } from "@/server/storage/upload";

/**
 * POST /api/orgs/{orgId}/files: a file for the Notes page (multipart `file`,
 * optional `visibility` PRIVATE | ORGANIZATION, default ORGANIZATION).
 * Any member may upload; the type is sniffed from the bytes; the row is
 * written as the uploader under RLS.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UPLOADS_PER_HOUR = 60;

function json(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  if (isCrossSite(request)) return json(403, { error: "Forbidden." });
  const session = await getSession();
  if (!session) return json(401, { error: "Sign in to upload." });
  const { orgId } = await params;

  const limit = await checkRateLimit(rateLimitKey("note-file", session.user.id), UPLOADS_PER_HOUR, 60 * 60);
  if (!limit.allowed) return json(429, { error: `Too many uploads. Try again ${retryAfterText(limit)}.` });

  const upload = await readUpload(request).catch(uploadErrorResponse);
  if (upload instanceof Response) return upload;
  const visibility = upload.fields.visibility === "PRIVATE" ? "PRIVATE" : "ORGANIZATION";

  try {
    const file = await storeNoteFile({
      orgId,
      bytes: upload.file.bytes,
      filename: upload.file.filename,
      visibility,
    });
    return json(200, { file: { id: file.id, name: file.name } });
  } catch (error) {
    if (error instanceof FileRejectedError) return json(error.status, { error: error.message });
    if (error instanceof StorageConfigError) return json(503, { error: STORAGE_NOT_SET_UP });
    if (error instanceof NotFoundError) return json(404, { error: "Not found." });
    throw error;
  }
}
