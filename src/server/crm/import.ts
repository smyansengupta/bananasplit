import type { CrmRecordStatus, Prisma } from "@/generated/prisma/client";
import { normalizeDomain, normalizeEmail } from "@/lib/crm/dedupe";
import type { CrmObject } from "@/lib/crm/fields";
import {
  activityKindOf,
  mapRow,
  mappingSignature,
  parseLooseDate,
  suggestMapping,
  type ImportSource,
  type MappedRow,
  type Mapping,
} from "@/lib/crm/mapping";
import { parseCell } from "@/lib/databases/fields";
import type { TxClient } from "@/server/db/context";
import { enqueueJob } from "@/server/jobs/enqueue";

import { CrmError, requireCrm, type CrmActor } from "./access";
import { logActivity } from "./activity";
import { companyByDomain, createCompany, updateCompany, type CompanyInput } from "./companies";
import { customFieldsFor } from "./databases";
import { createDeal } from "./deals";
import { createPerson, personByEmail, updatePerson, type PersonInput } from "./people";

/**
 * Imports (docs/features/crm.md: "CSV import with column mapping ... run as
 * a job so 50,000 rows don't time out"; "Importers that keep notes and
 * activity from HubSpot, Salesforce and Pipedrive exports").
 *
 * 1. The upload route parses the file (spreadsheet, CSV, vCard) and keeps
 *    its rows in an import log: a CrmView row of objectKind "import",
 *    private to the person importing, so nothing else needs a table.
 * 2. The mapping screen suggests a target per column (remembered from the
 *    last file with the same columns: CrmView objectKind "import-mapping").
 * 3. Start runs small files at once and big ones as the crm-import job,
 *    in turns of TURN rows, each turn its own transaction.
 *
 * Every row is deduped: people on any of their addresses, companies on the
 * domain and then the name. An existing record only gets its empty fields
 * filled (an import never overwrites what someone typed). A row's note or
 * activity lands on the timeline, keyed import:{importId}:{row} so running
 * the same import again doesn't log it twice.
 */

export const MAX_IMPORT_ROWS = 50_000;
/** Rows done inline when Start is pressed; more go to the job. */
export const INLINE_ROWS = 40;
/** Rows per job turn (one transaction each). */
export const TURN = 60;

export type ImportStatus = "mapping" | "queued" | "running" | "done" | "failed";

export interface ImportLog {
  id: string;
  fileName: string;
  status: ImportStatus;
  object: CrmObject;
  source: ImportSource;
  pipelineId: string | null;
  headers: string[];
  total: number;
  done: number;
  created: number;
  updated: number;
  skipped: number;
  activities: number;
  errors: { row: number; message: string }[];
  mapping: Mapping;
  createdAt: Date;
}

interface LogState {
  status: ImportStatus;
  object: CrmObject;
  source: ImportSource;
  pipelineId: string | null;
  total: number;
  done: number;
  created: number;
  updated: number;
  skipped: number;
  activities: number;
  errors: { row: number; message: string }[];
  mapping: Mapping;
  signature: string;
}

interface LogData {
  headers: string[];
  rows: Record<string, string>[];
  /** A finished import's skipped rows, by row number (as in errors), until fixed or let go. */
  skipped?: Record<string, Record<string, string>>;
}

function readState(raw: unknown): LogState {
  const s = (raw ?? {}) as Partial<LogState>;
  return {
    status: s.status ?? "mapping",
    object: s.object ?? "person",
    source: s.source ?? "csv",
    pipelineId: s.pipelineId ?? null,
    total: s.total ?? 0,
    done: s.done ?? 0,
    created: s.created ?? 0,
    updated: s.updated ?? 0,
    skipped: s.skipped ?? 0,
    activities: s.activities ?? 0,
    errors: s.errors ?? [],
    mapping: s.mapping ?? {},
    signature: s.signature ?? "",
  };
}

