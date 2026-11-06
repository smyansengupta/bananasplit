import { z } from "zod";

import type { CrmActivityKind, Prisma, Role } from "@/generated/prisma/client";
import { CrmValidationError } from "@/lib/crm/validate";
import { withSystemOrgTx, type TxClient } from "@/server/db/context";

import { CrmError, type CrmActor } from "../access";
import { logActivity, type ActivityTarget } from "../activity";
import { createCompany, restoreCompanies, trashCompanies, updateCompany } from "../companies";
import { createDeal, moveDeal, restoreDeals, trashDeals, updateDeal } from "../deals";
import { createPerson, restorePeople, trashPeople, updatePerson } from "../people";
import type { VerifiedKey } from "./keys";
import { afterCursor, CursorError, decodeCursor, NEWEST_FIRST, page, parseLimit } from "./pagination";
import {
  ACTIVITY_API_SELECT,
  activityJson,
  COMPANY_API_SELECT,
  companyJson,
  ITEM_API_SELECT,
  itemJson,
  loadJson,
  PERSON_API_SELECT,
  personJson,
  PIPELINE_API_SELECT,
  pipelineJson,
} from "./serialize";

/**
 * The public CRM API, /api/crm/v1/... (docs/features/crm.md module 11;
 * the OpenAPI document is ./openapi.ts). Each request has been checked by
 * the route (the key, its rate limit) and runs here in ONE service
 * transaction in the key's organization (withSystemOrgTx: RLS keeps it to
 * that organization), as the organization rather than a member: field
 * history says source "api", owners default to none, and nothing is ever
 * hard-deleted (`trashed: true` moves a record to the CRM's trash, `false`
 * restores it). Writes go through the same services as the app, so
 * required fields, stage rules, dedupe on email and domain, the timeline
 * and the event bus (workflows, webhooks) all behave the same.
 */

export interface ApiResponse {
  status: number;
  body: unknown;
}

export function apiError(status: number, code: string, message: string, fields?: string[]): ApiResponse {
  return { status, body: { error: { code, message, ...(fields?.length ? { fields } : {}) } } };
}

class ApiInputError extends Error {
  constructor(
    message: string,
    readonly fields: string[] = [],
  ) {
    super(message);
  }
}

const OPTS = { source: "api" as const, trusted: true };

/** The organization acting through a key: no member, so no owner by default and no finance role. */
function apiActor(db: TxClient, organizationId: string): CrmActor {
  // userId is null on the service path: records the API makes have no
  // creator or owner unless the request names one, and history shows "api".
  return { db, organizationId, userId: null as unknown as string, role: "MEMBER" as Role };
}

const ID = /^[A-Za-z0-9_-]{1,100}$/;
const idParam = z.string().regex(ID);
const date = z.union([z.iso.datetime({ offset: true }), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).nullable();
const text = (max: number) => z.string().max(max).nullable();

const personBody = z
  .object({
    name: text(200),
    firstName: text(100),
    lastName: text(100),
    email: text(254),
    emails: z.array(z.string().max(254)).max(20),
    phone: text(60),
    title: text(200),
    companyId: idParam.nullable(),
    companyName: text(200),
    linkedinUrl: text(500),
    website: text(500),
    location: text(200),
    relationship: text(64),
    status: z.enum(["ACTIVE", "INACTIVE", "ALUMNI"]),
    ownerId: idParam.nullable(),
    source: text(100),
    nextFollowUpAt: date,
    keepInTouchDays: z.number().int().min(1).max(3650).nullable(),
    doNotContact: z.boolean(),
    custom: z.record(z.string().max(100), z.unknown()),
    trashed: z.boolean(),
  })
  .partial()
  .strict();

const companyBody = z
  .object({
    name: text(200),
    domain: text(253),
    website: text(500),
    industry: text(200),
    size: text(60),
    phone: text(60),
    address: text(500),
    description: text(5000),
    status: z.enum(["ACTIVE", "INACTIVE", "ALUMNI"]),
    ownerId: idParam.nullable(),
    nextFollowUpAt: date,
    custom: z.record(z.string().max(100), z.unknown()),
    trashed: z.boolean(),
  })
  .partial()
  .strict();

const itemBody = z
  .object({
    pipelineId: idParam,
    stageId: idParam,
    title: text(300),
    amountCents: z.number().int().min(0).max(10_000_000_000).nullable(),
    expectedOn: date,
    ownerId: idParam.nullable(),
    companyId: idParam.nullable(),
    primaryPersonId: idParam.nullable(),
    personIds: z.array(idParam).max(50),
    nextStep: text(500),
    nextStepAt: date,
    forecastCategory: z.enum(["PIPELINE", "BEST_CASE", "COMMIT", "OMITTED"]),
    closeReason: text(2000),
    source: text(100),
    custom: z.record(z.string().max(100), z.unknown()),
    trashed: z.boolean(),
  })
  .partial()
  .strict();

const ACTIVITY_KINDS = ["NOTE", "CALL", "EMAIL", "MEETING", "TEXT", "TASK"] as const;

const activityBody = z
  .object({
    kind: z.enum(ACTIVITY_KINDS),
    subject: text(500),
    body: text(20_000),
    occurredAt: z.iso.datetime({ offset: true }),
    direction: z.enum(["INBOUND", "OUTBOUND"]).nullable(),
    targets: z
      .array(z.object({ kind: z.enum(["person", "company", "item"]), id: idParam }).strict())
      .min(1)
      .max(20),
    /** Your own id for it: sending the same one again updates instead of adding. */
    externalId: z.string().regex(/^[A-Za-z0-9_.:-]{1,120}$/),
    trashed: z.boolean(),
  })
  .partial()
  .strict();

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body ?? {});
  if (!r.success) {
    const issue = r.error.issues[0];
    const field = issue?.path.join(".") ?? "";
    throw new ApiInputError(
      issue?.code === "unrecognized_keys"
        ? `Unknown field: ${(issue as { keys?: string[] }).keys?.join(", ")}.`
        : `${field || "The body"}: ${issue?.message ?? "isn't valid"}.`,
      field ? [field] : [],
    );
  }
  return r.data;
}

