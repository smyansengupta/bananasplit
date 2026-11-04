"use server";

import type { CrmActivityKind, CrmStageKind } from "@/generated/prisma/client";
import { ForbiddenError, NotFoundError } from "@/lib/auth/errors";
import type { CrmObject } from "@/lib/crm/fields";
import type { Mapping } from "@/lib/crm/mapping";
import type { RelationshipType } from "@/lib/crm/templates";
import { CrmValidationError } from "@/lib/crm/validate";
import { CrmError, requireCrm } from "@/server/crm/access";
import { logActivity, timeline, type TimelineEntry } from "@/server/crm/activity";
import { queueIssueRefresh } from "@/server/crm/issue-queue";
import { bringIn, bringInCounts, BATCH, type BringInSource } from "@/server/crm/bring-in";
import { bulkTrash, bulkUpdate, restoreToPoint, undoBatch, type BulkPatch } from "@/server/crm/bulk";
import { createCompany, restoreCompanies } from "@/server/crm/companies";
import { convertDatabase, previewConvert, type ConvertPreview, type ConvertResult } from "@/server/crm/convert";
import { addCrmField, deleteCrmField, updateCrmField } from "@/server/crm/databases";
import { addDealPerson, createDeal, moveDeal, removeDealPerson, restoreDeals, type MoveResult } from "@/server/crm/deals";
import { resolveDuplicate, scanDuplicates } from "@/server/crm/dedupe";
import { saveForm } from "@/server/crm/forms";
import { startImport, type ImportLog } from "@/server/crm/import";
import { mergeCompanies, mergePeople } from "@/server/crm/merge";
import { createPerson, restorePeople } from "@/server/crm/people";
import { archivePipeline, createPipeline, saveStages, updatePipeline, type PipelineSettingsInput, type StageInput } from "@/server/crm/pipelines";
import { runSetup, type SetupResult } from "@/server/crm/setup";
import { saveRelationshipTypes, setManagers, setMemberAccess, setRequired } from "@/server/crm/settings";
import { PIPELINE_TEMPLATES, type SetupKind } from "@/lib/crm/templates";
import { AppError } from "@/server/db/errors";
import { SpaceRefusedError, withOrgAction, type OrgContext } from "@/server/db/context";
import { enqueueJob } from "@/server/jobs/enqueue";

/**
 * The CRM's Server Actions. Each runs in one withOrgAction transaction as
 * the member (RLS decides), checks the CRM is added and on the plan, and
 * answers { ok: true, ... } or { ok: false, error }. A refusal throws
 * inside the transaction, so it rolls back whatever the action wrote first
 * and nothing half-done is kept; the error is turned into words here.
 */

export type CrmResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string; fields?: string[] };

function crmAction<Args extends unknown[], T extends object>(
  handler: (ctx: OrgContext, ...args: Args) => Promise<T>,
): (organizationId: string, ...args: Args) => Promise<CrmResult<T>> {
  const inner = withOrgAction(
    async (ctx: OrgContext, ...args: Args) => {
      await requireCrm(ctx);
      return handler(ctx, ...args);
    },
    { feature: "crm" },
  );
  return async (organizationId, ...args) => {
    try {
      const result = await inner(organizationId, ...args);
      return { ok: true, ...result } as CrmResult<T>;
    } catch (error) {
      if (error instanceof CrmError || error instanceof CrmValidationError) {
        return { ok: false, error: error.message, fields: error.fields };
      }
      if (error instanceof SpaceRefusedError) return { ok: false, error: error.message };
      if (error instanceof ForbiddenError) return { ok: false, error: "You can't change that." };
      if (error instanceof NotFoundError) return { ok: false, error: "That isn't here any more." };
      if (error instanceof AppError) return { ok: false, error: error.message };
      console.error("[crm] action failed", error instanceof Error ? error.message : error);
      return { ok: false, error: "That didn't work. Try again." };
    }
  };
}

// ---- Setup ------------------------------------------------------------------------

export const runSetupAction = crmAction(
  async (ctx, kinds: string[]): Promise<{ result: SetupResult }> => ({ result: await runSetup(ctx, kinds) }),
);

