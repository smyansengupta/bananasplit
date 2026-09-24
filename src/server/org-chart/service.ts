import { randomBytes } from "node:crypto";

import { z } from "zod";

import {
  OrgChartParseStatus,
  OrgChartSource,
  OrgChartVersionStatus,
  TaskStatus,
  type Prisma,
} from "@/generated/prisma/client";
import { requirePermission } from "@/lib/auth/permissions";
import { LIMITS, normalizeOpenItems } from "@/lib/org-chart/normalize";
import { clamp, cleanBullets, cleanLine, positionKeyFromTitle, uniqueKey } from "@/lib/org-chart/text";
import type { ChartWarning, MatchState, OpenItem } from "@/lib/org-chart/types";
import { hasErrors, validateChart, type ValidationIssue } from "@/lib/org-chart/validate";
import { writeOrgAuditLog } from "@/server/audit";
import { invalidate } from "@/server/cache/invalidate";
import { tags } from "@/server/cache/tags";
import type { OrgContext } from "@/server/db/context";
import { enqueueJob } from "@/server/jobs/enqueue";
import { userPublicSelect, type UserPublic } from "@/server/members";

import { insertPositions, positionSelect, rowsToWrites, type PositionRow, type PositionWrite } from "./positions";

/**
 * Org chart writes and admin reads, all on the caller's app_user transaction
 * (withOrgAction / withOrgTx), so RLS applies: members see only the
 * published version, and only OWNER/ADMIN write (orgchart.write).
 *
 * - Versions are copy-on-version snapshots. Every upload, "Start blank",
 *   "Edit the current chart" and rollback creates a new numbered version.
 * - A per-org advisory lock serializes version numbering, the upload quota
 *   (20 imports a day, one active parse) and publishing.
 * - Draft saves use optimistic concurrency on editVersion and replace the
 *   draft's positions in one transaction (existing row ids are kept).
 * - Publish validates (no loops, managers inside the version, advisors with
 *   a manager and no reports, linked users still members), archives the
 *   previous version, points the org at the new one, optionally sets
 *   Membership.title, writes the audit log and invalidates the cached chart
 *   after COMMIT (invalidate() queues on ctx.afterCommit).
 */

export const ACTIVE_PARSE_STATUSES = [
  OrgChartParseStatus.PENDING,
  OrgChartParseStatus.EXTRACTING,
  OrgChartParseStatus.PARSING,
] as const;
export const UPLOADS_PER_DAY = 20;
/** An active parse this old no longer blocks a new upload (its job died). */
export const STALE_PARSE_MS = 30 * 60_000;
export const PARSE_MAX_ATTEMPTS = 3;

type Ctx = Pick<OrgContext, "db" | "organizationId" | "userId" | "role">;
type Db = Prisma.TransactionClient;

/** A refusal whose message is safe to show the admin. */
export class OrgChartError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "OrgChartError";
    this.status = status;
  }
}

export function newAttemptId(): string {
  return randomBytes(12).toString("hex");
}

export function newVersionId(): string {
  return `v${randomBytes(12).toString("hex")}`;
}

