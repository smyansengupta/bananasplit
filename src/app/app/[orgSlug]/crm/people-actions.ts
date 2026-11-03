"use server";

import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import { requireUser } from "@/lib/auth/session";
import type { MergeField } from "@/lib/crm/people-view";
import { AiImportError } from "@/server/ai/generate";
import { CrmError } from "@/server/crm/access";
import { AiCapError, NoAiConnectionError } from "@/server/crm/ai";
import { memberWho } from "@/server/crm/ai-tx";
import { readContact } from "@/server/crm/assist";
import { createCompany, updateCompany } from "@/server/crm/companies";
import { createDeal } from "@/server/crm/deals";
import { likelyExisting, type MergePayload } from "@/server/crm/dedupe";
import { mergeCompanies, mergePeople } from "@/server/crm/merge";
import { viewIds } from "@/server/crm/outreach/lists";
import { createPerson, updatePerson } from "@/server/crm/people";
import { enqueueJob } from "@/server/jobs/enqueue";

import { crmAction, toResult } from "./run";

/**
 * The People tab's own actions (docs/features/crm.md, "Redesign"): a next
 * step in one click, hand-picked lists (Add to list), the Merge card and
 * Keep both, the New card's create, its "already here" check and its
 * paste-a-signature fill. The rest (owner, trash, undo) are the CRM's
 * shared actions in ./actions.ts.
 */

const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const ids = z.array(id).min(1).max(500);
const DAY = 86_400_000;
/** Most people a hand-picked list holds. */
const MAX_PICKED = 2000;

/** "Add a next step": a follow-up a week out (or `days`), on a person or a company. */
export const setNextStepAction = crmAction(
  async (ctx, _a, kind: "person" | "company", recordId: string, days: number = 7) => {
    const at = new Date(Date.now() + Math.max(1, Math.min(365, Math.round(days))) * DAY);
    at.setUTCHours(15, 0, 0, 0);
    if (kind === "person") await updatePerson(ctx, id.parse(recordId), { nextFollowUpAt: at });
    else await updateCompany(ctx, id.parse(recordId), { nextFollowUpAt: at });
    return { at: at.toISOString() };
  },
);

/**
 * Add to list: picked people onto one of the organization's hand-picked
 * lists, or a new one (`name`). A list made of filters can't take people by
 * hand: it already holds whoever matches.
 */
export const addToListAction = crmAction(
  async (ctx, _a, target: { viewId: string } | { name: string }, personIds: string[]) => {
    const picked = ids.parse(personIds);
    const { db, organizationId, userId } = ctx;
    if ("name" in target) {
      const name = z.string().trim().min(1).max(80).safeParse(target.name);
      if (!name.success) throw new CrmError("Give the list a name.", ["name"]);
      const view = await db.crmView.create({
        data: {
          organizationId,
          objectKind: "people",
          name: name.data,
          filters: [{ col: "people", op: "in", value: [...new Set(picked)] }] as Prisma.InputJsonArray,
          shared: true,
          createdById: userId,
        },
        select: { id: true, name: true },
      });
      return { id: view.id, name: view.name, added: picked.length };
    }
    const view = await db.crmView.findFirst({
      where: { id: id.parse(target.viewId), organizationId, objectKind: "people" },
      select: { id: true, name: true, filters: true },
    });
    if (!view) throw new CrmError("That list isn't here any more.");
    const current = viewIds(view.filters);
    if (current === undefined) {
      throw new CrmError(`${view.name} is made of filters, so it already holds whoever matches.`);
    }
    const next = [...new Set([...current, ...picked])];
    if (next.length > MAX_PICKED) throw new CrmError(`A list holds up to ${MAX_PICKED} people.`);
    const filters = (Array.isArray(view.filters) ? view.filters : []).map((f) =>
      f && typeof f === "object" && (f as { col?: string }).col === "people"
        ? { col: "people", op: "in", value: next }
        : f,
    );
    await db.crmView.update({
      where: { id: view.id },
      data: { filters: filters as Prisma.InputJsonArray },
      select: { id: true },
    });
    return { id: view.id, name: view.name, added: next.length - current.length };
  },
);