/** Brings in members, check-ins or form respondents: a turn now, the rest as a job. */
export const bringInAction = crmAction(async (ctx, source: BringInSource) => {
  if (!["members", "contacts", "forms"].includes(source)) throw new CrmError("Pick what to bring in.");
  const counts = await bringInCounts(ctx.db, ctx.organizationId);
  const waiting = counts[source];
  if (waiting > BATCH) {
    await enqueueJob(ctx.db, {
      orgId: ctx.organizationId,
      kind: "crm-import",
      key: `bring:${source}`,
      payload: { bringIn: source, userId: ctx.userId },
    });
    return { added: 0, linked: 0, queued: waiting };
  }
  const r = await bringIn(ctx, source);
  await enqueueJob(ctx.db, { orgId: ctx.organizationId, kind: "crm-refresh", key: ctx.organizationId, payload: {} });
  return { added: r.added, linked: r.linked, queued: 0 };
});

// ---- Records ------------------------------------------------------------------------

export interface QuickPerson {
  name?: string;
  primaryEmail?: string;
  phone?: string;
  title?: string;
  companyName?: string;
  companyId?: string;
  relationship?: string;
}

export const createPersonAction = crmAction(async (ctx, input: QuickPerson) => {
  const { id } = await createPerson(ctx, {
    name: input.name,
    primaryEmail: input.primaryEmail,
    phone: input.phone,
    title: input.title,
    companyName: input.companyId ? undefined : input.companyName,
    companyId: input.companyId,
    relationship: input.relationship || undefined,
    source: "manual",
  });
  await enqueueJob(ctx.db, {
    orgId: ctx.organizationId,
    kind: "crm-refresh",
    key: `p:${id}`,
    payload: { personId: id },
  });
  return { id };
});

export const createCompanyAction = crmAction(
  async (ctx, input: { name: string; domain?: string; website?: string; industry?: string }) =>
    createCompany(ctx, { ...input }),
);

export const createDealAction = crmAction(
  async (
    ctx,
    input: {
      pipelineId: string;
      stageId?: string;
      title: string;
      amount?: string | number | null;
      companyId?: string | null;
      primaryPersonId?: string | null;
      nextStep?: string | null;
      expectedOn?: string | null;
    },
  ) => createDeal(ctx, { ...input, source: "manual" }),
);

export const saveRecordAction = crmAction(
  async (ctx, kind: "person" | "company" | "deal", id: string, patch: Record<string, unknown>) =>
    saveForm(ctx, kind, id, patch),
);

export const moveDealAction = crmAction(
  async (
    ctx,
    dealId: string,
    input: {
      stageId: string;
      beforeId?: string | null;
      afterId?: string | null;
      closeReason?: string | null;
      fill?: Record<string, unknown>;
    },
  ): Promise<MoveResult> => {
    const fill = input.fill
      ? (Object.fromEntries(
          Object.entries(input.fill).map(([k, v]) =>
            k.startsWith("custom.") ? [k, v] : [k === "amount" ? "amount" : k, v === "" ? null : v],
          ),
        ) as Record<string, unknown>)
      : undefined;
    const custom = fill
      ? Object.fromEntries(Object.entries(fill).filter(([k]) => k.startsWith("custom.")).map(([k, v]) => [k.slice(7), v]))
      : {};
    const builtins = fill ? Object.fromEntries(Object.entries(fill).filter(([k]) => !k.startsWith("custom."))) : {};
    return moveDeal(ctx, dealId, {
      stageId: input.stageId,
      beforeId: input.beforeId,
      afterId: input.afterId,
      closeReason: input.closeReason,
      fill: fill ? { ...builtins, ...(Object.keys(custom).length ? { custom } : {}) } : undefined,
    });
  },
);

export const addDealPersonAction = crmAction(async (ctx, dealId: string, personId: string, role?: string) => {
  await addDealPerson(ctx, dealId, personId, role ?? null);
  return {};
});

export const removeDealPersonAction = crmAction(async (ctx, dealId: string, personId: string) => {
  await removeDealPerson(ctx, dealId, personId);
  return {};
});

const LOGGABLE: CrmActivityKind[] = ["NOTE", "CALL", "EMAIL", "MEETING", "TEXT", "TASK"];