function toLog(row: { id: string; name: string; filters: unknown; columns: unknown; createdAt: Date }): ImportLog {
  const state = readState(row.filters);
  const data = (row.columns ?? {}) as Partial<LogData>;
  return {
    id: row.id,
    fileName: row.name,
    status: state.status,
    object: state.object,
    source: state.source,
    pipelineId: state.pipelineId,
    headers: data.headers ?? [],
    total: state.total,
    done: state.done,
    created: state.created,
    updated: state.updated,
    skipped: state.skipped,
    activities: state.activities,
    errors: state.errors.slice(0, 50),
    mapping: state.mapping,
    createdAt: row.createdAt,
  };
}

async function remembered(db: TxClient, organizationId: string, signature: string): Promise<Mapping> {
  const row = await db.crmView.findFirst({
    where: { organizationId, objectKind: "import-mapping", name: signature },
    select: { columns: true },
  });
  return (row?.columns ?? {}) as Mapping;
}

/** Keeps the parsed file as an import log and suggests a mapping. */
export async function createImportLog(
  actor: CrmActor,
  input: { fileName: string; source: ImportSource; object: CrmObject; headers: string[]; rows: Record<string, string>[] },
): Promise<ImportLog> {
  await requireCrm(actor);
  const { db, organizationId, userId } = actor;
  if (input.rows.length === 0) throw new CrmError("That file has no rows to bring in.");
  if (input.rows.length > MAX_IMPORT_ROWS) {
    throw new CrmError(`Up to ${MAX_IMPORT_ROWS.toLocaleString()} rows at a time. Split the file first.`);
  }
  const signature = mappingSignature(input.object, input.headers);
  const custom = await customFieldsFor(db, organizationId, input.object);
  const mapping = suggestMapping(input.object, input.headers, custom, await remembered(db, organizationId, signature));
  const state: LogState = {
    status: "mapping",
    object: input.object,
    source: input.source,
    pipelineId: null,
    total: input.rows.length,
    done: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    activities: 0,
    errors: [],
    mapping,
    signature,
  };
  const row = await db.crmView.create({
    data: {
      organizationId,
      objectKind: "import",
      name: input.fileName.slice(0, 200) || "Import",
      filters: state as unknown as Prisma.InputJsonObject,
      columns: { headers: input.headers, rows: input.rows } as unknown as Prisma.InputJsonObject,
      layout: "import",
      shared: false,
      createdById: userId,
    },
    select: { id: true, name: true, filters: true, columns: true, createdAt: true },
  });
  return toLog(row);
}

export async function readImportLog(db: TxClient, organizationId: string, importId: string): Promise<ImportLog | null> {
  const row = await db.crmView.findFirst({
    where: { id: importId, organizationId, objectKind: "import" },
    select: { id: true, name: true, filters: true, columns: true, createdAt: true },
  });
  return row ? toLog(row) : null;
}

/** The first rows of an import, for the mapping preview. */
export async function importSample(db: TxClient, organizationId: string, importId: string, take = 5) {
  const row = await db.crmView.findFirst({
    where: { id: importId, organizationId, objectKind: "import" },
    select: { columns: true },
  });
  const data = (row?.columns ?? {}) as Partial<LogData>;
  return (data.rows ?? []).slice(0, take);
}

/** The person's recent imports (their own logs). */
export async function recentImports(db: TxClient, organizationId: string, userId: string): Promise<ImportLog[]> {
  const rows = await db.crmView.findMany({
    where: { organizationId, objectKind: "import", createdById: userId },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, name: true, filters: true, createdAt: true },
  });
  return rows.map((r) => toLog({ ...r, columns: { headers: [] } }));
}

