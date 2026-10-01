import { NotFoundError } from "@/lib/auth/errors";
import { getSession } from "@/lib/auth/session";
import { familyOf } from "@/lib/files/types";
import { contentDisposition } from "@/lib/http/content-disposition";
import { readNoteFile } from "@/server/notes/files";

/**
 * GET /api/orgs/{orgId}/files/{fileId}: a Notes page file, to someone RLS
 * lets see its row right now (a member of the org; a private file only to
 * its uploader). Inline by default, so the preview page can show a PDF in a
 * same-origin frame or an image in an <img>; ?download=1 saves it instead.
 *
 * The response is never a document of this origin: PDFs render in the
 * browser's own viewer (framable only by this origin), everything else is
 * sandboxed, and the type is the sniffed one with nosniff.
 */
export const dynamic = "force-dynamic";

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgId: string; fileId: string }> },
) {
  const session = await getSession();
  if (!session) return new Response("Forbidden", { status: 403 });
  const { orgId, fileId } = await params;

  let found;
  try {
    found = await readNoteFile(orgId, fileId);
  } catch (error) {
    if (error instanceof NotFoundError) return notFound();
    throw error;
  }
  if (!found) return notFound();

  const download = new URL(request.url).searchParams.get("download") === "1";
  const pdf = familyOf(found.row.contentType) === "pdf";
  return new Response(new Uint8Array(found.body), {
    headers: {
      "Content-Type": found.row.contentType,
      "Content-Length": String(found.body.length),
      "Content-Disposition": contentDisposition(download ? "attachment" : "inline", found.row.name),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
      "X-Frame-Options": "SAMEORIGIN",
      "Content-Security-Policy": pdf
        ? "default-src 'none'; frame-ancestors 'self'"
        : "default-src 'none'; frame-ancestors 'self'; sandbox",
    },
  });
}
