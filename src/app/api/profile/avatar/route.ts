import { getSession } from "@/lib/auth/session";
import { checkRateLimit, rateLimitKey, retryAfterText } from "@/lib/rate-limit";
import { ImageRejectedError, sniffImageType } from "@/server/images";
import { removeOwnAvatar, replaceOwnAvatar } from "@/server/profiles/service";
import { MAX_UPLOAD_BYTES, STORAGE_NOT_SET_UP, StorageConfigError } from "@/server/storage";
import { readUpload, UploadError } from "@/server/storage/upload";
import { isCrossSite } from "@/lib/http/cross-site";

/**
 * /api/profile/avatar: the signed-in user's profile picture (Phase 2).
 *
 * POST (multipart, field `file`): the crop dialog sends a square 512px JPEG
 * or WebP, but any JPEG, PNG or WebP up to 4 MB is accepted. Order of work
 * ('File storage and images' decision):
 *   1. same-site and signed-in checks;
 *   2. a Content-Length above 4 MB is refused with 413 BEFORE the body is
 *      read (readUpload also counts bytes for bodies without a length);
 *   3. 10 uploads per hour per user;
 *   4. magic-byte sniffing (the declared type is never trusted), then sharp
 *      re-encodes to 64/128/256 WebP variants with no metadata, written to
 *      the public store under avatars/{userId}/{random}/ outside any
 *      transaction;
 *   5. User.avatar is updated, and the previous variants are deleted only
 *      after that commit (a failed row write deletes the new files).
 *
 * DELETE: removes the picture (the OAuth image or initials show instead).
 *
 * Responses are JSON and never cached.
 */
export const maxDuration = 60;

const AVATAR_UPLOADS_PER_HOUR = 10;
/** Room for the multipart boundary and headers around the file. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

const TOO_LARGE = "Profile pictures are limited to 4 MB. Try a smaller photo.";

function json(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  if (isCrossSite(request)) return json(403, { error: "Forbidden." });

  const session = await getSession();
  if (!session) return json(401, { error: "Sign in to change your picture." });

  const declared = Number(request.headers.get("content-length") ?? "NaN");
  if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES) {
    return json(413, { error: TOO_LARGE });
  }

  const limit = await checkRateLimit(
    rateLimitKey("avatar-upload", session.user.id),
    AVATAR_UPLOADS_PER_HOUR,
    60 * 60,
  );
  if (!limit.allowed) {
    return json(429, { error: `Too many picture uploads. Try again ${retryAfterText(limit)}.` });
  }

  let bytes: Buffer;
  try {
    const upload = await readUpload(request, { maxBytes: MAX_UPLOAD_BYTES });
    bytes = upload.file.bytes;
  } catch (error) {
    if (error instanceof UploadError) {
      return json(error.status, { error: error.status === 413 ? TOO_LARGE : error.message });
    }
    throw error;
  }

  if (!sniffImageType(bytes)) {
    return json(415, { error: "Upload a JPEG, PNG or WebP image." });
  }

  try {
    const avatar = await replaceOwnAvatar(session.user.id, bytes);
    return json(200, { avatar });
  } catch (error) {
    if (error instanceof ImageRejectedError) {
      return json(error.reason === "type" ? 415 : 422, { error: error.message });
    }
    if (error instanceof StorageConfigError) {
      console.error("[avatar] storage not configured:", error.message);
      return json(503, { error: STORAGE_NOT_SET_UP });
    }
    console.error("[avatar] upload failed", error instanceof Error ? error.message : error);
    return json(500, { error: "Couldn't save your picture. Try again." });
  }
}

export async function DELETE(request: Request): Promise<Response> {
  if (isCrossSite(request)) return json(403, { error: "Forbidden." });

  const session = await getSession();
  if (!session) return json(401, { error: "Sign in to change your picture." });

  try {
    await removeOwnAvatar(session.user.id);
  } catch (error) {
    console.error("[avatar] remove failed", error instanceof Error ? error.message : error);
    return json(500, { error: "Couldn't remove your picture. Try again." });
  }
  return json(200, { avatar: null });
}
