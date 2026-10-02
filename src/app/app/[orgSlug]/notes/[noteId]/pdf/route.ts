import { NextResponse } from "next/server";

import { NotFoundError } from "@/lib/auth/errors";
import { getSession } from "@/lib/auth/session";
import { contentDisposition } from "@/lib/http/content-disposition";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { withOrgTx, withUserTx } from "@/server/db/context";
import { notePdfFilename, renderNotePdf } from "@/server/notes/pdf";

import { getNoteById } from "../../queries";

/**
 * GET /app/{orgSlug}/notes/{noteId}/pdf: the note as a PDF download, for
 * anyone who can read it. The note is read in a withOrgTx transaction as the
 * caller, so RLS applies the same visibility as the page (another author's
 * PRIVATE note is simply not found); the PDF is rendered after the
 * transaction closes so the CPU work never holds a pooled connection.
 * 401 without a session, 404 for an unknown org, a non-member or a note the
 * caller can't see, 429 past 30 downloads in 10 minutes.
 */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/app/[orgSlug]/notes/[noteId]/pdf">,
) {
  const { orgSlug, noteId } = await ctx.params;
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const orgId = await withUserTx(session.user.id, async ({ db }) => {
    const rows = await db.$queryRaw<{ organizationId: string }[]>`
      SELECT "organizationId" FROM app.resolve_org_slug(${orgSlug})`;
    return rows[0]?.organizationId ?? null;
  });
  if (!orgId) return new NextResponse("Not found", { status: 404 });

  const limit = await checkRateLimit(rateLimitKey("note-pdf", session.user.id), 30, 600);
  if (!limit.allowed) {
    return new NextResponse("Too many downloads. Try again in a few minutes.", {
      status: 429,
      headers: { "Retry-After": String(Math.ceil((limit.retryAfterMs ?? 60_000) / 1000)) },
    });
  }

  let found;
  try {
    found = await withOrgTx(orgId, async ({ db, userId }) => {
      const note = await getNoteById(db, orgId, userId, noteId);
      if (!note) return null;
      const org = await db.organization.findUniqueOrThrow({
        where: { id: orgId },
        select: { name: true, timezone: true },
      });
      return { note, org };
    });
  } catch (error) {
    if (error instanceof NotFoundError) return new NextResponse("Not found", { status: 404 });
    throw error;
  }
  if (!found) return new NextResponse("Not found", { status: 404 });
  const { note, org } = found;

  const pdf = await renderNotePdf({
    title: note.title,
    contentJson: note.contentJson,
    // The name only: a PDF travels outside the org, and member emails stay inside it.
    authorName: note.author.name ?? "Unknown author",
    orgName: org.name,
    timezone: org.timezone,
    updatedAt: note.updatedAt,
    visibility: note.visibility,
    event: note.event,
  });

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": contentDisposition("attachment", notePdfFilename(note.title)),
      "Cache-Control": "private, no-store",
    },
  });
}