/** Takes people back off a hand-picked list (Undo for Add to list). */
export const removeFromListAction = crmAction(async (ctx, _a, viewId: string, personIds: string[]) => {
  const drop = new Set(ids.parse(personIds));
  const view = await ctx.db.crmView.findFirst({
    where: { id: id.parse(viewId), organizationId: ctx.organizationId, objectKind: "people" },
    select: { id: true, filters: true },
  });
  const current = view ? viewIds(view.filters) : undefined;
  if (!view || current === undefined) return { removed: 0 };
  const filters = (Array.isArray(view.filters) ? view.filters : []).map((f) =>
    f && typeof f === "object" && (f as { col?: string }).col === "people"
      ? { col: "people", op: "in", value: current.filter((p) => !drop.has(p)) }
      : f,
  );
  await ctx.db.crmView.update({ where: { id: view.id }, data: { filters: filters as Prisma.InputJsonArray } });
  return { removed: current.filter((p) => drop.has(p)).length };
});

/**
 * The Merge card: `dropId` merges into `keepId` (everything moves, the
 * duplicate goes to the trash), then the fields picked from the duplicate
 * are written over the kept one. An email not kept stays as an extra.
 */
export const mergeRecordsAction = crmAction(
  async (
    ctx,
    _a,
    kind: "person" | "company",
    keepId: string,
    dropId: string,
    patch: Partial<Record<MergeField, string | null>>,
  ) => {
    const keep = id.parse(keepId);
    const drop = id.parse(dropId);
    if (kind === "company") {
      const r = await mergeCompanies(ctx, keep, drop);
      const kept = await ctx.db.crmCompany.findFirst({ where: { id: keep }, select: { name: true } });
      return { name: kept?.name ?? "", moved: r.moved.timeline ?? 0, deals: r.moved.items ?? 0 };
    }
    const r = await mergePeople(ctx, keep, drop);
    const input: Parameters<typeof updatePerson>[2] = {};
    if ("phone" in patch) input.phone = patch.phone ?? null;
    if ("companyId" in patch) input.companyId = patch.companyId ?? null;
    if ("ownerId" in patch) {
      input.ownerId = patch.ownerId ?? null;
      input.ownerRoleKey = null;
    }
    if ("primaryEmail" in patch && patch.primaryEmail) {
      const all = await ctx.db.crmPersonEmail.findMany({
        where: { organizationId: ctx.organizationId, personId: keep },
        select: { email: true },
      });
      input.primaryEmail = patch.primaryEmail;
      input.otherEmails = all.map((e) => e.email).filter((e) => e !== patch.primaryEmail);
    }
    if (Object.keys(input).length) await updatePerson(ctx, keep, input, { source: "merge" });
    const kept = await ctx.db.crmPerson.findFirst({ where: { id: keep }, select: { name: true } });
    return { name: kept?.name ?? "", moved: r.moved.timeline ?? 0, deals: r.moved.items ?? 0 };
  },
);

/**
 * Keep both: the two aren't the same. A pending suggestion for the pair is
 * turned down; with none, one is written as turned down, so the nightly
 * scan never suggests them again.
 */
export const keepBothAction = crmAction(async (ctx, _a, kind: "person" | "company", a: string, b: string) => {
  const pair = [id.parse(a), id.parse(b)].sort() as [string, string];
  const { db, organizationId, userId } = ctx;
  const pending = await db.crmSuggestion.findMany({
    where: { organizationId, kind: "MERGE", status: "PENDING", targetKind: kind },
    select: { id: true, payload: true },
    take: 2000,
  });
  const hit = pending.find((s) => {
    const p = s.payload as unknown as MergePayload | null;
    return p?.ids?.length === 2 && [...p.ids].sort().join("|") === pair.join("|");
  });
  if (hit) {
    await db.crmSuggestion.update({
      where: { id: hit.id },
      data: { status: "REJECTED", reviewedById: userId, reviewedAt: new Date() },
    });
    return {};
  }
  const payload: MergePayload = { object: kind, ids: pair, score: 0, reasons: ["Kept apart by hand"] };
  await db.crmSuggestion.create({
    data: {
      organizationId,
      kind: "MERGE",
      source: "DEDUPE",
      status: "REJECTED",
      title: "Kept apart",
      summary: "Marked as different from the Merge card.",
      payload: payload as unknown as Prisma.InputJsonObject,
      targetKind: kind,
      targetId: pair[0],
      proposedById: userId,
      reviewedById: userId,
      reviewedAt: new Date(),
    },
  });
  return {};
});