function dollars(cents: number | null | undefined): number | null | undefined {
  return cents === undefined ? undefined : cents === null ? null : cents / 100;
}

function since(raw: string | null, name: string): Date | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw new ApiInputError(`${name} must be an ISO date or time.`, [name]);
  return d;
}

function bool(raw: string | null): boolean | undefined {
  return raw === "true" ? true : raw === "false" ? false : undefined;
}

function oneId(q: URLSearchParams, name: string): string | undefined {
  const v = q.get(name);
  if (v === null) return undefined;
  if (!ID.test(v)) throw new ApiInputError(`${name} isn't an id.`, [name]);
  return v;
}

// ---- Lists -----------------------------------------------------------------------------

async function listPeople(db: TxClient, orgId: string, q: URLSearchParams) {
  const limit = parseLimit(q.get("limit"));
  const trashed = bool(q.get("trashed")) ?? false;
  const where: Prisma.CrmPersonWhereInput = {
    AND: [
      { organizationId: orgId, deletedAt: trashed ? { not: null } : null },
      q.get("email") ? { emails: { some: { email: q.get("email")!.trim().toLowerCase() } } } : {},
      q.get("q")
        ? {
            OR: [
              { name: { contains: q.get("q")!.slice(0, 100), mode: "insensitive" } },
              { emails: { some: { email: { contains: q.get("q")!.slice(0, 100).toLowerCase() } } } },
            ],
          }
        : {},
      oneId(q, "companyId") ? { companyId: oneId(q, "companyId") } : {},
      oneId(q, "ownerId") ? { ownerId: oneId(q, "ownerId") } : {},
      q.get("status") ? { status: z.enum(["ACTIVE", "INACTIVE", "ALUMNI"]).parse(q.get("status")) } : {},
      q.get("relationship") ? { relationship: q.get("relationship")!.slice(0, 64) } : {},
      since(q.get("updatedSince"), "updatedSince") ? { updatedAt: { gte: since(q.get("updatedSince"), "updatedSince") } } : {},
      since(q.get("createdSince"), "createdSince") ? { createdAt: { gte: since(q.get("createdSince"), "createdSince") } } : {},
      afterCursor(decodeCursor(q.get("cursor"))),
    ],
  };
  const rows = await db.crmPerson.findMany({ where, orderBy: NEWEST_FIRST, take: limit + 1, select: PERSON_API_SELECT });
  const p = page(rows, limit);
  return { object: "list", data: p.rows.map(personJson), hasMore: p.hasMore, nextCursor: p.nextCursor };
}