/** Starts an import with the mapping the person chose. */
export async function startImport(
  actor: CrmActor,
  importId: string,
  input: { object: CrmObject; mapping: Mapping; pipelineId?: string | null; remember?: boolean },
): Promise<ImportLog> {
  await requireCrm(actor);
  const { db, organizationId, userId } = actor;
  const row = await db.crmView.findFirst({
    where: { id: importId, organizationId, objectKind: "import", createdById: userId },
    select: { id: true, filters: true },
  });
  if (!row) throw new CrmError("That import isn't here any more. Upload the file again.");
  const state = readState(row.filters);
  if (state.status !== "mapping") throw new CrmError("That import has already started.");
  const targets = Object.values(input.mapping).filter(Boolean);
  if (input.object === "person" && !targets.some((t) => ["name", "firstName", "lastName", "primaryEmail"].includes(t!))) {
    throw new CrmError("Match a column to Name or Email first.");
  }
  if (input.object === "company" && !targets.includes("name")) throw new CrmError("Match a column to Name first.");
  if (input.object === "deal") {
    if (!targets.includes("title")) throw new CrmError("Match a column to Title first.");
    if (!input.pipelineId) throw new CrmError("Pick the pipeline they go into.");
    const p = await db.crmPipeline.findFirst({
      where: { id: input.pipelineId, organizationId, archivedAt: null },
      select: { id: true },
    });
    if (!p) throw new CrmError("That pipeline isn't here any more.");
  }
  const next: LogState = {
    ...state,
    status: "queued",
    object: input.object,
    mapping: input.mapping,
    pipelineId: input.object === "deal" ? (input.pipelineId ?? null) : null,
  };
  await db.crmView.update({ where: { id: row.id }, data: { filters: next as unknown as Prisma.InputJsonObject } });
  if (input.remember !== false) {
    const sig = mappingSignature(input.object, Object.keys(input.mapping));
    const existing = await db.crmView.findFirst({
      where: { organizationId, objectKind: "import-mapping", name: sig },
      select: { id: true, createdById: true },
    });
    if (existing && existing.createdById === userId) {
      await db.crmView.update({
        where: { id: existing.id },
        data: { columns: input.mapping as Prisma.InputJsonObject },
      });
    } else if (!existing) {
      await db.crmView.create({
        data: {
          organizationId,
          objectKind: "import-mapping",
          name: sig,
          columns: input.mapping as Prisma.InputJsonObject,
          layout: "import",
          shared: true,
          createdById: userId,
        },
      });
    }
  }
  if (state.total <= INLINE_ROWS) {
    await runImportTurn(actor, importId, INLINE_ROWS);
  } else {
    await enqueueJob(db, {
      orgId: organizationId,
      kind: "crm-import",
      key: importId,
      payload: { importId, userId },
    });
  }
  return (await readImportLog(db, organizationId, importId))!;
}

interface RowContext {
  actor: CrmActor;
  importId: string;
  fields: Awaited<ReturnType<typeof customFieldsFor>>;
  members: { id: string; name: string | null; email: string | null }[];
  relationships: { id: string; label: string }[];
  stages: { id: string; name: string }[];
  pipelineId: string | null;
}

async function rowContext(actor: CrmActor, importId: string, object: CrmObject, pipelineId: string | null): Promise<RowContext> {
  const { db, organizationId } = actor;
  const members = (
    await db.membership.findMany({
      where: { organizationId },
      select: { user: { select: { id: true, name: true, email: true } } },
    })
  ).map((m) => m.user);
  const settings = await db.crmSettings.findUnique({ where: { organizationId }, select: { relationshipTypes: true } });
  const relationships = (Array.isArray(settings?.relationshipTypes) ? settings.relationshipTypes : []) as {
    id: string;
    label: string;
  }[];
  const stages = pipelineId
    ? await db.crmStage.findMany({
        where: { organizationId, pipelineId },
        orderBy: { sortOrder: "asc" },
        select: { id: true, name: true },
      })
    : [];
  return {
    actor,
    importId,
    fields: await customFieldsFor(db, organizationId, object, pipelineId),
    members,
    relationships,
    stages,
    pipelineId,
  };
}

function memberId(ctx: RowContext, raw: string | undefined): string | null | undefined {
  if (!raw) return undefined;
  const s = raw.trim().toLowerCase();
  const m = ctx.members.find((x) => x.email?.toLowerCase() === s || x.name?.toLowerCase() === s);
  return m?.id;
}

function statusOf(raw: string | undefined): CrmRecordStatus | undefined {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return undefined;
  if (/alum|former|past/.test(s)) return "ALUMNI";
  if (/inactive|archiv|lapsed|no$|false/.test(s)) return "INACTIVE";
  return "ACTIVE";
}

function customValues(ctx: RowContext, mapped: MappedRow): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [id, raw] of Object.entries(mapped.custom)) {
    const field = ctx.fields.find((f) => f.id === id);
    if (!field || field.type === "RELATION" || field.type === "MEMBER") continue;
    const parsed = parseCell(field, raw);
    if (parsed.ok && parsed.value !== null) out[id] = parsed.value;
  }
  return out;
}

