import {
  OrgChartParseMethod,
  OrgChartParseStatus,
  OrgChartVersionStatus,
  type Prisma,
} from "@/generated/prisma/client";
import { normalizeOrgChart, type NormalizedChart } from "@/lib/org-chart/normalize";
import type { ParseReport } from "@/lib/org-chart/types";
import { withSystemOrgTx } from "@/server/db/context";
import { sanitize } from "@/server/jobs/sanitize";
import type { JobHandler, JobOutcome } from "@/server/jobs/types";
import { getBlob } from "@/server/storage";

import { ClaudeParseError, getClaudeConfig, parseWithClaude, type ClaudeUsage } from "./claude";
import { extractSource, sniffSource, SourceRejectedError } from "./extract";
import { BUILTIN_CONFIDENCE_THRESHOLD, parseOrgChartText } from "./parse";
import { chartToWrites, insertPositions, memberCandidates } from "./positions";

/**
 * The claude-parse job (heavy kind; lease, maxRuntime and tier come from
 * src/server/jobs/registry.ts). It runs only from /api/cron/jobs or its
 * kick, never inside a user request, and with no transaction open.
 *
 * The job is the *second* reader. The built-in parser already ran in the
 * upload request; a document it understood never reaches this job at all.
 * What arrives here is a document it could not read well enough, and the
 * fallback order is:
 *
 *   built-in parser -> Claude (the org's model, Haiku by default) -> the
 *   admin's editor, which always works.
 *
 * Steps:
 *   1. claim   a short withSystemOrgTx: compare-and-set on (versionId,
 *              parseAttemptId, DRAFT, an active parseStatus) -> EXTRACTING.
 *              A superseded attempt or a discarded draft stops here.
 *   2. read    the private blob, sniff and extract it (PDF as a document
 *              block, DOCX through the zip-bomb guards), then run the
 *              built-in parser again. If it is confident this time, the job
 *              finishes without calling anything.
 *   3. call    Claude (countTokens preflight, then the schema-bound parse),
 *              after loading the org's key with getSecret outside any
 *              transaction.
 *   4. write   one withSystemOrgTx: compare-and-set on (versionId,
 *              parseAttemptId) -> READY with the parse, the reader that
 *              produced it, its report, the model and usage, and the
 *              normalized positions with local match suggestions (member
 *              emails never leave the server). A stale attempt is rejected.
 *
 * A Claude failure never dead-ends the org: a transient one retries with
 * the runner's backoff, and a permanent one (or the last attempt) lands the
 * built-in reading as the draft with the reason recorded, so the admin
 * always has something to fix by hand. Only an unusable file fails outright.
 */

export interface ClaudeParsePayload {
  versionId: string;
  parseAttemptId: string;
}

const ACTIVE: OrgChartParseStatus[] = [
  OrgChartParseStatus.PENDING,
  OrgChartParseStatus.EXTRACTING,
  OrgChartParseStatus.PARSING,
];

/** Leaves room after the Claude call for the write transaction. */
const WRITE_MARGIN_MS = 20_000;
const MAX_CLAUDE_TIMEOUT_MS = 200_000;

class StaleAttempt extends Error {}

async function advance(orgId: string, payload: ClaudeParsePayload, to: OrgChartParseStatus): Promise<void> {
  const res = await withSystemOrgTx(orgId, ({ db }) =>
    db.orgChartVersion.updateMany({
      where: {
        id: payload.versionId,
        organizationId: orgId,
        status: OrgChartVersionStatus.DRAFT,
        parseAttemptId: payload.parseAttemptId,
        parseStatus: { in: ACTIVE },
      },
      data: { parseStatus: to },
    }),
  );
  if (res.count !== 1) throw new StaleAttempt();
}

export { chartToWrites };

interface Outcome {
  chart: NormalizedChart;
  method: OrgChartParseMethod;
  report: ParseReport | null;
  model: string | null;
  usage: ClaudeUsage | null;
  rawParse: unknown;
}

/** Stores a finished reading on the draft (compare-and-set on the attempt). */
async function store(orgId: string, payload: ClaudeParsePayload, outcome: Outcome): Promise<boolean> {
  return withSystemOrgTx(orgId, async ({ db }) => {
    const candidates = await memberCandidates(db, orgId);
    const done = await db.orgChartVersion.updateMany({
      where: {
        id: payload.versionId,
        organizationId: orgId,
        status: OrgChartVersionStatus.DRAFT,
        parseAttemptId: payload.parseAttemptId,
        parseStatus: { in: ACTIVE },
      },
      data: {
        parseStatus: OrgChartParseStatus.READY,
        parseError: null,
        parseMethod: outcome.method,
        parseModel: outcome.model,
        parseUsage: (outcome.usage ?? null) as unknown as Prisma.InputJsonValue,
        parseConfidence: outcome.report?.confidence ?? null,
        parseReport: (outcome.report ?? null) as unknown as Prisma.InputJsonValue,
        rawParse: outcome.rawParse as Prisma.InputJsonValue,
        openItems: outcome.chart.openItems as unknown as Prisma.InputJsonValue,
        warnings: outcome.chart.warnings as unknown as Prisma.InputJsonValue,
        editVersion: { increment: 1 },
      },
    });
    if (done.count !== 1) return false;
    await db.orgChartPosition.deleteMany({ where: { organizationId: orgId, versionId: payload.versionId } });
    await insertPositions(db, orgId, payload.versionId, chartToWrites(outcome.chart, candidates));
    return true;
  });
}