async function listCompanies(db: TxClient, orgId: string, q: URLSearchParams) {
  const limit = parseLimit(q.get("limit"));
  const trashed = bool(q.get("trashed")) ?? false;
  const where: Prisma.CrmCompanyWhereInput = {
    AND: [
      { organizationId: orgId, deletedAt: trashed ? { not: null } : null },
      q.get("domain") ? { domain: q.get("domain")!.trim().toLowerCase().replace(/^www\./, "") } : {},
      q.get("q") ? { name: { contains: q.get("q")!.slice(0, 100), mode: "insensitive" } } : {},
      oneId(q, "ownerId") ? { ownerId: oneId(q, "ownerId") } : {},
      q.get("status") ? { status: z.enum(["ACTIVE", "INACTIVE", "ALUMNI"]).parse(q.get("status")) } : {},
      since(q.get("updatedSince"), "updatedSince") ? { updatedAt: { gte: since(q.get("updatedSince"), "updatedSince") } } : {},
      afterCursor(decodeCursor(q.get("cursor"))),
    ],
  };
  const rows = await db.crmCompany.findMany({ where, orderBy: NEWEST_FIRST, take: limit + 1, select: COMPANY_API_SELECT });
  const p = page(rows, limit);
  return { object: "list", data: p.rows.map(companyJson), hasMore: p.hasMore, nextCursor: p.nextCursor };
}

async function listItems(db: TxClient, orgId: string, q: URLSearchParams) {
  const limit = parseLimit(q.get("limit"));
  const trashed = bool(q.get("trashed")) ?? false;
  const open = bool(q.get("open"));
  const personId = oneId(q, "personId");
  const where: Prisma.CrmDealWhereInput = {
    AND: [
      { organizationId: orgId, deletedAt: trashed ? { not: null } : null },
      oneId(q, "pipelineId") ? { pipelineId: oneId(q, "pipelineId") } : {},
      oneId(q, "stageId") ? { stageId: oneId(q, "stageId") } : {},
      oneId(q, "companyId") ? { companyId: oneId(q, "companyId") } : {},
      oneId(q, "ownerId") ? { ownerId: oneId(q, "ownerId") } : {},
      personId ? { people: { some: { personId } } } : {},
      open === undefined ? {} : open ? { closedAt: null } : { closedAt: { not: null } },
      since(q.get("updatedSince"), "updatedSince") ? { updatedAt: { gte: since(q.get("updatedSince"), "updatedSince") } } : {},
      afterCursor(decodeCursor(q.get("cursor"))),
    ],
  };
  const rows = await db.crmDeal.findMany({ where, orderBy: NEWEST_FIRST, take: limit + 1, select: ITEM_API_SELECT });
  const p = page(rows, limit);
  return { object: "list", data: p.rows.map(itemJson), hasMore: p.hasMore, nextCursor: p.nextCursor };
}

async function listActivities(db: TxClient, orgId: string, q: URLSearchParams) {
  const limit = parseLimit(q.get("limit"));
  const target = (["personId", "companyId", "itemId"] as const)
    .map((k) => ({ k, id: oneId(q, k) }))
    .find((t) => t.id);
  const kind = q.get("kind");
  if (kind && !(ACTIVITY_KINDS as readonly string[]).concat(["STAGE_CHANGE", "FORM_RESPONSE", "RSVP", "CHECK_IN", "PAYMENT", "SYSTEM", "FIELD_CHANGE", "SEQUENCE_STEP"]).includes(kind)) {
    throw new ApiInputError("kind isn't one we know.", ["kind"]);
  }
  const where: Prisma.CrmActivityWhereInput = {
    AND: [
      { organizationId: orgId, deletedAt: null, privateToId: null },
      target
        ? {
            targets: {
              some: {
                targetKind: target.k === "personId" ? "person" : target.k === "companyId" ? "company" : "deal",
                targetId: target.id,
              },
            },
          }
        : {},
      kind ? { kind: kind as CrmActivityKind } : {},
      since(q.get("since"), "since") ? { occurredAt: { gte: since(q.get("since"), "since") } } : {},
      afterCursor(decodeCursor(q.get("cursor"))),
    ],
  };
  const rows = await db.crmActivity.findMany({ where, orderBy: NEWEST_FIRST, take: limit + 1, select: ACTIVITY_API_SELECT });
  const p = page(rows, limit);
  return { object: "list", data: p.rows.map(activityJson), hasMore: p.hasMore, nextCursor: p.nextCursor };
}

async function listPipelines(db: TxClient, orgId: string, q: URLSearchParams) {
  const archived = bool(q.get("archived")) ?? false;
  const rows = await db.crmPipeline.findMany({
    where: { organizationId: orgId, archivedAt: archived ? { not: null } : null },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    take: 200,
    select: PIPELINE_API_SELECT,
  });
  return { object: "list", data: rows.map(pipelineJson), hasMore: false, nextCursor: null };
}

// ---- Writes ----------------------------------------------------------------------------

