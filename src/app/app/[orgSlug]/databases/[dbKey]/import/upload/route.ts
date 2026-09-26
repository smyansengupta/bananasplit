import { NextResponse } from "next/server";

import { ForbiddenError, NotFoundError } from "@/lib/auth/errors";
import { requireUser } from "@/lib/auth/session";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { assertCanEdit } from "@/server/databases/admin";
import {
  commitAttendance,
  commitSignups,
  previewAttendance,
  previewSignups,
} from "@/server/databases/csv-import";
import { fmtDateTime } from "@/server/databases/format";
import { getDatabase } from "@/server/databases/views";
import { withOrgTx, withUserTx } from "@/server/db/context";
import { AppError, ConflictError } from "@/server/db/errors";
import { readUpload, UploadError } from "@/server/storage/upload";

/**
 * CSV import (Attendance, Signups) for OWNER/ADMIN: POST multipart with the
 * file and mode=preview|commit. The body is capped at 4MB before it is read
 * (Content-Length precheck in readUpload), parsed in memory and never
 * stored. preview returns the first rows and every problem; commit writes
 * all valid rows in one transaction (at most 5000), refreshes the rollups
 * and writes the audit row. Rate-limited to 20 per hour per user.
 */
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const MAX_BYTES = 4 * 1024 * 1024;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, ctx: RouteContext<"/app/[orgSlug]/databases/[dbKey]/import/upload">) {
  const { orgSlug, dbKey } = await ctx.params;
  let user;
  try {
    user = await requireUser();
  } catch {
    return json({ error: "Sign in again." }, 401);
  }
  const resolved = await withUserTx(user.id, ({ db }) =>
    db.$queryRaw<{ organizationId: string }[]>`SELECT "organizationId" FROM app.resolve_org_slug(${orgSlug})`,
  );
  const orgId = resolved[0]?.organizationId;
  if (!orgId) return json({ error: "Not found" }, 404);

  const limit = await checkRateLimit(rateLimitKey("db-import", user.id), 20, 3600);
  if (!limit.allowed) return json({ error: "Too many imports. Try again later." }, 429);

  let upload;
  try {
    upload = await readUpload(request, { maxBytes: MAX_BYTES });
  } catch (error) {
    if (error instanceof UploadError) return json({ error: error.message }, error.status);
    throw error;
  }
  const text = upload.file.bytes.toString("utf8");
  const mode = upload.fields.mode === "commit" ? "commit" : "preview";

  try {
    const result = await withOrgTx(orgId, async (octx) => {
      const database = await getDatabase(octx.db, orgId, octx.role, dbKey);
      if (database.kind !== "ATTENDANCE" && database.kind !== "SIGNUPS") throw new NotFoundError();
      await assertCanEdit(octx, database.kind);
      const org = await octx.db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { timezone: true } });
      const tz = org.timezone || "UTC";

      if (database.kind === "ATTENDANCE") {
        const preview = await previewAttendance(octx.db, orgId, tz, text);
        if (mode === "commit" && preview.rows.length > 0) {
          const done = await commitAttendance(octx.db, orgId, tz, octx.userId, preview);
          return { committed: done, issues: preview.issues, total: preview.total };
        }
        return {
          total: preview.total,
          valid: preview.rows.length,
          issues: preview.issues.slice(0, 200),
          sample: preview.rows.slice(0, 20).map((r) => ({
            line: r.line,
            session: r.eventLabel,
            person: r.name ?? r.email ?? "",
            email: r.email ?? "",
            time: r.checkedInAt ? fmtDateTime(r.checkedInAt, tz) : "Session start",
            method: r.method,
          })),
        };
      }
      const preview = previewSignups(tz, text);
      if (mode === "commit" && preview.rows.length > 0) {
        const done = await commitSignups(octx.db, orgId, tz, preview);
        return { committed: done, issues: preview.issues, total: preview.total };
      }
      return {
        total: preview.total,
        valid: preview.rows.length,
        issues: preview.issues.slice(0, 200),
        sample: preview.rows.slice(0, 20).map((r) => ({
          line: r.line,
          person: r.name,
          email: r.email ?? "",
          term: r.term,
          time: fmtDateTime(r.signedUpAt, tz),
          year: r.classYear ?? "",
        })),
      };
    });
    return json(result);
  } catch (error) {
    if (error instanceof NotFoundError) return json({ error: "Not found" }, 404);
    if (error instanceof ForbiddenError) return json({ error: error.message }, 403);
    if (error instanceof ConflictError) {
      return json(
        { error: "Some addresses are already on file but hidden from your role (Settings > Privacy). Ask an owner to import." },
        409,
      );
    }
    if (error instanceof AppError) return json({ error: error.message }, error.status);
    if (error instanceof Error && error.name === "DatabaseEditError") return json({ error: error.message }, 400);
    console.error("[databases] import failed", error instanceof Error ? error.message : error);
    return json({ error: "The import failed. Nothing was saved." }, 500);
  }
}
