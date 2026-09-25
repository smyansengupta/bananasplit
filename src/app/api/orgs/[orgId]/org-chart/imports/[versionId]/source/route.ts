import { NotFoundError } from "@/lib/auth/errors";
import { can } from "@/lib/auth/permissions";
import { getSession } from "@/lib/auth/session";
import { withOrgTx } from "@/server/db/context";
import { getBlob } from "@/server/storage";

/**
 * GET /api/orgs/{orgId}/org-chart/imports/{versionId}/source (ADMIN+): the
 * original uploaded document, from the private store, as an attachment.
 * RLS re-checks the version (drafts and history are admin-only) before the
 * blob is read outside the transaction.
 */
export const dynamic = "force-dynamic";

const NOT_FOUND = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

function asciiFilename(name: string): string {
  return name.replace(/[^\w .()-]+/g, "_").slice(0, 120) || "document";
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgId: string; versionId: string }> },
) {
  const { orgId, versionId } = await params;
  if (!(await getSession())) return new Response("Unauthorized", { status: 401 });

  let found: { key: string; filename: string; mimeType: string } | null;
  try {
    found = await withOrgTx(orgId, async (ctx) => {
      if (!can(ctx, "orgchart.write")) return null;
      const version = await ctx.db.orgChartVersion.findFirst({
        where: { id: versionId, organizationId: orgId },
        select: { sourceBlobKey: true, sourceFilename: true, sourceMimeType: true },
      });
      if (!version?.sourceBlobKey) return null;
      return {
        key: version.sourceBlobKey,
        filename: version.sourceFilename ?? "document",
        mimeType: version.sourceMimeType ?? "application/octet-stream",
      };
    });
  } catch (error) {
    if (error instanceof NotFoundError) return NOT_FOUND();
    throw error;
  }
  if (!found) return NOT_FOUND();

  const blob = await getBlob(found.key);
  if (!blob) return NOT_FOUND();
  const filename = asciiFilename(found.filename);
  return new Response(new Uint8Array(blob.body), {
    headers: {
      "Content-Type": found.mimeType,
      "Content-Length": String(blob.body.length),
      "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(found.filename.slice(0, 200))}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