export const logActivityAction = crmAction(
  async (
    ctx,
    input: {
      kind: CrmActivityKind;
      subject?: string;
      body?: string;
      occurredAt?: string;
      direction?: "INBOUND" | "OUTBOUND";
      targets: { kind: "person" | "company" | "deal"; id: string }[];
    },
  ) => {
    if (!LOGGABLE.includes(input.kind)) throw new CrmError("Pick what happened.");
    if (!input.subject?.trim() && !input.body?.trim()) throw new CrmError("Write what happened.");
    if (input.targets.length === 0 || input.targets.length > 20) throw new CrmError("Pick who it was with.");
    // Every target must be a record of this organization the member can see.
    for (const t of input.targets) {
      const found =
        t.kind === "person"
          ? await ctx.db.crmPerson.findFirst({ where: { id: t.id, organizationId: ctx.organizationId }, select: { id: true } })
          : t.kind === "company"
            ? await ctx.db.crmCompany.findFirst({ where: { id: t.id, organizationId: ctx.organizationId }, select: { id: true } })
            : await ctx.db.crmDeal.findFirst({ where: { id: t.id, organizationId: ctx.organizationId }, select: { id: true } });
      if (!found) throw new CrmError("One of them isn't in the CRM any more.");
    }
    const at = input.occurredAt ? new Date(input.occurredAt) : new Date();
    if (Number.isNaN(at.getTime())) throw new CrmError("Pick a real date.");
    const id = await logActivity(ctx.db, {
      organizationId: ctx.organizationId,
      kind: input.kind,
      subject: input.subject?.trim() || null,
      body: input.body?.trim() || null,
      occurredAt: at,
      direction: input.direction ?? null,
      targets: input.targets,
      actorId: ctx.userId,
      createdById: ctx.userId,
    });
    // A note or a call may change a person's biggest issue (asked again only when it did).
    if (input.kind === "NOTE" || input.kind === "CALL" || input.kind === "MEETING" || input.direction === "INBOUND") {
      await queueIssueRefresh(ctx.db, ctx.organizationId, input.targets.filter((t) => t.kind === "person").map((t) => t.id), ctx.userId);
    }
    return { id };
  },
);

export const loadTimelineAction = crmAction(
  async (ctx, target: { kind: "person" | "company" | "deal"; id: string }, before: string): Promise<{ entries: TimelineEntry[] }> => ({
    entries: await timeline(ctx.db, ctx.organizationId, target, { before: new Date(before), take: 50 }),
  }),
);

// ---- Lists: bulk, trash, undo ---------------------------------------------------------

export const bulkUpdateAction = crmAction(
  async (ctx, kind: "person" | "company" | "deal", ids: string[], patch: BulkPatch) => bulkUpdate(ctx, kind, ids, patch),
);

export const trashAction = crmAction(async (ctx, kind: "person" | "company" | "deal", ids: string[]) =>
  bulkTrash(ctx, kind, ids),
);

export const restoreAction = crmAction(async (ctx, kind: "person" | "company" | "deal", ids: string[]) => ({
  count:
    kind === "person"
      ? await restorePeople(ctx, ids)
      : kind === "company"
        ? await restoreCompanies(ctx, ids)
        : await restoreDeals(ctx, ids),
}));

export const undoAction = crmAction(async (ctx, batchId: string) => undoBatch(ctx, batchId));

export const restoreToPointAction = crmAction(
  async (ctx, kind: "person" | "company" | "deal", id: string, at: string) => {
    const when = new Date(at);
    if (Number.isNaN(when.getTime())) throw new CrmError("Pick a point in its history.");
    return restoreToPoint(ctx, kind, id, when);
  },
);

// ---- Duplicates and merging ---------------------------------------------------------

export const mergeAction = crmAction(async (ctx, kind: "person" | "company", keepId: string, dropId: string) => {
  const r = kind === "person" ? await mergePeople(ctx, keepId, dropId) : await mergeCompanies(ctx, keepId, dropId);
  return { conflicts: r.conflicts.length, moved: r.moved, undoId: r.undoId };
});

export const resolveDuplicateAction = crmAction(
  async (ctx, suggestionId: string, decision: { accept: false } | { accept: true; keepId: string }) => {
    await resolveDuplicate(ctx, suggestionId, decision);
    return {};
  },
);

export const scanDuplicatesAction = crmAction(async (ctx) => scanDuplicates(ctx.db, ctx.organizationId, ctx.userId));

// ---- Pickers ------------------------------------------------------------------------

export interface PickerHit {
  id: string;
  label: string;
  sub: string | null;
}