/** The New card's "already here" line, as the name, address, number or website is typed. */
export const likelyExistingAction = crmAction(
  async (
    ctx,
    _a,
    draft:
      | { kind: "person"; name: string; email?: string | null; phone?: string | null }
      | { kind: "company"; name: string; domain?: string | null },
  ) => {
    const clean = {
      ...draft,
      name: String(draft.name ?? "").slice(0, 200),
    } as typeof draft;
    return { match: await likelyExisting(ctx.db, ctx.organizationId, clean) };
  },
);

export interface NewPersonInput {
  name?: string;
  primaryEmail?: string;
  phone?: string;
  title?: string;
  companyId?: string | null;
  companyName?: string | null;
  website?: string | null;
  relationship?: string | null;
  /** A member, or "" for nobody; left out, the one creating it. */
  ownerId?: string | null;
}

/** New person from the New card, with its owner. */
export const newPersonAction = crmAction(async (ctx, _a, input: NewPersonInput) => {
  const { id: personId } = await createPerson(ctx, {
    name: input.name,
    primaryEmail: input.primaryEmail,
    phone: input.phone,
    title: input.title,
    companyId: input.companyId || undefined,
    companyName: input.companyId ? undefined : input.companyName || undefined,
    website: input.website || undefined,
    relationship: input.relationship || undefined,
    ...(input.ownerId !== undefined ? { ownerId: input.ownerId || null } : {}),
    source: "manual",
  });
  await enqueueJob(ctx.db, {
    orgId: ctx.organizationId,
    kind: "crm-refresh",
    key: `p:${personId}`,
    payload: { personId },
  });
  return { id: personId };
});

/** New company from the New card. */
export const newCompanyAction = crmAction(
  async (ctx, _a, input: { name: string; website?: string | null; ownerId?: string | null }) => {
    const site = (input.website ?? "").trim();
    const domain = site
      ? site.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0]!.toLowerCase()
      : undefined;
    return createCompany(ctx, {
      name: input.name,
      domain,
      website: site || undefined,
      ...(input.ownerId !== undefined ? { ownerId: input.ownerId || null } : {}),
    });
  },
);

/** New deal from the New card: the people picked on People come along. */
export const newDealAction = crmAction(
  async (
    ctx,
    _a,
    input: {
      pipelineId: string;
      stageId?: string | null;
      title: string;
      amount?: string | null;
      expectedOn?: string | null;
      companyId?: string | null;
      people?: string[];
      ownerId?: string | null;
    },
  ) => {
    const people = input.people?.length ? ids.parse(input.people) : [];
    return createDeal(ctx, {
      pipelineId: id.parse(input.pipelineId),
      stageId: input.stageId ? id.parse(input.stageId) : undefined,
      title: input.title,
      amount: input.amount || null,
      expectedOn: input.expectedOn || null,
      companyId: input.companyId || null,
      primaryPersonId: people[0] ?? null,
      people,
      ...(input.ownerId !== undefined ? { ownerId: input.ownerId || null } : {}),
      source: "manual",
    });
  },
);

export type FillResult =
  | {
      ok: true;
      name: string | null;
      title: string | null;
      company: string | null;
      email: string | null;
      phone: string | null;
      website: string | null;
    }
  | { ok: false; error: string; code?: "no-connection" | "cap" | "limit" };

/**
 * A pasted signature, read by the organization's own AI to fill the New
 * card. Nothing is written. "no-connection" tells the card to read it
 * without AI instead.
 */
export async function readSignatureAction(orgId: string, text: string): Promise<FillResult> {
  try {
    const user = await requireUser();
    const r = await readContact(memberWho(id.parse(orgId), user.id), {
      text: z.string().max(4000).parse(text),
    });
    return {
      ok: true,
      name: r.name,
      title: r.title,
      company: r.company,
      email: r.email,
      phone: r.phone,
      website: r.website,
    };
  } catch (error) {
    if (error instanceof NoAiConnectionError) return { ok: false, error: error.message, code: "no-connection" };
    if (error instanceof AiCapError) return { ok: false, error: error.message, code: "cap" };
    if (error instanceof AiImportError) {
      return { ok: false, error: error.message, code: error.status === 429 ? "limit" : undefined };
    }
    if (error instanceof z.ZodError) return { ok: false, error: "That's too long to read." };
    return toResult(error);
  }
}