async function writePerson(actor: CrmActor, id: string | null, body: unknown) {
  const b = parse(personBody, body);
  const { trashed, email, emails, ...rest } = b;
  const input = {
    ...rest,
    ...(email !== undefined ? { primaryEmail: email } : {}),
    ...(emails !== undefined ? { otherEmails: emails } : {}),
  };
  if (!id) {
    const { id: made } = await createPerson(actor, { ...input, source: input.source ?? "api" }, OPTS);
    return made;
  }
  const exists = await actor.db.crmPerson.findFirst({ where: { id, organizationId: actor.organizationId }, select: { deletedAt: true } });
  if (!exists) return null;
  if (trashed === false && exists.deletedAt) await restorePeople(actor, [id]);
  if (Object.keys(input).length > 0) await updatePerson(actor, id, input, OPTS);
  if (trashed === true && !exists.deletedAt) await trashPeople(actor, [id]);
  return id;
}

async function writeCompany(actor: CrmActor, id: string | null, body: unknown) {
  const { trashed, ...input } = parse(companyBody, body);
  if (!id) return (await createCompany(actor, input, OPTS)).id;
  const exists = await actor.db.crmCompany.findFirst({ where: { id, organizationId: actor.organizationId }, select: { deletedAt: true } });
  if (!exists) return null;
  if (trashed === false && exists.deletedAt) await restoreCompanies(actor, [id]);
  if (Object.keys(input).length > 0) await updateCompany(actor, id, input, OPTS);
  if (trashed === true && !exists.deletedAt) await trashCompanies(actor, [id]);
  return id;
}

async function writeItem(actor: CrmActor, id: string | null, body: unknown) {
  const { trashed, amountCents, personIds, stageId, pipelineId, closeReason, ...rest } = parse(itemBody, body);
  const input = { ...rest, ...(amountCents !== undefined ? { amount: dollars(amountCents) } : {}) };
  if (!id) {
    if (!pipelineId) throw new ApiInputError("pipelineId is required.", ["pipelineId"]);
    return (await createDeal(actor, { ...input, closeReason, pipelineId, stageId, people: personIds }, OPTS)).id;
  }
  const exists = await actor.db.crmDeal.findFirst({
    where: { id, organizationId: actor.organizationId },
    select: { deletedAt: true, pipelineId: true, stageId: true },
  });
  if (!exists) return null;
  if (pipelineId && pipelineId !== exists.pipelineId) throw new ApiInputError("A deal stays in its pipeline.", ["pipelineId"]);
  if (personIds) throw new ApiInputError("Add people to a deal when you make it.", ["personIds"]);
  if (trashed === false && exists.deletedAt) await restoreDeals(actor, [id]);
  if (stageId && stageId !== exists.stageId) {
    const moved = await moveDeal(actor, id, { stageId, closeReason, fill: input }, OPTS);
    if (moved.needs) {
      throw new ApiInputError(`That stage needs: ${moved.needs.labels.join(", ")}.`, moved.needs.keys);
    }
  } else if (Object.keys(input).length > 0 || closeReason !== undefined) {
    await updateDeal(actor, id, { ...input, ...(closeReason !== undefined ? { closeReason } : {}) }, OPTS);
  }
  if (trashed === true && !exists.deletedAt) await trashDeals(actor, [id]);
  return id;
}

async function writeActivity(actor: CrmActor, id: string | null, body: unknown) {
  const b = parse(activityBody, body);
  const { db, organizationId } = actor;
  if (id) {
    const row = await db.crmActivity.findFirst({
      where: { id, organizationId, privateToId: null },
      select: { id: true, sourceKind: true },
    });
    if (!row) return null;
    if (b.kind || b.targets || b.occurredAt || b.direction !== undefined || b.externalId) {
      throw new ApiInputError("Only subject, body and trashed change on an activity.", []);
    }
    await db.crmActivity.update({
      where: { id: row.id },
      data: {
        ...(b.subject !== undefined ? { subject: b.subject?.slice(0, 500) ?? null } : {}),
        ...(b.body !== undefined ? { body: b.body ?? null } : {}),
        ...(b.trashed !== undefined ? { deletedAt: b.trashed ? new Date() : null } : {}),
      },
    });
    return row.id;
  }
  if (!b.kind) throw new ApiInputError("kind is required.", ["kind"]);
  if (!b.targets?.length) throw new ApiInputError("targets is required.", ["targets"]);
  if (!b.subject?.trim() && !b.body?.trim()) throw new ApiInputError("Send a subject or a body.", ["subject"]);
  const targets: ActivityTarget[] = [];
  for (const t of b.targets) {
    const kind = t.kind === "item" ? "deal" : t.kind;
    const found =
      kind === "person"
        ? await db.crmPerson.findFirst({ where: { id: t.id, organizationId }, select: { id: true } })
        : kind === "company"
          ? await db.crmCompany.findFirst({ where: { id: t.id, organizationId }, select: { id: true } })
          : await db.crmDeal.findFirst({ where: { id: t.id, organizationId }, select: { id: true } });
    if (!found) throw new ApiInputError(`No ${t.kind} ${t.id} here.`, ["targets"]);
    targets.push({ kind, id: t.id });
  }
  const at = b.occurredAt ? new Date(b.occurredAt) : new Date();
  return logActivity(db, {
    organizationId,
    kind: b.kind,
    subject: b.subject?.trim() || null,
    body: b.body?.trim() || null,
    direction: b.direction ?? null,
    occurredAt: at,
    targets,
    ...(b.externalId ? { sourceKind: "api", sourceId: b.externalId } : {}),
    meta: { via: "api" },
  });
}

