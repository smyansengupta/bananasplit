import { createHash } from "node:crypto";

import { OrgExportStatus } from "@/generated/prisma/enums";
import { NotFoundError } from "@/lib/auth/errors";
import { can } from "@/lib/auth/permissions";
import { getSession } from "@/lib/auth/session";
import { writeOrgAuditLog } from "@/server/audit";
import { withOrgTx, withSystemOrgTx } from "@/server/db/context";
import { verifyExportDownload } from "@/server/export/signing";
import { getBlob } from "@/server/storage";

/**
 * GET /api/orgs/{orgId}/exports/{exportId}/download?exp=..&sig=..
 *
 * The signature alone is not enough. All of these are required:
 *   - a session;
 *   - a signature minted for THIS user by the landing page, unexpired (24h);
 *   - OWNER in the org at download time (checked in the database);
 *   - an export that is READY and not past its expiresAt.
 * The zip is streamed from the private store with Cache-Control: no-store
 * (never a public blob URL). Every download is audited (actor, export,
 * user-agent hash) and counted.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function deny(status: number, message: string): Response {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgId: string; exportId: string }> },
) {
  const { orgId, exportId } = await params;
  const session = await getSession();
  if (!session) return deny(401, "Sign in to download this export.");

  const url = new URL(request.url);
  const exp = Number(url.searchParams.get("exp"));
  const sig = url.searchParams.get("sig") ?? "";
  if (!verifyExportDownload(exportId, session.user.id, exp, sig)) {
    return deny(403, "This download link is invalid or has expired. Open the export page again.");
  }

  let blobKey: string;
  let filename: string;
  try {
    const found = await withOrgTx(orgId, async ({ db, role }) => {
      if (!can({ role }, "org.export.download")) return null;
      const row = await db.orgExport.findFirst({
        where: { id: exportId, organizationId: orgId },
        select: { status: true, blobKey: true, expiresAt: true, createdAt: true },
      });
      const org = await db.organization.findUnique({
        where: { id: orgId },
        select: { slug: true },
      });
      return row && org ? { row, slug: org.slug } : undefined;
    });
    if (found === null) return deny(403, "Only an owner can download the organization's data.");
    if (!found) return deny(404, "Not found.");
    const { row } = found;
    if (row.status !== OrgExportStatus.READY || !row.blobKey) {
      return deny(410, "This export is not available.");
    }
    if (row.expiresAt && row.expiresAt.getTime() <= Date.now())
      return deny(410, "This export has expired.");
    blobKey = row.blobKey;
    filename = `${found.slug}-export-${row.createdAt.toISOString().slice(0, 10)}.zip`;
  } catch (error) {
    if (error instanceof NotFoundError) return deny(404, "Not found.");
    throw error;
  }

  const blob = await getBlob(blobKey);
  if (!blob) return deny(410, "This export is not available.");

  const ua = request.headers.get("user-agent") ?? "";
  await withSystemOrgTx(orgId, { userId: session.user.id }, async ({ db }) => {
    await db.orgExport.update({
      where: { id: exportId },
      data: { downloadCount: { increment: 1 }, lastDownloadedAt: new Date() },
    });
    await writeOrgAuditLog(db, {
      organizationId: orgId,
      action: "export.downloaded",
      targetType: "OrgExport",
      targetId: exportId,
      diff: { userAgentHash: createHash("sha256").update(ua).digest("hex").slice(0, 16) },
    });
  });

  return new Response(new Uint8Array(blob.body), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(blob.body.length),
      "Content-Disposition": `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
