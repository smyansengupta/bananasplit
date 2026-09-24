import { NextResponse } from "next/server";

import { NotFoundError } from "@/lib/auth/errors";
import { can } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import { csvContentDisposition } from "@/lib/csv";
import { parseDbViewParams } from "@/lib/databases/href";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { writeOrgAuditLog } from "@/server/audit";
import { listPolls, loadPollResults } from "@/server/databases/ballot-results";
import { csvLines, exportColumns, resultsCsv } from "@/server/databases/export";
import { sourceFor } from "@/server/databases/sources";
import {
  canViewBallotRows,
  getDatabase,
  queryFor,
  viewContextFor,
  viewerColumns,
  visibleColumnKeys,
  type SearchParams,
} from "@/server/databases/views";
import { withOrgTx, withUserTx } from "@/server/db/context";

/**
 * CSV export of a database view (Phase 4a): the same filters, search, date
 * range, sort and visible columns (cols=) as the page, read as the viewer
 * through RLS page by page (keyset, one short withOrgTx each), so the export
 * carries exactly the viewer's privacy tier: masked emails where the tier
 * may not see addresses, no ballot rows for tiers without row access (they
 * get the aggregate results instead). Formula-safe (src/lib/csv.ts),
 * audit-logged (database.exported) and rate-limited (30 per hour per user).
 */
/** UTF-8 byte-order mark, so Excel reads non-ASCII names correctly. */
const BOM = String.fromCharCode(0xfeff);

export const maxDuration = 60;
export const dynamic = "force-dynamic";

function toSearchParams(url: URL): SearchParams {
  const out: SearchParams = {};
  for (const key of new Set(url.searchParams.keys())) {
    const all = url.searchParams.getAll(key);
    out[key] = all.length > 1 ? all : all[0];
  }
  return out;
}

async function resolveOrg(slug: string) {
  const user = await requireUser();
  const rows = await withUserTx(user.id, ({ db }) =>
    db.$queryRaw<{ organizationId: string; canonicalSlug: string }[]>`
      SELECT "organizationId", "canonicalSlug" FROM app.resolve_org_slug(${slug})`,
  );
  return rows[0] ? { ...rows[0], userId: user.id } : null;
}

export async function GET(request: Request, ctx: RouteContext<"/app/[orgSlug]/databases/[dbKey]/export">) {
  const { orgSlug, dbKey } = await ctx.params;
  const url = new URL(request.url);
  const sp = toSearchParams(url);

  let resolved;
  try {
    resolved = await resolveOrg(orgSlug);
  } catch {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  if (!resolved) return new NextResponse("Not found", { status: 404 });
  const orgId = resolved.organizationId;

  const limit = await checkRateLimit(rateLimitKey("db-export", resolved.userId), 30, 3600);
  if (!limit.allowed) {
    return new NextResponse("Too many exports. Try again later.", {
      status: 429,
      headers: { "Retry-After": String(Math.ceil((limit.retryAfterMs ?? 60_000) / 1000)) },
    });
  }

  let setup;
  try {
    setup = await withOrgTx(orgId, async ({ db, role }) => {
      if (!can({ role }, "databases.export")) throw new NotFoundError();
      const org = await db.organization.findUniqueOrThrow({
        where: { id: orgId },
        select: { id: true, slug: true, timezone: true },
      });
      const database = await getDatabase(db, orgId, role, dbKey);
      const vctx = viewContextFor(org, role, database);
      let sourceView: string | undefined;
      if (database.kind === "BALLOTS") {
        const rowAccess = await canViewBallotRows(db, orgId, vctx.tier);
        const requested = typeof sp.view === "string" ? sp.view : "results";
        sourceView = rowAccess && (requested === "rows" || requested === "ballots") ? (requested === "ballots" ? "ballots" : "choices") : undefined;
      }
      await writeOrgAuditLog(db, {
        organizationId: orgId,
        action: "database.exported",
        targetType: "DatabaseDefinition",
        targetId: database.id,
        diff: {
          dbKey: database.key,
          view: sourceView ?? (database.kind === "BALLOTS" ? "results" : "rows"),
          filters: parseDbViewParams(sp).filters.map((f) => `${f.col}:${f.op}`),
          q: Boolean(sp.q),
          from: typeof sp.from === "string" ? sp.from : null,
          to: typeof sp.to === "string" ? sp.to : null,
        },
      });
      return { database, vctx, sourceView };
    });
  } catch (error) {
    if (error instanceof NotFoundError) return new NextResponse("Not found", { status: 404 });
    throw error;
  }

  const { database, vctx } = setup;
  const stamp = new Date().toISOString().slice(0, 10);
  const headers = {
    "Content-Type": "text/csv; charset=utf-8",
    "Cache-Control": "private, no-store",
  };

  // Ballots without row access (or the results view): the aggregate pivot only.
  if (database.kind === "BALLOTS" && !setup.sourceView) {
    const lines = await withOrgTx(orgId, async ({ db }) => {
      const polls = await listPolls(db, orgId);
      const params = parseDbViewParams(sp);
      const f = params.filters.find((x) => ["ballotDefinitionId", "poll", "pollSlug", "slug"].includes(x.col) && x.op === "eq");
      const chosen = f ? polls.filter((p) => p.id === f.value || p.slug === f.value) : polls.filter((p) => !p.isTest);
      const results = [];
      for (const poll of chosen) results.push(await loadPollResults(db, orgId, poll, vctx.tier));
      return resultsCsv(results);
    });
    return new NextResponse(`${BOM}${lines.join("\r\n")}\r\n`, {
      headers: { ...headers, "Content-Disposition": csvContentDisposition(`${database.key}-results-${stamp}.csv`) },
    });
  }

  const source = sourceFor(database.kind, setup.sourceView);
  if (!source) return new NextResponse("Not found", { status: 404 });
  const columns = viewerColumns(source, database.columns, vctx.tier);
  const visible = visibleColumnKeys(columns, sp);
  const cols = exportColumns(columns, visible);
  const { built, where } = queryFor(source, vctx, sp);
  const encoder = new TextEncoder();
  const lines = csvLines(source, cols, vctx, { where, orderBy: built.orderBy }, (fn) =>
    withOrgTx(orgId, ({ db }) => fn(db)),
  );

  // The producer starts here, inside the request's async context (each page
  // opens its own withOrgTx as the viewer), and writes into the response
  // stream with backpressure.
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  void (async () => {
    try {
      await writer.write(encoder.encode(BOM));
      for await (const line of lines) {
        await writer.ready;
        await writer.write(encoder.encode(`${line}

`));
      }
      await writer.close();
    } catch (error) {
      console.error("[databases] export failed", error instanceof Error ? error.message : error);
      await writer.abort(error).catch(() => undefined);
    }
  })();
  return new NextResponse(readable, {
    headers: { ...headers, "Content-Disposition": csvContentDisposition(`${database.key}-${stamp}.csv`) },
  });
}
