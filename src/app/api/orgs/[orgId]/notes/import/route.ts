import { NotFoundError } from "@/lib/auth/errors";
import { getSession } from "@/lib/auth/session";
import { isCrossSite } from "@/lib/http/cross-site";
import { checkRateLimit, rateLimitKey, retryAfterText } from "@/lib/rate-limit";
import { withOrgTx } from "@/server/db/context";
import {
  docxToHtml,
  fetchGoogleDocAsDocx,
  FileRejectedError,
  titleFromFilename,
} from "@/server/notes/files";
import { readUpload, uploadErrorResponse } from "@/server/storage/upload";

/**
 * POST /api/orgs/{orgId}/notes/import: a Word document (multipart `file`)
 * or a Google Doc (JSON `{ "googleUrl": "..." }`) as HTML and a title. The
 * browser turns the HTML into the note (importNote), so only what the note
 * schema allows is kept. Members only; nothing is stored by this route.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function json(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  if (isCrossSite(request)) return json(403, { error: "Forbidden." });
  const session = await getSession();
  if (!session) return json(401, { error: "Sign in first." });
  const { orgId } = await params;
  try {
    // Membership: withOrgTx refuses anyone who isn't in the org.
    await withOrgTx(orgId, async () => undefined);
  } catch (error) {
    if (error instanceof NotFoundError) return json(404, { error: "Not found." });
    throw error;
  }
  const limit = await checkRateLimit(rateLimitKey("note-import", session.user.id), 30, 60 * 60);
  if (!limit.allowed) return json(429, { error: `Too many imports. Try again ${retryAfterText(limit)}.` });

  try {
    if ((request.headers.get("content-type") ?? "").includes("application/json")) {
      const body = (await request.json().catch(() => null)) as { googleUrl?: unknown } | null;
      if (typeof body?.googleUrl !== "string") return json(400, { error: "Paste a Google Docs link." });
      const doc = await fetchGoogleDocAsDocx(body.googleUrl);
      return json(200, { title: doc.title ?? "Imported Google Doc", html: await docxToHtml(doc.bytes) });
    }
    const upload = await readUpload(request).catch(uploadErrorResponse);
    if (upload instanceof Response) return upload;
    return json(200, {
      title: titleFromFilename(upload.file.filename) || "Imported document",
      html: await docxToHtml(upload.file.bytes),
    });
  } catch (error) {
    if (error instanceof FileRejectedError) return json(error.status, { error: error.message });
    if (error instanceof Error && error.name === "TimeoutError") {
      return json(504, { error: "Google took too long to answer. Try again." });
    }
    throw error;
  }
}