async function lockCharts(db: Db, organizationId: string): Promise<void> {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`orgchart-lock:${organizationId}`}))`;
}

async function nextNumber(db: Db, organizationId: string): Promise<number> {
  const last = await db.orgChartVersion.findFirst({
    where: { organizationId },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  return (last?.number ?? 0) + 1;
}

async function memberIndex(db: Db, organizationId: string) {
  const rows = await db.membership.findMany({
    where: { organizationId },
    select: { userId: true, user: { select: { name: true } } },
  });
  return {
    ids: new Set(rows.map((r) => r.userId)),
    names: new Map(rows.map((r) => [r.userId, r.user.name])),
  };
}

async function activeVersionId(db: Db, organizationId: string): Promise<string | null> {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { activeOrgChartVersionId: true },
  });
  return org?.activeOrgChartVersionId ?? null;
}

// ------------------------------------------------------------------ uploads

/** Whether the org has a Claude key saved (the upload needs one). */
export async function hasClaudeKey(db: Db, organizationId: string): Promise<boolean> {
  const row = await db.orgIntegration.findUnique({
    where: { organizationId_provider: { organizationId, provider: "CLAUDE" } },
    select: { secretLast4: true },
  });
  return Boolean(row?.secretLast4);
}

/** The DB quota: 20 imports per org per rolling day, one active parse at a time. */
export async function assertUploadAllowed(db: Db, organizationId: string, exceptVersionId?: string): Promise<void> {
  const uploads = await db.orgChartVersion.count({
    where: {
      organizationId,
      source: OrgChartSource.UPLOAD,
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60_000) },
    },
  });
  if (!exceptVersionId && uploads >= UPLOADS_PER_DAY) {
    throw new OrgChartError(
      `Your org has used its ${UPLOADS_PER_DAY} document imports for today. Try again tomorrow, or edit the chart by hand.`,
      429,
    );
  }
  const active = await db.orgChartVersion.count({
    where: {
      organizationId,
      status: OrgChartVersionStatus.DRAFT,
      parseStatus: { in: [...ACTIVE_PARSE_STATUSES] },
      updatedAt: { gte: new Date(Date.now() - STALE_PARSE_MS) },
      ...(exceptVersionId ? { id: { not: exceptVersionId } } : {}),
    },
  });
  if (active > 0) {
    throw new OrgChartError(
      "Claude is still reading another document for this org. Wait for it to finish, or discard that draft.",
      409,
    );
  }
}

export interface UploadVersionInput {
  versionId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  blobKey: string;
}

/** Creates the DRAFT (parseStatus PENDING) for a stored upload and enqueues claude-parse. */
export async function createUploadVersion(ctx: Ctx, input: UploadVersionInput): Promise<{ versionId: string; number: number }> {
  requirePermission(ctx, "orgchart.write");
  const { db, organizationId } = ctx;
  await lockCharts(db, organizationId);
  if (!(await hasClaudeKey(db, organizationId))) {
    throw new OrgChartError("Add a Claude API key in Settings > Integrations before importing a document.", 409);
  }
  await assertUploadAllowed(db, organizationId);
  const number = await nextNumber(db, organizationId);
  const parseAttemptId = newAttemptId();
  await db.orgChartVersion.create({
    data: {
      id: input.versionId,
      organizationId,
      number,
      status: OrgChartVersionStatus.DRAFT,
      source: OrgChartSource.UPLOAD,
      basedOnVersionId: await activeVersionId(db, organizationId),
      sourceFilename: clamp(cleanLine(input.filename), 200) || "document",
      sourceMimeType: input.mimeType,
      sourceSizeBytes: input.sizeBytes,
      sourceSha256: input.sha256,
      sourceBlobKey: input.blobKey,
      parseStatus: OrgChartParseStatus.PENDING,
      parseAttemptId,
      createdById: ctx.userId,
    },
  });
  await enqueueJob(db, {
    orgId: organizationId,
    kind: "claude-parse",
    key: `${input.versionId}.${parseAttemptId}`,
    payload: { versionId: input.versionId, parseAttemptId },
    maxAttempts: PARSE_MAX_ATTEMPTS,
  });
  await writeOrgAuditLog(db, {
    organizationId,
    action: "orgchart.upload",
    targetType: "OrgChartVersion",
    targetId: input.versionId,
    diff: { number, mimeType: input.mimeType, sizeBytes: input.sizeBytes },
  });
  return { versionId: input.versionId, number };
}

/** Runs the parse again for a FAILED (or stuck) upload draft. */
export async function retryParse(ctx: Ctx, versionId: string): Promise<void> {
  requirePermission(ctx, "orgchart.write");
  const { db, organizationId } = ctx;
  await lockCharts(db, organizationId);
  const version = await db.orgChartVersion.findFirst({
    where: { id: versionId, organizationId, status: OrgChartVersionStatus.DRAFT, source: OrgChartSource.UPLOAD },
    select: { parseStatus: true, updatedAt: true },
  });
  if (!version) throw new OrgChartError("That draft no longer exists.", 404);
  const stuck =
    version.parseStatus !== null &&
    (ACTIVE_PARSE_STATUSES as readonly string[]).includes(version.parseStatus) &&
    Date.now() - version.updatedAt.getTime() > STALE_PARSE_MS;
  if (version.parseStatus !== OrgChartParseStatus.FAILED && !stuck) {
    throw new OrgChartError("This draft is not waiting for a retry.", 409);
  }
  if (!(await hasClaudeKey(db, organizationId))) {
    throw new OrgChartError("Add a Claude API key in Settings > Integrations, then retry.", 409);
  }
  await assertUploadAllowed(db, organizationId, versionId);
  const parseAttemptId = newAttemptId();
  await db.orgChartVersion.update({
    where: { id: versionId },
    data: { parseStatus: OrgChartParseStatus.PENDING, parseAttemptId, parseError: null },
  });
  await enqueueJob(db, {
    orgId: organizationId,
    kind: "claude-parse",
    key: `${versionId}.${parseAttemptId}`,
    payload: { versionId, parseAttemptId },
    maxAttempts: PARSE_MAX_ATTEMPTS,
  });
}

// ------------------------------------------------------------------ drafts

/** A new MANUAL draft: empty, or a copy of the published chart. Works with no Claude key. */
export async function startDraft(ctx: Ctx, from: "blank" | "current"): Promise<string> {
  requirePermission(ctx, "orgchart.write");
  const { db, organizationId } = ctx;
  await lockCharts(db, organizationId);
  const active = await activeVersionId(db, organizationId);
  const versionId = newVersionId();
  let writes: PositionWrite[] = [];
  let openItems: Prisma.InputJsonValue = [];
  if (from === "current") {
    if (!active) throw new OrgChartError("There is no published chart to edit yet. Start a blank draft instead.", 409);
    const source = await db.orgChartVersion.findFirst({
      where: { id: active, organizationId },
      select: { openItems: true, positions: { select: positionSelect } },
    });
    if (!source) throw new OrgChartError("The published chart could not be loaded.", 404);
    const members = await memberIndex(db, organizationId);
    writes = rowsToWrites(source.positions, { memberIds: members.ids, userNames: members.names });
    openItems = source.openItems as Prisma.InputJsonValue;
  }
  await db.orgChartVersion.create({
    data: {
      id: versionId,
      organizationId,
      number: await nextNumber(db, organizationId),
      status: OrgChartVersionStatus.DRAFT,
      source: OrgChartSource.MANUAL,
      basedOnVersionId: from === "current" ? active : null,
      openItems,
      createdById: ctx.userId,
    },
  });
  await insertPositions(db, organizationId, versionId, writes);
  return versionId;
}

const MATCH_STATES = ["UNMATCHED", "SUGGESTED", "CONFIRMED"] as const;

export const SaveDraftSchema = z.object({
  versionId: z.string().min(1).max(100),
  editVersion: z.number().int().min(1),
  positions: z
    .array(
      z.object({
        id: z.string().min(1).max(100),
        title: z.string().max(1000),
        personName: z.string().max(1000).nullable(),
        userId: z.string().max(100).nullable(),
        matchState: z.enum(MATCH_STATES),
        matchScore: z.number().min(0).max(1).nullable(),
        suggestedUserIds: z.array(z.string().max(100)).max(10),
        reportsTo: z.string().max(100).nullable(),
        isOpen: z.boolean(),
        isAdvisor: z.boolean(),
        responsibilities: z.array(z.string().max(2000)).max(100),
        decidesAlone: z.array(z.string().max(2000)).max(100),
        rank: z.string().max(200),
      }),
    )
    .max(LIMITS.positions),
  openItems: z.array(z.object({ who: z.string().max(1000), question: z.string().max(2000) })).max(100),
});

export type SaveDraftInput = z.infer<typeof SaveDraftSchema>;

export type SaveDraftResult =
  | { ok: true; editVersion: number; ids: Record<string, string> }
  | { ok: false; error: string; conflict?: boolean };

const RANK = /^[0-9A-Za-z]{1,100}$/;

/** Replaces the draft's positions (optimistic concurrency on editVersion). */
export async function saveDraft(ctx: Ctx, raw: unknown): Promise<SaveDraftResult> {
  requirePermission(ctx, "orgchart.write");
  const parsed = SaveDraftSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "The draft could not be saved: some fields are invalid." };
  const input = parsed.data;
  const { db, organizationId } = ctx;

  const bumped = await db.orgChartVersion.updateMany({
    where: {
      id: input.versionId,
      organizationId,
      status: OrgChartVersionStatus.DRAFT,
      editVersion: input.editVersion,
      OR: [{ parseStatus: null }, { parseStatus: { notIn: [...ACTIVE_PARSE_STATUSES] } }],
    },
    data: {
      editVersion: { increment: 1 },
      openItems: normalizeOpenItems(input.openItems) as unknown as Prisma.InputJsonValue,
    },
  });
  if (bumped.count !== 1) {
    const current = await db.orgChartVersion.findFirst({
      where: { id: input.versionId, organizationId },
      select: { status: true, parseStatus: true },
    });
    if (!current || current.status !== OrgChartVersionStatus.DRAFT) {
      return { ok: false, error: "This draft was published or discarded in the meantime." };
    }
    if (current.parseStatus && (ACTIVE_PARSE_STATUSES as readonly string[]).includes(current.parseStatus)) {
      return { ok: false, error: "Claude is still reading this document; wait for it to finish." };
    }
    return {
      ok: false,
      conflict: true,
      error: "Someone else saved this draft since you opened it. Reload to see their changes.",
    };
  }

  const existing = await db.orgChartPosition.findMany({
    where: { organizationId, versionId: input.versionId },
    select: { id: true, key: true, sourceQuote: true },
  });
  const existingById = new Map(existing.map((e) => [e.id, e]));
  const members = await memberIndex(db, organizationId);
  const clientIds = new Set(input.positions.map((p) => p.id));

  const takenKeys = new Set<string>();
  for (const p of input.positions) {
    const row = existingById.get(p.id);
    if (row) takenKeys.add(row.key);
  }
  const writes: PositionWrite[] = input.positions.map((p) => {
    const row = existingById.get(p.id);
    const title = clamp(cleanLine(p.title), LIMITS.title);
    const isOpen = p.isOpen;
    const userId = !isOpen && p.userId && members.ids.has(p.userId) ? p.userId : null;
    const matchState: MatchState = userId
      ? p.matchState === "CONFIRMED"
        ? "CONFIRMED"
        : "SUGGESTED"
      : p.matchState === "CONFIRMED"
        ? "UNMATCHED"
        : p.matchState;
    return {
      ref: p.id,
      id: row?.id,
      key: row?.key ?? uniqueKey(positionKeyFromTitle(title || "position"), takenKeys),
      title,
      personName: isOpen ? null : clamp(cleanLine(p.personName), LIMITS.personName) || null,
      userId,
      matchState: isOpen ? "UNMATCHED" : matchState,
      matchScore: userId || matchState === "SUGGESTED" ? p.matchScore : null,
      suggestedUserIds: p.suggestedUserIds.filter((id) => members.ids.has(id)).slice(0, 3),
      reportsToRef: p.reportsTo && p.reportsTo !== p.id && clientIds.has(p.reportsTo) ? p.reportsTo : null,
      isOpen,
      isAdvisor: p.isAdvisor,
      responsibilities: cleanBullets(p.responsibilities, LIMITS.bullets, LIMITS.bullet),
      decidesAlone: cleanBullets(p.decidesAlone, LIMITS.bullets, LIMITS.bullet),
      sourceQuote: row?.sourceQuote ?? [],
      rank: RANK.test(p.rank) ? p.rank : null,
    };
  });

  await db.orgChartPosition.deleteMany({ where: { organizationId, versionId: input.versionId } });
  const ids = await insertPositions(db, organizationId, input.versionId, writes);
  return { ok: true, editVersion: input.editVersion + 1, ids: Object.fromEntries(ids) };
}

/** Discards a draft (history keeps it; nothing is deleted). */
export async function discardDraft(ctx: Ctx, versionId: string): Promise<void> {
  requirePermission(ctx, "orgchart.write");
  const res = await ctx.db.orgChartVersion.updateMany({
    where: { id: versionId, organizationId: ctx.organizationId, status: OrgChartVersionStatus.DRAFT },
    data: { status: OrgChartVersionStatus.DISCARDED },
  });
  if (res.count !== 1) throw new OrgChartError("That draft no longer exists.", 404);
  await writeOrgAuditLog(ctx.db, {
    organizationId: ctx.organizationId,
    action: "orgchart.discard",
    targetType: "OrgChartVersion",
    targetId: versionId,
  });
}

// ------------------------------------------------------------------ publish

export type PublishResult = { ok: true; number: number } | { ok: false; error: string; issues?: ValidationIssue[] };

function toValidationNodes(rows: readonly PositionRow[]) {
  return rows.map((r) => ({
    id: r.id,
    key: r.key,
    title: r.title,
    reportsTo: r.reportsToId,
    isAdvisor: r.isAdvisor,
    isOpen: r.isOpen,
    userId: r.userId,
    personName: r.personName,
    matchState: r.matchState,
  }));
}

/** Each linked member's highest position (fewest managers above, then rank). */
export function titlesFor(rows: readonly Pick<PositionRow, "id" | "userId" | "reportsToId" | "title" | "rank" | "matchState">[]) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const depth = (r: (typeof rows)[number]) => {
    let d = 0;
    const seen = new Set<string>();
    let cur = r.reportsToId ? byId.get(r.reportsToId) : undefined;
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      d++;
      cur = cur.reportsToId ? byId.get(cur.reportsToId) : undefined;
    }
    return d;
  };
  const best = new Map<string, { title: string; depth: number; rank: string }>();
  for (const r of rows) {
    if (!r.userId || r.matchState !== "CONFIRMED") continue;
    const d = depth(r);
    const cur = best.get(r.userId);
    if (!cur || d < cur.depth || (d === cur.depth && r.rank < cur.rank)) {
      best.set(r.userId, { title: r.title, depth: d, rank: r.rank });
    }
  }
  return new Map([...best].map(([userId, v]) => [userId, v.title]));
}

async function publishLocked(
  ctx: Ctx,
  version: { id: string; number: number },
  rows: readonly PositionRow[],
  options: { setTitles: boolean; action: string; diff?: Record<string, unknown> },
): Promise<PublishResult> {
  const { db, organizationId } = ctx;
  const members = await memberIndex(db, organizationId);
  const issues = validateChart(toValidationNodes(rows), { memberIds: members.ids });
  if (hasErrors(issues)) {
    return { ok: false, error: "Fix the problems in the checklist before publishing.", issues };
  }
  const now = new Date();
  await db.orgChartVersion.updateMany({
    where: { organizationId, status: OrgChartVersionStatus.PUBLISHED, id: { not: version.id } },
    data: { status: OrgChartVersionStatus.ARCHIVED },
  });
  await db.orgChartVersion.update({
    where: { id: version.id },
    data: {
      status: OrgChartVersionStatus.PUBLISHED,
      publishedById: ctx.userId,
      publishedAt: now,
      editVersion: { increment: 1 },
    },
  });
  await db.organization.update({
    where: { id: organizationId },
    data: { activeOrgChartVersionId: version.id },
  });
  let titled = 0;
  if (options.setTitles) {
    requirePermission(ctx, "members.setTitle");
    for (const [userId, title] of titlesFor(rows)) {
      const res = await db.membership.updateMany({
        where: { organizationId, userId },
        data: { title: clamp(title, 100) },
      });
      titled += res.count;
    }
  }
  await writeOrgAuditLog(db, {
    organizationId,
    action: options.action,
    targetType: "OrgChartVersion",
    targetId: version.id,
    diff: { number: version.number, positions: rows.length, titled, ...(options.diff ?? {}) },
  });
  // Queued on ctx.afterCommit: a failed publish leaves the cache untouched.
  invalidate([tags.orgChart(organizationId)]);
  return { ok: true, number: version.number };
}

export async function publishDraft(
  ctx: Ctx,
  versionId: string,
  options: { setTitles?: boolean; expectedEditVersion?: number } = {},
): Promise<PublishResult> {
  requirePermission(ctx, "orgchart.write");
  const { db, organizationId } = ctx;
  await lockCharts(db, organizationId);
  const version = await db.orgChartVersion.findFirst({
    where: { id: versionId, organizationId },
    select: { id: true, number: true, status: true, parseStatus: true, editVersion: true },
  });
  if (!version || version.status !== OrgChartVersionStatus.DRAFT) {
    return { ok: false, error: "Only a draft can be published." };
  }
  if (version.parseStatus && version.parseStatus !== OrgChartParseStatus.READY) {
    return {
      ok: false,
      error:
        version.parseStatus === OrgChartParseStatus.FAILED
          ? "Claude could not read this document. Retry the import or start a blank draft."
          : "Claude is still reading this document.",
    };
  }
  if (options.expectedEditVersion !== undefined && version.editVersion !== options.expectedEditVersion) {
    return { ok: false, error: "This draft changed since you opened it. Reload before publishing." };
  }
  const rows = await db.orgChartPosition.findMany({
    where: { organizationId, versionId },
    select: positionSelect,
    orderBy: [{ rank: "asc" }, { id: "asc" }],
  });
  return publishLocked(ctx, version, rows, { setTitles: options.setTitles === true, action: "orgchart.publish" });
}

/** Copies a past version forward (source ROLLBACK) and publishes the copy. */
export async function rollbackToVersion(ctx: Ctx, versionId: string): Promise<PublishResult & { versionId?: string }> {
  requirePermission(ctx, "orgchart.write");
  const { db, organizationId } = ctx;
  await lockCharts(db, organizationId);
  const source = await db.orgChartVersion.findFirst({
    where: { id: versionId, organizationId },
    select: {
      id: true,
      number: true,
      status: true,
      openItems: true,
      positions: { select: positionSelect, orderBy: [{ rank: "asc" }, { id: "asc" }] },
    },
  });
  if (!source) return { ok: false, error: "That version no longer exists." };
  if (source.status !== OrgChartVersionStatus.ARCHIVED && source.status !== OrgChartVersionStatus.PUBLISHED) {
    return { ok: false, error: "Only a previously published version can be restored." };
  }
  if ((await activeVersionId(db, organizationId)) === source.id) {
    return { ok: false, error: "That version is already the published chart." };
  }
  const members = await memberIndex(db, organizationId);
  const writes = rowsToWrites(source.positions, { memberIds: members.ids, userNames: members.names });

  const copyId = newVersionId();
  const number = await nextNumber(db, organizationId);
  await db.orgChartVersion.create({
    data: {
      id: copyId,
      organizationId,
      number,
      status: OrgChartVersionStatus.DRAFT,
      source: OrgChartSource.ROLLBACK,
      basedOnVersionId: source.id,
      openItems: source.openItems as Prisma.InputJsonValue,
      createdById: ctx.userId,
    },
  });
  await insertPositions(db, organizationId, copyId, writes);
  const rows = await db.orgChartPosition.findMany({
    where: { organizationId, versionId: copyId },
    select: positionSelect,
  });
  const result = await publishLocked(ctx, { id: copyId, number }, rows, {
    setTitles: false,
    action: "orgchart.rollback",
    diff: { restoredFrom: source.number },
  });
  if (!result.ok) {
    // Roll the whole transaction back: nothing half-restored is kept.
    throw new OrgChartError(result.error, 422);
  }
  return { ...result, versionId: copyId };
}

// ------------------------------------------------------------------ reads (admin)

export interface VersionSummary {
  id: string;
  number: number;
  status: OrgChartVersionStatus;
  source: OrgChartSource;
  parseStatus: OrgChartParseStatus | null;
  parseError: string | null;
  sourceFilename: string | null;
  basedOnVersionId: string | null;
  createdAt: Date;
  publishedAt: Date | null;
  createdBy: string | null;
  publishedBy: string | null;
  positions: number;
  isActive: boolean;
}

export async function listVersions(ctx: Ctx): Promise<VersionSummary[]> {
  const { db, organizationId } = ctx;
  const active = await activeVersionId(db, organizationId);
  const rows = await db.orgChartVersion.findMany({
    where: { organizationId },
    orderBy: { number: "desc" },
    take: 200,
    select: {
      id: true,
      number: true,
      status: true,
      source: true,
      parseStatus: true,
      parseError: true,
      sourceFilename: true,
      basedOnVersionId: true,
      createdAt: true,
      publishedAt: true,
      createdBy: { select: { name: true } },
      publishedBy: { select: { name: true } },
      _count: { select: { positions: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    status: r.status,
    source: r.source,
    parseStatus: r.parseStatus,
    parseError: r.parseError,
    sourceFilename: r.sourceFilename,
    basedOnVersionId: r.basedOnVersionId,
    createdAt: r.createdAt,
    publishedAt: r.publishedAt,
    createdBy: r.createdBy.name,
    publishedBy: r.publishedBy?.name ?? null,
    positions: r._count.positions,
    isActive: r.id === active,
  }));
}

export interface VersionDetail {
  version: {
    id: string;
    number: number;
    status: OrgChartVersionStatus;
    source: OrgChartSource;
    parseStatus: OrgChartParseStatus | null;
    parseError: string | null;
    parseModel: string | null;
    sourceFilename: string | null;
    sourceBlobKey: string | null;
    editVersion: number;
    basedOnVersionId: string | null;
    createdAt: Date;
    publishedAt: Date | null;
    openItems: OpenItem[];
    warnings: ChartWarning[];
    isActive: boolean;
  };
  positions: (PositionRow & { user: UserPublic | null })[];
}

export async function loadVersion(ctx: Ctx, versionId: string): Promise<VersionDetail | null> {
  const { db, organizationId } = ctx;
  const row = await db.orgChartVersion.findFirst({
    where: { id: versionId, organizationId },
    select: {
      id: true,
      number: true,
      status: true,
      source: true,
      parseStatus: true,
      parseError: true,
      parseModel: true,
      sourceFilename: true,
      sourceBlobKey: true,
      editVersion: true,
      basedOnVersionId: true,
      createdAt: true,
      publishedAt: true,
      openItems: true,
      warnings: true,
      positions: {
        select: { ...positionSelect, user: { select: userPublicSelect } },
        orderBy: [{ rank: "asc" }, { id: "asc" }],
      },
    },
  });
  if (!row) return null;
  const active = await activeVersionId(db, organizationId);
  const { positions, openItems, warnings, ...version } = row;
  return {
    version: {
      ...version,
      openItems: Array.isArray(openItems) ? (openItems as unknown as OpenItem[]) : [],
      warnings: Array.isArray(warnings) ? (warnings as unknown as ChartWarning[]) : [],
      isActive: row.id === active,
    },
    positions,
  };
}

// ------------------------------------------------------------------ side panel

export interface OpenTaskItem {
  id: string;
  title: string;
  status: TaskStatus;
  dueDate: Date | null;
}

export interface OpenTasks {
  owned: OpenTaskItem[];
  ownedCount: number;
  involved: OpenTaskItem[];
  involvedCount: number;
}

const OPEN_STATUSES = [TaskStatus.NOT_STARTED, TaskStatus.IN_PROGRESS, TaskStatus.BLOCKED];

/** A member's open tasks for the side panel: owned, and involved as a collaborator (top 5 each). */
export async function getOpenTasks(ctx: Pick<Ctx, "db" | "organizationId">, userId: string): Promise<OpenTasks> {
  const { db, organizationId } = ctx;
  const base = { organizationId, deletedAt: null, status: { in: OPEN_STATUSES } };
  const ownedWhere = { ...base, ownerId: userId };
  const involvedWhere = {
    ...base,
    OR: [{ ownerId: null }, { ownerId: { not: userId } }],
    assignees: { some: { userId } },
  };
  const select = { id: true, title: true, status: true, dueDate: true } as const;
  const orderBy = [{ dueDate: { sort: "asc" as const, nulls: "last" as const } }, { createdAt: "asc" as const }];
  const owned = await db.task.findMany({ where: ownedWhere, select, orderBy, take: 5 });
  const ownedCount = await db.task.count({ where: ownedWhere });
  const involved = await db.task.findMany({ where: involvedWhere, select, orderBy, take: 5 });
  const involvedCount = await db.task.count({ where: involvedWhere });
  return { owned, ownedCount, involved, involvedCount };
}
