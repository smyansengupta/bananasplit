import { Prisma } from "@/generated/prisma/client";
import { NotFoundError } from "@/lib/auth/errors";
import { can } from "@/lib/auth/permissions";
import { getSession } from "@/lib/auth/session";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { writeOrgAuditLog } from "@/server/audit";
import { tags } from "@/server/cache/tags";
import { invalidate } from "@/server/cache/invalidate";
import { withOrgTx, type OrgContext } from "@/server/db/context";
import {
  deleteStoredImage,
  ImageRejectedError,
  storeImage,
  type StoredImage,
} from "@/server/images";
import { STORAGE_NOT_SET_UP, StorageConfigError } from "@/server/storage";
import { readUpload, uploadErrorResponse } from "@/server/storage/upload";
import { isCrossSite } from "@/lib/http/cross-site";

/**
 * POST /api/orgs/{orgId}/logo   multipart `file` (JPEG, PNG or WebP, 4 MB)
 * DELETE /api/orgs/{orgId}/logo
 *
 * OWNER/ADMIN (org.logo.write). The upload is capped before the body is read
 * (413), sniffed by magic bytes (never SVG), re-encoded by sharp into WebP
 * variants (64/256/512, EXIF stripped) in the public store, and only then
 * written to Organization.logo. The replaced variants are deleted after the
 * row commits; a failed row write deletes the new ones.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UPLOAD_LIMIT = { limit: 20, windowSec: 60 * 60 };

function json(status: number, body: Record<string, unknown>) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** Route handlers get no built-in CSRF check (Server Actions do). */
type Guard = { ok: true; userId: string } | { ok: false; response: Response };

async function guard(request: Request, orgId: string): Promise<Guard> {
  if (isCrossSite(request)) return { ok: false, response: json(403, { error: "Forbidden." }) };
  const session = await getSession();
  if (!session) return { ok: false, response: json(401, { error: "Sign in first." }) };
  try {
    const role = await withOrgTx(orgId, async (ctx) => ctx.role);
    if (!can({ role }, "org.logo.write")) {
      return {
        ok: false,
        response: json(403, { error: "Only owners and admins can change the logo." }),
      };
    }
  } catch (error) {
    // A non-member cannot learn whether the org exists.
    if (error instanceof NotFoundError)
      return { ok: false, response: json(404, { error: "Not found." }) };
    throw error;
  }
  return { ok: true, userId: session.user.id };
}

async function writeLogo(ctx: OrgContext, logo: StoredImage | null): Promise<unknown> {
  const before = await ctx.db.organization.findUniqueOrThrow({
    where: { id: ctx.organizationId },
    select: { logo: true },
  });
  await ctx.db.organization.update({
    where: { id: ctx.organizationId },
    data: { logo: logo === null ? Prisma.DbNull : (logo as unknown as Prisma.InputJsonObject) },
  });
  await writeOrgAuditLog(ctx.db, {
    organizationId: ctx.organizationId,
    action: logo ? "org.logo_changed" : "org.logo_removed",
    targetType: "Organization",
    targetId: ctx.organizationId,
  });
  invalidate([tags.theme(ctx.organizationId)]);
  return before.logo;
}

export async function POST(request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const g = await guard(request, orgId);
  if (!g.ok) return g.response;

  const limited = await checkRateLimit(
    rateLimitKey("logo-upload", orgId),
    UPLOAD_LIMIT.limit,
    UPLOAD_LIMIT.windowSec,
  );
  if (!limited.allowed) return json(429, { error: "Too many uploads recently. Try again later." });

  const upload = await readUpload(request).catch(uploadErrorResponse);
  if (upload instanceof Response) return upload;

  let stored: StoredImage;
  try {
    stored = await storeImage("logos", orgId, "logo", upload.file.bytes);
  } catch (error) {
    if (error instanceof ImageRejectedError) return json(415, { error: error.message });
    if (error instanceof StorageConfigError) {
      console.error("[logo] storage not configured:", error.message);
      return json(503, { error: STORAGE_NOT_SET_UP });
    }
    throw error;
  }

  let previous: unknown;
  try {
    previous = await withOrgTx(orgId, (ctx) => writeLogo(ctx, stored));
  } catch (error) {
    await deleteStoredImage(stored).catch(() => undefined);
    throw error;
  }
  await deleteStoredImage(previous).catch((e) =>
    console.warn("[logo] old variants not deleted", e),
  );
  return json(200, { logo: { s64: stored.s64, s256: stored.s256, s512: stored.s512 } });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const g = await guard(request, orgId);
  if (!g.ok) return g.response;
  const previous = await withOrgTx(orgId, (ctx) => writeLogo(ctx, null));
  await deleteStoredImage(previous).catch((e) =>
    console.warn("[logo] old variants not deleted", e),
  );
  return json(200, { logo: null });
}