export const searchCrmAction = crmAction(
  async (ctx, kind: "person" | "company" | "deal", q: string): Promise<{ hits: PickerHit[] }> => {
    const term = q.trim().slice(0, 80);
    const { db, organizationId } = ctx;
    if (kind === "person") {
      const rows = await db.crmPerson.findMany({
        where: {
          organizationId,
          deletedAt: null,
          ...(term
            ? {
                OR: [
                  { name: { contains: term, mode: "insensitive" } },
                  { emails: { some: { email: { contains: term.toLowerCase() } } } },
                ],
              }
            : {}),
        },
        orderBy: term ? { name: "asc" } : { updatedAt: "desc" },
        take: 12,
        select: { id: true, name: true, primaryEmail: true, title: true },
      });
      return { hits: rows.map((r) => ({ id: r.id, label: r.name, sub: r.primaryEmail ?? r.title })) };
    }
    if (kind === "company") {
      const rows = await db.crmCompany.findMany({
        where: {
          organizationId,
          deletedAt: null,
          ...(term
            ? { OR: [{ name: { contains: term, mode: "insensitive" } }, { domain: { contains: term.toLowerCase() } }] }
            : {}),
        },
        orderBy: term ? { name: "asc" } : { updatedAt: "desc" },
        take: 12,
        select: { id: true, name: true, domain: true },
      });
      return { hits: rows.map((r) => ({ id: r.id, label: r.name, sub: r.domain })) };
    }
    const rows = await db.crmDeal.findMany({
      where: { organizationId, deletedAt: null, ...(term ? { title: { contains: term, mode: "insensitive" } } : {}) },
      orderBy: { updatedAt: "desc" },
      take: 12,
      select: { id: true, title: true, pipeline: { select: { name: true } } },
    });
    return { hits: rows.map((r) => ({ id: r.id, label: r.title, sub: r.pipeline.name })) };
  },
);

// ---- Settings ------------------------------------------------------------------------

export const setAccessAction = crmAction(async (ctx, mode: "ALL" | "OWN") => {
  await setMemberAccess(ctx, mode);
  return {};
});

export const setManagersAction = crmAction(async (ctx, userIds: string[]) => {
  await setManagers(ctx, userIds);
  return {};
});

export const saveRelationshipTypesAction = crmAction(async (ctx, types: RelationshipType[]) => {
  await saveRelationshipTypes(ctx, types);
  return {};
});

export const createPipelineAction = crmAction(
  async (ctx, input: { name: string; itemNoun: string; template?: SetupKind | null; hasAmount?: boolean }) => ({
    id: await createPipeline(ctx, {
      name: input.name,
      itemNoun: input.itemNoun,
      template: input.template ? (PIPELINE_TEMPLATES[input.template] ?? null) : null,
      hasAmount: input.hasAmount,
    }),
  }),
);

export const updatePipelineAction = crmAction(async (ctx, pipelineId: string, input: PipelineSettingsInput) => {
  await updatePipeline(ctx, pipelineId, input);
  return {};
});

export const archivePipelineAction = crmAction(async (ctx, pipelineId: string) => {
  await archivePipeline(ctx, pipelineId);
  return {};
});

export const saveStagesAction = crmAction(
  async (
    ctx,
    pipelineId: string,
    stages: { id?: string; name: string; kind: CrmStageKind; probability?: number | null; stuckAfterDays?: number | null; requiredFields?: string[] }[],
  ) => {
    await saveStages(ctx, pipelineId, stages as StageInput[]);
    return {};
  },
);

export const addFieldAction = crmAction(
  async (ctx, target: { object: CrmObject; pipelineId?: string | null }, input: { name: string; type: string; options?: unknown }) => ({
    field: await addCrmField(ctx, target, input),
  }),
);

export const updateFieldAction = crmAction(async (ctx, fieldId: string, input: { name?: string; options?: unknown }) => {
  await updateCrmField(ctx, fieldId, input);
  return {};
});

export const deleteFieldAction = crmAction(async (ctx, fieldId: string) => {
  await deleteCrmField(ctx, fieldId);
  return {};
});

export const setRequiredAction = crmAction(async (ctx, databaseId: string, key: string, required: boolean) => {
  await setRequired(ctx, databaseId, key, required);
  return {};
});

// ---- Import and turning a database into records ----------------------------------------

export const startImportAction = crmAction(
  async (
    ctx,
    importId: string,
    input: { object: CrmObject; mapping: Mapping; pipelineId?: string | null; remember?: boolean },
  ): Promise<{ log: ImportLog }> => ({ log: await startImport(ctx, importId, input) }),
);

export const previewConvertAction = crmAction(
  async (ctx, databaseId: string, object: CrmObject): Promise<{ preview: ConvertPreview }> => ({
    preview: await previewConvert(ctx, databaseId, object),
  }),
);

export const convertDatabaseAction = crmAction(
  async (ctx, databaseId: string, input: { object: CrmObject; mapping: Mapping }): Promise<{ result: ConvertResult }> => ({
    result: await convertDatabase(ctx, databaseId, input),
  }),
);
