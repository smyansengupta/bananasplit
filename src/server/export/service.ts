import { strToU8, zipSync, type Zippable } from "fflate";

import { NotificationType, OrgExportStatus, Prisma } from "@/generated/prisma/client";
import { requirePermission } from "@/lib/auth/permissions";
import { toCsv } from "@/lib/csv";
import { checkRateLimit, rateLimitKey, retryAfterText } from "@/lib/rate-limit";
import { writeOrgAuditLog } from "@/server/audit";
import { withSystemOrgTx, type OrgContext, type TxClient } from "@/server/db/context";
import { enqueueJob } from "@/server/jobs/enqueue";
import { PermanentJobError, type JobHandler, type JobOutcome } from "@/server/jobs/types";
import { notifyUser } from "@/server/notifications";
import {
  deleteBlobs,
  getBlob,
  listBlobs,
  putBlob,
  scopePrefix,
  storageKey,
} from "@/server/storage";

import {
  EXPORT_EXCLUDED,
  EXPORT_TABLES,
  delegateName,
  keysetAfter,
  keysetOrder,
  type ExportTable,
} from "./registry";

/**
 * Org export (Settings > Danger zone), OWNER-only, at most one per day.
 *
 * requestOrgExport: an OrgExport row (PENDING) and an org-export job, in the
 * OWNER's transaction.
 *
 * orgExportJob (heavy kind; lease and maxRuntime in the job registry), under
 * the job-runner contract: every database read is a short service
 * transaction (keyset pages of 1000 rows), every Blob call happens with no
 * transaction open, and the status moves by compare-and-set:
 *   PENDING -> RUNNING: claim.
 *   per table: data/{Model}.ndjson and .csv are written as part blobs under
 *     exports/{orgId}/{exportId}/, and OrgExport.cursor records the finished
 *     tables, so a lost lease or a timeout resumes where it stopped;
 *   zip: the parts (plus the org's receipts and org-chart source files, up to
 *     FILES_CAP bytes) are zipped with fflate into
 *     exports/{orgId}/{exportId}.zip in the PRIVATE store;
 *   RUNNING -> READY with expiresAt, then an export-expire job at expiresAt
 *     and a notification to the requester linking to the signed-in landing
 *     page (never to the file).
 * CSV cells are formula-guarded (src/lib/csv.ts). Ciphertext, secret hashes
 * and storage keys are never exported (registry.ts). Individual ballots are
 * left out when ballotIndividualVisibility is NOBODY.
 */

export const EXPORT_EXPIRY_DAYS = 7;
const PAGE_SIZE = 1000;
/** Uploaded files included in the zip (receipts, org-chart sources). */
const FILES_CAP = 50 * 1024 * 1024;
/** Stop starting new tables this close to the job's deadline (resume on retry). */
const DEADLINE_MARGIN_MS = 45_000;

export type RequestExportResult = { ok: true; exportId: string } | { ok: false; error: string };

export async function requestOrgExport(ctx: OrgContext): Promise<RequestExportResult> {
  requirePermission(ctx, "org.export");
  const limited = await checkRateLimit(
    rateLimitKey("org-export", ctx.organizationId),
    1,
    24 * 60 * 60,
  );
  if (!limited.allowed) {
    return {
      ok: false,
      error: `An export was already requested today. Try again ${retryAfterText(limited)}.`,
    };
  }
  const row = await ctx.db.orgExport.create({
    data: { organizationId: ctx.organizationId, requestedById: ctx.userId },
    select: { id: true },
  });
  await enqueueJob(ctx.db, {
    orgId: ctx.organizationId,
    kind: "org-export",
    key: row.id,
    payload: { exportId: row.id },
  });
  await writeOrgAuditLog(ctx.db, {
    organizationId: ctx.organizationId,
    action: "export.requested",
    targetType: "OrgExport",
    targetId: row.id,
  });
  return { ok: true, exportId: row.id };
}

interface Cursor {
  done: string[];
}

function parseCursor(value: unknown): Cursor {
  const done = (value as { done?: unknown } | null)?.done;
  return {
    done: Array.isArray(done) ? done.filter((d): d is string => typeof d === "string") : [],
  };
}

function partKey(orgId: string, exportId: string, file: string): string {
  return storageKey("exports", orgId, exportId, file);
}