/** Only the fields an existing record doesn't have yet. */
function blanksOnly<T extends Record<string, unknown>>(patch: T, existing: Record<string, unknown>): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === null) continue;
    const cur = existing[k];
    if (cur === null || cur === undefined || cur === "") out[k] = v;
  }
  return out as Partial<T>;
}

export type RowOutcome = { kind: "created" | "updated"; id: string } | { kind: "skipped"; reason: string };

/** One mapped row into the CRM. Throws CrmError for a row that can't be read. */
export async function importRow(
  ctx: RowContext,
  object: CrmObject,
  mapped: MappedRow,
  rowIndex: number,
): Promise<RowOutcome> {
  const { actor } = ctx;
  const { db, organizationId } = actor;
  const f = mapped.fields;
  const opts = { trusted: true, source: "import" as const, batchId: `imp_${ctx.importId}` };
  let outcome: RowOutcome;
  if (object === "person") {
    const emails = (f.primaryEmail ?? "").split(/[;,\s]+/).map((e) => normalizeEmail(e)).filter((e): e is string => Boolean(e));
    const others = (f.otherEmails ?? "").split(/[;,\s]+/).map((e) => normalizeEmail(e)).filter((e): e is string => Boolean(e));
    const primary = emails[0] ?? others[0] ?? null;
    const relationship = f.relationship
      ? ctx.relationships.find(
          (r) => r.id === f.relationship!.toLowerCase() || r.label.toLowerCase() === f.relationship!.toLowerCase(),
        )?.id
      : undefined;
    const input: PersonInput = {
      name: f.name,
      firstName: f.firstName,
      lastName: f.lastName,
      primaryEmail: primary,
      otherEmails: [...emails.slice(1), ...others].filter((e) => e !== primary),
      phone: f.phone,
      title: f.title,
      companyName: f.company,
      linkedinUrl: f.linkedinUrl,
      website: f.website,
      location: f.location,
      relationship,
      status: statusOf(f.status),
      ownerId: memberId(ctx, f.owner),
      source: f.source ?? "import",
      nextFollowUpAt: f.nextFollowUpAt ? parseLooseDate(f.nextFollowUpAt) : undefined,
      doNotContact: f.doNotContact ? /^(y|yes|true|1|x|unsubscribed|opted out)$/i.test(f.doNotContact) : undefined,
      custom: customValues(ctx, mapped),
    };
    if (!input.name && !input.firstName && !input.lastName && !primary) {
      return { kind: "skipped", reason: "No name or email" };
    }
    let existing: { id: string; deletedAt: Date | null } | null = null;
    for (const e of [primary, ...(input.otherEmails ?? [])].filter(Boolean) as string[]) {
      existing = await personByEmail(db, organizationId, e);
      if (existing) break;
    }
    if (existing && !existing.deletedAt) {
      const current = await db.crmPerson.findFirst({ where: { id: existing.id, organizationId } });
      const { otherEmails, custom, companyName, ...rest } = input;
      const patch = blanksOnly(rest as Record<string, unknown>, (current ?? {}) as Record<string, unknown>) as PersonInput;
      if (companyName && !current?.companyId) patch.companyName = companyName;
      const known = new Set(
        (await db.crmPersonEmail.findMany({ where: { organizationId, personId: existing.id }, select: { email: true } })).map((e) => e.email),
      );
      const newOthers = (otherEmails ?? []).filter((e) => !known.has(e));
      const freeOthers: string[] = [];
      for (const e of newOthers) if (!(await personByEmail(db, organizationId, e))) freeOthers.push(e);
      if (freeOthers.length) {
        patch.otherEmails = [...[...known].filter((e) => e !== current?.primaryEmail), ...freeOthers];
      }
      const blankCustom = blanksOnly(custom ?? {}, (current?.custom ?? {}) as Record<string, unknown>);
      if (Object.keys(blankCustom).length) patch.custom = blankCustom;
      await updatePerson(actor, existing.id, patch, opts);
      outcome = { kind: "updated", id: existing.id };
    } else {
      const lastContacted = f.lastContactedAt ? parseLooseDate(f.lastContactedAt) : null;
      const created = await createPerson(actor, input, opts);
      if (lastContacted) {
        await db.crmPerson.update({ where: { id: created.id }, data: { lastContactedAt: lastContacted } });
      }
      outcome = { kind: "created", id: created.id };
    }
  } else if (object === "company") {
    const domain = normalizeDomain(f.domain) ?? normalizeDomain(f.website);
    const input: CompanyInput = {
      name: f.name,
      domain: domain ?? undefined,
      website: f.website,
      industry: f.industry,
      size: f.size,
      phone: f.phone,
      address: f.address,
      description: f.description,
      status: statusOf(f.status),
      ownerId: memberId(ctx, f.owner),
      nextFollowUpAt: f.nextFollowUpAt ? parseLooseDate(f.nextFollowUpAt) : undefined,
      custom: customValues(ctx, mapped),
    };
    if (!input.name) return { kind: "skipped", reason: "No name" };
    const existing =
      (domain ? await companyByDomain(db, organizationId, domain) : null) ??
      (await db.crmCompany.findFirst({
        where: { organizationId, deletedAt: null, name: { equals: input.name, mode: "insensitive" } },
        select: { id: true, name: true },
      }));
    if (existing) {
      const current = await db.crmCompany.findFirst({ where: { id: existing.id, organizationId } });
      const { custom, ...rest } = input;
      const patch = blanksOnly(rest as Record<string, unknown>, (current ?? {}) as Record<string, unknown>) as CompanyInput;
      const blankCustom = blanksOnly(custom ?? {}, (current?.custom ?? {}) as Record<string, unknown>);
      if (Object.keys(blankCustom).length) patch.custom = blankCustom;
      await updateCompany(actor, existing.id, patch, opts);
      outcome = { kind: "updated", id: existing.id };
    } else {
      outcome = { kind: "created", id: (await createCompany(actor, input, opts)).id };
    }
  } else {
    if (!ctx.pipelineId) throw new CrmError("Pick the pipeline they go into.");
    if (!f.title) return { kind: "skipped", reason: "No title" };
    const stage =
      (f.stage && ctx.stages.find((s) => s.name.toLowerCase() === f.stage!.trim().toLowerCase())) || ctx.stages[0];
    let companyId: string | null = null;
    if (f.company) {
      const c = await db.crmCompany.findFirst({
        where: { organizationId, deletedAt: null, name: { equals: f.company.trim(), mode: "insensitive" } },
        select: { id: true },
      });
      companyId = c?.id ?? (await createCompany(actor, { name: f.company }, opts)).id;
    }
    let personId: string | null = null;
    if (f.person) {
      const byEmail = normalizeEmail(f.person) ? await personByEmail(db, organizationId, f.person) : null;
      const byName = byEmail
        ? null
        : await db.crmPerson.findFirst({
            where: { organizationId, deletedAt: null, name: { equals: f.person.trim(), mode: "insensitive" } },
            select: { id: true },
          });
      personId =
        (byEmail && !byEmail.deletedAt ? byEmail.id : null) ??
        byName?.id ??
        (await createPerson(
          actor,
          normalizeEmail(f.person) ? { primaryEmail: f.person, companyId } : { name: f.person, companyId },
          opts,
        )).id;
    }
    const created = await createDeal(
      actor,
      {
        pipelineId: ctx.pipelineId,
        stageId: stage?.id,
        title: f.title,
        amount: f.amount ? f.amount.replace(/[^0-9.]/g, "") : undefined,
        expectedOn: f.expectedOn ? parseLooseDate(f.expectedOn) : undefined,
        companyId,
        primaryPersonId: personId,
        ownerId: memberId(ctx, f.owner),
        nextStep: f.nextStep,
        nextStepAt: f.nextStepAt ? parseLooseDate(f.nextStepAt) : undefined,
        closeReason: f.closeReason ?? (stage ? undefined : undefined),
        source: f.source ?? "import",
        custom: customValues(ctx, mapped),
      },
      opts,
    ).catch(async (error) => {
      // A closing stage that wants a reason: bring it in at the first stage instead.
      if (error instanceof CrmError && ctx.stages[0] && stage?.id !== ctx.stages[0].id) {
        return createDeal(
          actor,
          { pipelineId: ctx.pipelineId!, stageId: ctx.stages[0].id, title: f.title, companyId, primaryPersonId: personId },
          opts,
        );
      }
      throw error;
    });
    outcome = { kind: "created", id: created.id };
  }
  if (mapped.activity) {
    const at = parseLooseDate(mapped.activity.date) ?? new Date();
    await logActivity(db, {
      organizationId,
      kind: activityKindOf(mapped.activity.kind),
      subject: mapped.activity.subject ?? (mapped.activity.kind ? mapped.activity.kind : "Note from import"),
      body: mapped.activity.body,
      occurredAt: at,
      targets: [{ kind: object, id: outcome.id }],
      actorId: actor.userId,
      createdById: actor.userId,
      sourceKind: "import",
      sourceId: `${ctx.importId}:${rowIndex}`,
      meta: { importId: ctx.importId },
    });
  }
  return outcome;
}