// ---- The router ----------------------------------------------------------------------------

type Resource = "people" | "companies" | "items" | "activities" | "pipelines";

const LOAD_KIND: Record<Exclude<Resource, "pipelines">, "person" | "company" | "deal" | "activity"> = {
  people: "person",
  companies: "company",
  items: "deal",
  activities: "activity",
};

export async function handleApi(
  key: VerifiedKey,
  method: string,
  path: readonly string[],
  query: URLSearchParams,
  body: unknown,
): Promise<ApiResponse> {
  const [resource, id, ...extra] = path;
  if (!resource || extra.length > 0 || !["people", "companies", "items", "activities", "pipelines"].includes(resource)) {
    return apiError(404, "not_found", "There's nothing at that path. See /api/crm/v1/openapi.json.");
  }
  if (id !== undefined && !ID.test(id)) return apiError(404, "not_found", "That id isn't one of ours.");
  const r = resource as Resource;
  const writing = method === "POST" || method === "PATCH";
  if (writing && !key.scopes.includes("write")) return apiError(403, "read_only", "This key can only read.");
  if (!writing && method !== "GET") return apiError(405, "method_not_allowed", `${method} isn't supported here.`);
  if (r === "pipelines" && writing) return apiError(405, "method_not_allowed", "Pipelines are read-only through the API.");
  if (method === "POST" && id) return apiError(405, "method_not_allowed", "POST to the list to make one; PATCH a record to change it.");
  if (method === "PATCH" && !id) return apiError(405, "method_not_allowed", "PATCH a record by its id.");

  const orgId = key.organizationId;
  try {
    return await withSystemOrgTx(orgId, async ({ db }) => {
      if (method === "GET") {
        if (!id) {
          const list =
            r === "people"
              ? await listPeople(db, orgId, query)
              : r === "companies"
                ? await listCompanies(db, orgId, query)
                : r === "items"
                  ? await listItems(db, orgId, query)
                  : r === "activities"
                    ? await listActivities(db, orgId, query)
                    : await listPipelines(db, orgId, query);
          return { status: 200, body: list };
        }
        if (r === "pipelines") {
          const p = await db.crmPipeline.findFirst({ where: { id, organizationId: orgId }, select: PIPELINE_API_SELECT });
          return p ? { status: 200, body: pipelineJson(p) } : apiError(404, "not_found", "No pipeline with that id.");
        }
        const one = await loadJson(db, orgId, LOAD_KIND[r], id);
        return one ? { status: 200, body: one } : apiError(404, "not_found", "Nothing here has that id.");
      }
      const actor = apiActor(db, orgId);
      const write = r === "people" ? writePerson : r === "companies" ? writeCompany : r === "items" ? writeItem : writeActivity;
      const savedId = await write(actor, id ?? null, body);
      if (!savedId) return apiError(404, "not_found", "Nothing here has that id.");
      const saved = await loadJson(db, orgId, LOAD_KIND[r as Exclude<Resource, "pipelines">], savedId);
      return { status: method === "POST" ? 201 : 200, body: saved };
    });
  } catch (error) {
    if (error instanceof ApiInputError) return apiError(422, "invalid", error.message, error.fields);
    if (error instanceof CursorError) return apiError(400, "bad_cursor", error.message);
    if (error instanceof CrmError || error instanceof CrmValidationError) {
      return apiError(422, "invalid", error.message, error.fields);
    }
    if (error instanceof z.ZodError) return apiError(422, "invalid", error.issues[0]?.message ?? "Check the query.");
    throw error;
  }
}