function failureMessage(error: unknown): { message: string; permanent: boolean } {
  if (error instanceof SourceRejectedError) return { message: error.message, permanent: true };
  if (error instanceof ClaudeParseError) return { message: error.message, permanent: !error.retryable };
  return { message: "The document could not be processed. The parse will be retried.", permanent: false };
}

export const claudeParseJob: JobHandler<ClaudeParsePayload> = async (run): Promise<JobOutcome | void> => {
  const orgId = run.organizationId;
  if (!orgId) return { status: "DEAD", error: "claude-parse needs an organization" };
  const payload = run.payload;

  // 1. Claim.
  const claimed = await withSystemOrgTx(orgId, async ({ db }) => {
    const res = await db.orgChartVersion.updateMany({
      where: {
        id: payload.versionId,
        organizationId: orgId,
        status: OrgChartVersionStatus.DRAFT,
        parseAttemptId: payload.parseAttemptId,
        parseStatus: { in: ACTIVE },
      },
      data: { parseStatus: OrgChartParseStatus.EXTRACTING, parseError: null },
    });
    if (res.count !== 1) return null;
    return db.orgChartVersion.findUnique({
      where: { id: payload.versionId },
      select: { sourceBlobKey: true, sourceFilename: true },
    });
  });
  if (!claimed) return { status: "CANCELLED", error: "superseded or discarded" };

  /** The built-in reading, kept so a Claude failure still leaves a draft. */
  let builtin: { chart: NormalizedChart; report: ParseReport; rawParse: unknown } | null = null;

  try {
    // 2. Read, extract and try the built-in parser (no transaction, no network).
    if (!claimed.sourceBlobKey) throw new SourceRejectedError("The uploaded file is missing. Upload it again.");
    const blob = await getBlob(claimed.sourceBlobKey);
    if (!blob) throw new SourceRejectedError("The uploaded file is missing. Upload it again.");
    const filename = claimed.sourceFilename ?? "";
    const source = await extractSource(blob.body, sniffSource(blob.body, filename));
    if (source.type === "text") {
      const result = parseOrgChartText(source.text);
      builtin = { chart: normalizeOrgChart(result.parse), report: result.report, rawParse: result.parse };
      if (result.report.confidence >= BUILTIN_CONFIDENCE_THRESHOLD) {
        const written = await store(orgId, payload, {
          chart: builtin.chart,
          method: OrgChartParseMethod.BUILTIN,
          report: builtin.report,
          model: null,
          usage: null,
          rawParse: builtin.rawParse,
        });
        return written ? undefined : { status: "CANCELLED", error: "superseded or discarded" };
      }
    }

    const config = await getClaudeConfig(orgId);
    if (!config) {
      throw new ClaudeParseError(
        "Add a Claude API key in Settings > Integrations to have Claude read this document.",
        false,
      );
    }
    await advance(orgId, payload, OrgChartParseStatus.PARSING);

    // 3. Claude.
    const timeoutMs = Math.max(30_000, Math.min(MAX_CLAUDE_TIMEOUT_MS, run.deadline - Date.now() - WRITE_MARGIN_MS));
    const result = await parseWithClaude({ config, source, filename, timeoutMs, signal: run.signal });

    // 4. Write back (compare-and-set).
    const written = await store(orgId, payload, {
      chart: normalizeOrgChart(result.parse),
      method: OrgChartParseMethod.CLAUDE,
      report: builtin?.report ?? null,
      model: result.model,
      usage: result.usage,
      rawParse: result.parse,
    });
    if (!written) return { status: "CANCELLED", error: "superseded or discarded" };
  } catch (error) {
    if (error instanceof StaleAttempt) return { status: "CANCELLED", error: "superseded or discarded" };
    const { message, permanent } = failureMessage(error);
    const last = permanent || run.attempt >= run.maxAttempts;
    const stored = sanitize(last ? message.replace(" The parse will be retried.", "") : message);

    // Never dead-end the org: once Claude is out of tries, whatever the
    // built-in parser did read becomes the draft, with the reason recorded.
    // With nothing read at all the draft fails instead, because the failure
    // screen is the more useful one (retry, or build it by hand).
    if (last && builtin && builtin.chart.positions.length > 0) {
      const report: ParseReport = {
        ...builtin.report,
        notes: [
          ...builtin.report.notes,
          `Claude could not read this document, so this draft is the portal's own reading of it. ${stored}`,
        ],
      };
      const fellBack = await store(orgId, payload, {
        chart: builtin.chart,
        method: OrgChartParseMethod.BUILTIN,
        report,
        model: null,
        usage: null,
        rawParse: builtin.rawParse,
      });
      if (fellBack) return { status: "DEAD", error: stored };
    }

    await withSystemOrgTx(orgId, ({ db }) =>
      db.orgChartVersion.updateMany({
        where: {
          id: payload.versionId,
          organizationId: orgId,
          parseAttemptId: payload.parseAttemptId,
          parseStatus: { in: ACTIVE },
        },
        data: last
          ? { parseStatus: OrgChartParseStatus.FAILED, parseError: stored }
          : { parseStatus: OrgChartParseStatus.PENDING, parseError: stored },
      }),
    ).catch(() => undefined);
    if (last) return { status: "DEAD", error: stored };
    return { status: "RETRY", error: stored };
  }
};