/**
 * One turn of an import: up to `max` rows from where it stopped, each in a
 * savepoint so one bad row is recorded and skipped, not the whole turn.
 * Returns whether rows are left.
 */
export async function runImportTurn(actor: CrmActor, importId: string, max = TURN): Promise<{ left: number }> {
  const { db, organizationId } = actor;
  const row = await db.crmView.findFirst({
    where: { id: importId, organizationId, objectKind: "import" },
    select: { id: true, filters: true, columns: true },
  });
  if (!row) return { left: 0 };
  const state = readState(row.filters);
  if (state.status === "done" || state.status === "failed" || state.status === "mapping") return { left: 0 };
  const data = (row.columns ?? {}) as Partial<LogData>;
  const rows = data.rows ?? [];
  const ctx = await rowContext(actor, importId, state.object, state.pipelineId);
  const end = Math.min(rows.length, state.done + max);
  let activities = 0;
  for (let i = state.done; i < end; i++) {
    const mapped = mapRow(rows[i]!, state.mapping);
    await db.$executeRaw`SAVEPOINT crm_import_row`;
    try {
      const outcome = await importRow(ctx, state.object, mapped, i);
      await db.$executeRaw`RELEASE SAVEPOINT crm_import_row`;
      if (outcome.kind === "created") state.created++;
      else if (outcome.kind === "updated") state.updated++;
      else {
        state.skipped++;
        const reason = "reason" in outcome ? outcome.reason : "Skipped";
        if (state.errors.length < 200) state.errors.push({ row: i + 2, message: reason });
      }
      if (mapped.activity && outcome.kind !== "skipped") activities++;
    } catch (error) {
      await db.$executeRaw`ROLLBACK TO SAVEPOINT crm_import_row`;
      state.skipped++;
      const message = error instanceof CrmError ? error.message : "This row couldn't be read.";
      if (state.errors.length < 200) state.errors.push({ row: i + 2, message });
    }
  }
  state.done = end;
  state.activities += activities;
  const finished = end >= rows.length;
  state.status = finished ? "done" : "running";
  await db.crmView.update({
    where: { id: row.id },
    data: {
      filters: state as unknown as Prisma.InputJsonObject,
      // A finished import keeps its log, not its rows: only the skipped
      // ones, so they can be fixed in CRM settings > Import and export.
      ...(finished
        ? {
            columns: {
              headers: data.headers ?? [],
              rows: [],
              skipped: Object.fromEntries(
                state.errors.filter((e) => rows[e.row - 2]).map((e) => [String(e.row), rows[e.row - 2]!]),
              ),
            } as unknown as Prisma.InputJsonObject,
          }
        : {}),
    },
  });
  if (finished) {
    await enqueueJob(db, { orgId: organizationId, kind: "crm-refresh", key: organizationId, payload: {} });
  }
  return { left: rows.length - end };
}


