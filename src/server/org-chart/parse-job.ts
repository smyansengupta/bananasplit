import { OrgChartParseStatus, OrgChartVersionStatus, type Prisma } from "@/generated/prisma/client";
import { matchPerson, type MatchCandidate } from "@/lib/org-chart/match";
import { normalizeOrgChart, type NormalizedChart } from "@/lib/org-chart/normalize";
import { withSystemOrgTx } from "@/server/db/context";
import { sanitize } from "@/server/jobs/sanitize";
import type { JobHandler, JobOutcome } from "@/server/jobs/types";
import { getBlob } from "@/server/storage";

import { ClaudeParseError, getClaudeConfig, parseWithClaude } from "./claude";
import { extractSource, sniffSource, SourceRejectedError } from "./extract";
import { insertPositions, type PositionWrite } from "./positions";

/**
 * The claude-parse job (heavy kind; lease, maxRuntime and tier come from
 * src/server/jobs/registry.ts). It runs only from /api/cron/jobs or its
 * kick, never inside a user request, and with no transaction open:
 *
 *   1. claim   a short withSystemOrgTx: compare-and-set on (versionId,
 *              parseAttemptId, DRAFT, an active parseStatus) -> EXTRACTING.
 *              A superseded attempt or a discarded draft stops here.
 *   2. read    the private blob, sniff and extract it (PDF as a document
 *              block, DOCX through the zip-bomb guards), then load the
 *              org's Claude key (getSecret, outside any transaction) and
 *              mark PARSING.
 *   3. call    Claude (countTokens preflight, then the schema-bound parse).
 *   4. write   one withSystemOrgTx: compare-and-set on (versionId,
 *              parseAttemptId, PARSING) -> READY with rawParse, warnings,
 *              open items, model and usage, and the normalized positions
 *              with local match suggestions (member emails never leave the
 *              server). A stale attempt's write is rejected.
 *
 * Failures store a sanitized parseError (never document text). Problems
 * retrying cannot fix (bad file, no key, refusal, max_tokens, rejected key)
 * fail at once; transient ones retry with the runner's backoff and fail on
 * the last attempt. The output only ever touches this draft: never roles,
 * invites or email.
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

/** Positions to insert: the normalized chart plus match suggestions. */
export function chartToWrites(chart: NormalizedChart, candidates: readonly MatchCandidate[]): PositionWrite[] {
  return chart.positions.map((p) => {
    const match = p.isOpen ? null : matchPerson(p.personName, candidates);
    return {
      ref: p.key,
      key: p.key,
      title: p.title,
      personName: p.personName,
      userId: null,
      matchState: match?.state ?? "UNMATCHED",
      matchScore: match?.score ?? null,
      suggestedUserIds: match?.suggestions.map((s) => s.userId) ?? [],
      reportsToRef: p.reportsTo,
      isOpen: p.isOpen,
      isAdvisor: p.isAdvisor,
      responsibilities: p.responsibilities,
      decidesAlone: p.decidesAlone,
      sourceQuote: p.sourceQuote,
    };
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

  try {
    // 2. Read and extract (no transaction open).
    if (!claimed.sourceBlobKey) throw new SourceRejectedError("The uploaded file is missing. Upload it again.");
    const blob = await getBlob(claimed.sourceBlobKey);
    if (!blob) throw new SourceRejectedError("The uploaded file is missing. Upload it again.");
    const filename = claimed.sourceFilename ?? "";
    const source = await extractSource(blob.body, sniffSource(blob.body, filename));
    const config = await getClaudeConfig(orgId);
    if (!config) {
      throw new ClaudeParseError("Add a Claude API key in Settings > Integrations, then retry the import.", false);
    }
    await advance(orgId, payload, OrgChartParseStatus.PARSING);

    // 3. Claude.
    const timeoutMs = Math.max(30_000, Math.min(MAX_CLAUDE_TIMEOUT_MS, run.deadline - Date.now() - WRITE_MARGIN_MS));
    const result = await parseWithClaude({ config, source, filename, timeoutMs, signal: run.signal });
    const chart = normalizeOrgChart(result.parse);

    // 4. Write back (compare-and-set).
    const written = await withSystemOrgTx(orgId, async ({ db }) => {
      const members = await db.membership.findMany({
        where: { organizationId: orgId },
        select: { user: { select: { id: true, name: true, email: true } } },
      });
      const candidates: MatchCandidate[] = members.map((m) => ({
        userId: m.user.id,
        name: m.user.name,
        emailLocal: m.user.email.split("@")[0] ?? null,
      }));
      const done = await db.orgChartVersion.updateMany({
        where: {
          id: payload.versionId,
          organizationId: orgId,
          status: OrgChartVersionStatus.DRAFT,
          parseAttemptId: payload.parseAttemptId,
          parseStatus: OrgChartParseStatus.PARSING,
        },
        data: {
          parseStatus: OrgChartParseStatus.READY,
          parseError: null,
          parseModel: result.model,
          parseUsage: result.usage as unknown as Prisma.InputJsonValue,
          rawParse: result.parse as unknown as Prisma.InputJsonValue,
          openItems: chart.openItems as unknown as Prisma.InputJsonValue,
          warnings: chart.warnings as unknown as Prisma.InputJsonValue,
          editVersion: { increment: 1 },
        },
      });
      if (done.count !== 1) return false;
      await db.orgChartPosition.deleteMany({ where: { organizationId: orgId, versionId: payload.versionId } });
      await insertPositions(db, orgId, payload.versionId, chartToWrites(chart, candidates));
      return true;
    });
    if (!written) return { status: "CANCELLED", error: "superseded or discarded" };
  } catch (error) {
    if (error instanceof StaleAttempt) return { status: "CANCELLED", error: "superseded or discarded" };
    const { message, permanent } = failureMessage(error);
    const last = permanent || run.attempt >= run.maxAttempts;
    const stored = sanitize(last ? message.replace(" The parse will be retried.", "") : message);
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