type Row = Record<string, unknown>;

function serialize(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return undefined;
  if (Prisma.Decimal.isDecimal(value)) return value.toString();
  return value;
}

function cleanRow(row: Row, omit: readonly string[] = []): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (omit.includes(k)) continue;
    const s = serialize(v);
    if (s !== undefined) out[k] = s;
  }
  return out;
}

type Delegate = {
  findMany(args: Record<string, unknown>): Promise<Row[]>;
};

/** One keyset page of `table` for the org, on the service path. */
export async function readPage(
  orgId: string,
  table: ExportTable,
  last: Row | null,
): Promise<Row[]> {
  return withSystemOrgTx(orgId, async ({ db }) => {
    const delegate = (db as unknown as Record<string, Delegate>)[delegateName(table.model)];
    if (!delegate) throw new PermanentJobError(`export: no delegate for ${table.model}`);
    return delegate.findMany({
      where: { organizationId: orgId, ...keysetAfter(table.key, last) },
      orderBy: keysetOrder(table.key),
      take: PAGE_SIZE,
    });
  });
}

/** Reads every row of `table` and renders its NDJSON and CSV. */
export async function renderTable(
  orgId: string,
  table: ExportTable,
): Promise<{ ndjson: string; csv: string; rows: number }> {
  const rows: Row[] = [];
  let last: Row | null = null;
  for (;;) {
    const page = await readPage(orgId, table, last);
    for (const r of page) rows.push(cleanRow(r, table.omit));
    if (page.length < PAGE_SIZE) break;
    last = page[page.length - 1];
  }
  const header = rows.length ? Object.keys(rows[0]) : [];
  const ndjson = rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : "");
  const csv = toCsv(
    rows.map((r) => header.map((h) => r[h])),
    { header, bom: true },
  );
  return { ndjson, csv, rows: rows.length };
}

async function setCursor(orgId: string, exportId: string, cursor: Cursor): Promise<boolean> {
  const { count } = await withSystemOrgTx(orgId, ({ db }) =>
    db.orgExport.updateMany({
      where: { id: exportId, organizationId: orgId, status: OrgExportStatus.RUNNING },
      data: { cursor: cursor as unknown as Prisma.InputJsonObject },
    }),
  );
  return count === 1;
}

async function markFailed(
  orgId: string,
  exportId: string,
  reason: string,
  requestedById: string | null,
) {
  await withSystemOrgTx(orgId, async ({ db }) => {
    const { count } = await db.orgExport.updateMany({
      where: { id: exportId, status: { in: [OrgExportStatus.PENDING, OrgExportStatus.RUNNING] } },
      data: {
        status: OrgExportStatus.FAILED,
        error: reason.slice(0, 300),
        completedAt: new Date(),
      },
    });
    if (count && requestedById) await notifyRequester(db, orgId, exportId, requestedById, false);
  });
}

async function notifyRequester(
  db: TxClient,
  orgId: string,
  exportId: string,
  userId: string,
  ready: boolean,
) {
  const member = await db.membership.findUnique({
    where: { userId_organizationId: { userId, organizationId: orgId } },
    select: { organization: { select: { slug: true, name: true } } },
  });
  if (!member) return;
  const org = member.organization;
  await notifyUser(db, orgId, userId, {
    type: NotificationType.SECURITY_ALERT,
    title: ready
      ? `Your data export of ${org.name} is ready`
      : `Your data export of ${org.name} failed`,
    body: ready
      ? `Sign in as an owner to download it. The file is deleted after ${EXPORT_EXPIRY_DAYS} days.`
      : "Try again from Settings > Danger zone.",
    linkUrl: `/app/${org.slug}/settings/danger/exports/${exportId}`,
  });
}

async function collectFiles(orgId: string): Promise<{ files: Zippable; skipped: string[] }> {
  const files: Zippable = {};
  const skipped: string[] = [];
  let total = 0;
  for (const kind of ["receipts", "org-chart"] as const) {
    const keys = await listBlobs(kind, scopePrefix(kind, orgId));
    for (const key of keys) {
      if (total >= FILES_CAP) {
        skipped.push(key);
        continue;
      }
      const blob = await getBlob(key);
      if (!blob) continue;
      if (total + blob.body.length > FILES_CAP) {
        skipped.push(key);
        continue;
      }
      total += blob.body.length;
      // receipts/{orgId}/{rest} -> files/receipts/{rest}
      files[`files/${kind}/${key.split("/").slice(2).join("/")}`] = new Uint8Array(blob.body);
    }
  }
  return { files, skipped };
}