// ---- Rows to fix ----------------------------------------------------------------------------

export interface RowToFix {
  /** The row number in the file (the header is row 1). */
  row: number;
  message: string;
  /** What the row is called: its name, title or email, as written. */
  label: string;
  /** No name or email: an email added here brings it in. */
  needsEmail: boolean;
}

export interface ImportToFix {
  id: string;
  fileName: string;
  object: CrmObject;
  created: number;
  updated: number;
  rows: RowToFix[];
}

/** The viewer's finished imports with skipped rows still to look at (newest first). */
export async function importsToFix(db: TxClient, organizationId: string, userId: string): Promise<ImportToFix[]> {
  const logs = await db.crmView.findMany({
    where: { organizationId, objectKind: "import", createdById: userId },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, name: true, filters: true, columns: true },
  });
  const out: ImportToFix[] = [];
  for (const l of logs) {
    const state = readState(l.filters);
    if (state.status !== "done") continue;
    const skipped = ((l.columns ?? {}) as Partial<LogData>).skipped ?? {};
    const rows: RowToFix[] = [];
    for (const e of state.errors) {
      const raw = skipped[String(e.row)];
      if (!raw) continue;
      const f = mapRow(raw, state.mapping).fields;
      const label = f.name || [f.firstName, f.lastName].filter(Boolean).join(" ") || f.title || f.primaryEmail || `Row ${e.row}`;
      rows.push({ row: e.row, message: e.message, label, needsEmail: state.object === "person" && !f.primaryEmail });
    }
    if (rows.length) {
      out.push({ id: l.id, fileName: l.name, object: state.object, created: state.created, updated: state.updated, rows });
    }
  }
  return out;
}

async function loadFixable(actor: CrmActor, importId: string, row: number) {
  const { db, organizationId, userId } = actor;
  const log = await db.crmView.findFirst({
    where: { id: importId, organizationId, objectKind: "import", createdById: userId },
    select: { id: true, filters: true, columns: true },
  });
  if (!log) throw new CrmError("That import isn't here any more.");
  const state = readState(log.filters);
  const data = (log.columns ?? {}) as Partial<LogData>;
  const raw = data.skipped?.[String(row)];
  if (state.status !== "done" || !raw) throw new CrmError("That row is already sorted.");
  return { log, state, data, raw };
}

async function dropRow(
  db: TxClient,
  logId: string,
  state: LogState,
  data: Partial<LogData>,
  row: number,
  outcome: RowOutcome | null,
): Promise<void> {
  const skipped = { ...(data.skipped ?? {}) };
  delete skipped[String(row)];
  const next: LogState = {
    ...state,
    errors: state.errors.filter((e) => e.row !== row),
    ...(outcome && outcome.kind !== "skipped"
      ? {
          skipped: Math.max(0, state.skipped - 1),
          created: state.created + (outcome.kind === "created" ? 1 : 0),
          updated: state.updated + (outcome.kind === "updated" ? 1 : 0),
        }
      : {}),
  };
  await db.crmView.update({
    where: { id: logId },
    data: {
      filters: next as unknown as Prisma.InputJsonObject,
      columns: { headers: data.headers ?? [], rows: [], skipped } as unknown as Prisma.InputJsonObject,
    },
  });
}

/**
 * Brings in one skipped row, with an email added when it had none. The
 * person who ran the import, as for the import itself; a row that still
 * can't come in says why and stays.
 */
export async function fixImportRow(
  actor: CrmActor,
  importId: string,
  row: number,
  patch: { email?: string | null },
): Promise<RowOutcome> {
  await requireCrm(actor);
  const { log, state, data, raw } = await loadFixable(actor, importId, row);
  const mapped = mapRow(raw, state.mapping);
  const email = patch.email?.trim();
  if (email) {
    if (!normalizeEmail(email)) throw new CrmError("That doesn't look like an email.");
    mapped.fields.primaryEmail = email;
  }
  const ctx = await rowContext(actor, importId, state.object, state.pipelineId);
  const outcome = await importRow(ctx, state.object, mapped, row - 2);
  if (outcome.kind === "skipped") throw new CrmError(outcome.reason);
  await dropRow(actor.db, log.id, state, data, row, outcome);
  return outcome;
}

/** Lets a skipped row go: it stays out, and stops asking. */
export async function letRowGo(actor: CrmActor, importId: string, row: number): Promise<void> {
  await requireCrm(actor);
  const { log, state, data } = await loadFixable(actor, importId, row);
  await dropRow(actor.db, log.id, state, data, row, null);
}