function countLines(body: Buffer): number {
  let n = 0;
  for (const byte of body) if (byte === 10) n++;
  return n;
}

const README = `This archive holds every record of your organization in CBC Portal.

data/{Table}.ndjson  one JSON object per line (the exact values)
data/{Table}.csv     the same rows for spreadsheets; cells that start with
                     = + - @ are prefixed with ' so they are not run as formulas
files/               uploaded receipts and org chart documents
manifest.json        what is included, row counts and what was left out

Integration secrets (API keys, tokens, passwords) are never exported.
`;

/** The org-export job handler. */
export const orgExportJob: JobHandler<{ exportId: string }> = async (
  run,
): Promise<JobOutcome | void> => {
  const orgId = run.organizationId;
  if (!orgId) throw new PermanentJobError("org-export without an organizationId");
  const exportId = run.payload.exportId;

  // Claim: PENDING/RUNNING -> RUNNING (a resumed run keeps its cursor).
  const claimed = await withSystemOrgTx(orgId, async ({ db }) => {
    const row = await db.orgExport.findFirst({
      where: { id: exportId, organizationId: orgId },
      select: { status: true, cursor: true, requestedById: true },
    });
    if (!row) return null;
    if (row.status !== OrgExportStatus.PENDING && row.status !== OrgExportStatus.RUNNING)
      return null;
    await db.orgExport.updateMany({
      where: { id: exportId, status: { in: [OrgExportStatus.PENDING, OrgExportStatus.RUNNING] } },
      data: { status: OrgExportStatus.RUNNING, error: null },
    });
    const settings = await db.orgSettings.findUnique({
      where: { organizationId: orgId },
      select: { ballotIndividualVisibility: true },
    });
    const org = await db.organization.findUniqueOrThrow({
      where: { id: orgId },
      select: { id: true, name: true, slug: true, timezone: true, createdAt: true },
    });
    return { cursor: parseCursor(row.cursor), requestedById: row.requestedById, settings, org };
  });
  if (!claimed) return; // gone, finished or failed: nothing to do

  try {
    const cursor = claimed.cursor;
    // Read with an explicit OWNER tier: individual ballots only when an OWNER may see them.
    const ballotRowsAllowed = claimed.settings?.ballotIndividualVisibility !== "NOBODY";
    const tables = EXPORT_TABLES.filter((t) => !t.ballotRows || ballotRowsAllowed);

    for (const table of tables) {
      if (cursor.done.includes(table.model)) continue;
      if (Date.now() > run.deadline - DEADLINE_MARGIN_MS) {
        return {
          status: "RETRY",
          error: `resuming after ${cursor.done.length} of ${tables.length} tables`,
        };
      }
      const { ndjson, csv, rows } = await renderTable(orgId, table);
      const nd = partKey(orgId, exportId, `${table.model}.ndjson`);
      const cs = partKey(orgId, exportId, `${table.model}.csv`);
      // A crash between the put and the cursor update left parts behind.
      await deleteBlobs([nd, cs]);
      await putBlob("exports", orgId, [exportId, `${table.model}.ndjson`], Buffer.from(ndjson), {
        contentType: "application/x-ndjson",
      });
      await putBlob("exports", orgId, [exportId, `${table.model}.csv`], Buffer.from(csv), {
        contentType: "text/csv",
      });
      cursor.done.push(table.model);
      if (rows > 0) console.info(`[export] ${exportId}: ${table.model} ${rows} row(s)`);
      if (!(await setCursor(orgId, exportId, cursor))) return; // lost the export (failed/expired elsewhere)
    }

    // Zip the parts, the files and the manifest.
    const zip: Zippable = { "README.txt": strToU8(README) };
    const counts: Record<string, number> = {};
    for (const table of tables) {
      for (const ext of ["ndjson", "csv"] as const) {
        const blob = await getBlob(partKey(orgId, exportId, `${table.model}.${ext}`));
        if (!blob) throw new Error(`export part ${table.model}.${ext} is missing`);
        zip[`data/${table.model}.${ext}`] = new Uint8Array(blob.body);
        if (ext === "ndjson") counts[table.model] = countLines(blob.body);
      }
    }
    const { files, skipped } = await collectFiles(orgId);
    Object.assign(zip, files);
    const manifest = {
      format: "cbc-portal-org-export/v1",
      exportId,
      generatedAt: new Date().toISOString(),
      organization: {
        id: claimed.org.id,
        name: claimed.org.name,
        slug: claimed.org.slug,
        timezone: claimed.org.timezone,
        createdAt: claimed.org.createdAt.toISOString(),
      },
      tables: counts,
      excluded: {
        ...EXPORT_EXCLUDED,
        ...(ballotRowsAllowed
          ? {}
          : {
              Ballot: "Individual votes are visible to nobody (Privacy settings).",
              BallotChoice: "As Ballot.",
            }),
      },
      files: { included: Object.keys(files).length, skippedOverSizeCap: skipped.length },
    };
    zip["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));
    const archive = Buffer.from(zipSync(zip, { level: 6 }));

    const zipKey = storageKey("exports", orgId, `${exportId}.zip`);
    await deleteBlobs([zipKey]);
    await putBlob("exports", orgId, [`${exportId}.zip`], archive, {
      contentType: "application/zip",
    });

    const expiresAt = new Date(Date.now() + EXPORT_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
    const ready = await withSystemOrgTx(orgId, async ({ db }) => {
      const { count } = await db.orgExport.updateMany({
        where: { id: exportId, status: OrgExportStatus.RUNNING },
        data: {
          status: OrgExportStatus.READY,
          blobKey: zipKey,
          completedAt: new Date(),
          expiresAt,
          cursor: Prisma.DbNull,
        },
      });
      if (count !== 1) return false;
      await enqueueJob(db, {
        orgId,
        kind: "export-expire",
        key: exportId,
        payload: { exportId },
        runAt: expiresAt,
        noKick: true,
      });
      await writeOrgAuditLog(db, {
        organizationId: orgId,
        action: "export.ready",
        targetType: "OrgExport",
        targetId: exportId,
        diff: { bytes: archive.length, tables: Object.keys(counts).length },
      });
      if (claimed.requestedById)
        await notifyRequester(db, orgId, exportId, claimed.requestedById, true);
      return true;
    });
    // The parts are no longer needed once the zip is in place.
    const parts = tables.flatMap((t) => [
      partKey(orgId, exportId, `${t.model}.ndjson`),
      partKey(orgId, exportId, `${t.model}.csv`),
    ]);
    await deleteBlobs(parts);
    if (!ready) await deleteBlobs([zipKey]);
  } catch (error) {
    if (error instanceof PermanentJobError || run.attempt >= run.maxAttempts) {
      await markFailed(
        orgId,
        exportId,
        error instanceof Error ? error.message : "export failed",
        claimed.requestedById,
      );
    }
    throw error;
  }
};

/** export-expire: deletes the export's blobs at expiresAt and marks it EXPIRED. */
export const exportExpireJob: JobHandler<{ exportId: string }> = async (run) => {
  const orgId = run.organizationId;
  if (!orgId) throw new PermanentJobError("export-expire without an organizationId");
  const exportId = run.payload.exportId;
  const row = await withSystemOrgTx(orgId, ({ db }) =>
    db.orgExport.findFirst({
      where: { id: exportId, organizationId: orgId },
      select: { status: true, expiresAt: true, blobKey: true },
    }),
  );
  if (!row || row.status === OrgExportStatus.EXPIRED) return;
  if (row.expiresAt && row.expiresAt.getTime() > Date.now()) {
    return { status: "RETRY", error: "not due yet" };
  }
  const keys = await listBlobs("exports", `${scopePrefix("exports", orgId)}${exportId}`);
  await deleteBlobs([...keys, ...(row.blobKey ? [row.blobKey] : [])]);
  await withSystemOrgTx(orgId, async ({ db }) => {
    await db.orgExport.updateMany({
      where: { id: exportId, status: { not: OrgExportStatus.EXPIRED } },
      data: { status: OrgExportStatus.EXPIRED, blobKey: null },
    });
    await writeOrgAuditLog(db, {
      organizationId: orgId,
      action: "export.expired",
      targetType: "OrgExport",
      targetId: exportId,
    });
  });
};
