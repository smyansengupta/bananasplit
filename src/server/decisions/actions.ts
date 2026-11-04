"use server";

import { z } from "zod";

import { runResult } from "@/server/action-result";
import { withOrgAction, type OrgContext } from "@/server/db/context";
import { AppError } from "@/server/db/errors";

import { isHomeLinkKind, refKey, resolveHomeRefs, type HomeLinkRef } from "./linked-refs";
import { canSettle, cleanDecision, cleanOutcome, LINKS_MAX } from "./rules";

/**
 * Decisions on the member path: each action is one withOrgAction
 * transaction (app_user, RLS). Any member raises a decision and takes one
 * nobody owns; deciding, dropping and linking more to an open one are for
 * its owner, whoever raised it, or an owner or admin, so one nobody owns is
 * taken first (the database holds the same rule, app.decision_guard).
 * Links to the meetings, notes, polls and events it came from go through
 * ItemLink (fromKind "decision"), each checked to be something the member
 * can see. Refusals come back as { ok: false, error };
 * changes refresh the page they were made on.
 *
 *   const result = await takeDecision(orgId, decision.id);
 *   if (!result.ok) toast({ title: result.error, tone: "error" });
 */

export type DecisionResult = { ok: true; id: string } | { ok: false; error: string };

/** A thing to link: kind is event (meetings too), note, poll, form or task. */
export interface DecisionLinkInput {
  kind: string;
  id: string;
}

const id = z.string().min(1).max(64);
const GONE = "That decision is gone.";
const SETTLED = "That's already been settled.";
const NOT_YOURS = "Only its owner, whoever raised it, or an admin can do that.";
const NO_LINK = "Couldn't find that to link.";

function parseRefs(value: unknown): HomeLinkRef[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > LINKS_MAX) return null;
  const out: HomeLinkRef[] = [];
  for (const v of value) {
    const r = v as { kind?: unknown; id?: unknown } | null;
    if (!r || !isHomeLinkKind(r.kind) || !id.safeParse(r.id).success) return null;
    if (!out.some((o) => o.kind === r.kind && o.id === r.id)) {
      out.push({ kind: r.kind, id: r.id as string });
    }
  }
  return out;
}

/** Links the decision to each ref the member can see; false when any can't be found. */
async function addLinks(
  ctx: OrgContext,
  decisionId: string,
  refs: HomeLinkRef[],
): Promise<boolean> {
  if (refs.length === 0) return true;
  const seen = await resolveHomeRefs(ctx.db, ctx.organizationId, "", refs);
  if (refs.some((r) => !seen.has(refKey(r)))) return false;
  const existing = await ctx.db.itemLink.findMany({
    where: {
      organizationId: ctx.organizationId,
      OR: [
        { fromKind: "decision", fromId: decisionId },
        { toKind: "decision", toId: decisionId },
      ],
    },
    select: { fromKind: true, fromId: true, toKind: true, toId: true },
  });
  const has = (r: HomeLinkRef) =>
    existing.some(
      (e) =>
        (e.toKind === r.kind && e.toId === r.id) || (e.fromKind === r.kind && e.fromId === r.id),
    );
  const fresh = refs.filter((r) => !has(r));
  if (fresh.length > 0) {
    await ctx.db.itemLink.createMany({
      data: fresh.map((r) => ({
        organizationId: ctx.organizationId,
        fromKind: "decision",
        fromId: decisionId,
        toKind: r.kind,
        toId: r.id,
        createdById: ctx.userId,
      })),
      skipDuplicates: true,
    });
  }
  return true;
}

function findDecision(ctx: OrgContext, decisionId: unknown) {
  const parsed = id.safeParse(decisionId);
  if (!parsed.success) return Promise.resolve(null);
  return ctx.db.decision.findFirst({
    where: { organizationId: ctx.organizationId, id: parsed.data },
    select: { id: true, status: true, ownerId: true, createdById: true },
  });
}

const createTx = withOrgAction(async (ctx, input: unknown): Promise<DecisionResult> => {
  const clean = cleanDecision(input);
  if (!clean.ok) return clean;
  const refs = parseRefs((input as { links?: unknown } | null)?.links);
  if (!refs) return { ok: false, error: NO_LINK };
  const decision = await ctx.db.decision.create({
    data: {
      organizationId: ctx.organizationId,
      question: clean.question,
      detail: clean.detail,
      createdById: ctx.userId,
    },
    select: { id: true },
  });
  if (!(await addLinks(ctx, decision.id, refs))) {
    // Nothing half-made: the whole action rolls back.
    throw new AppError(NO_LINK, 400, "DECISION_LINK");
  }
  return { ok: true, id: decision.id };
});

const takeTx = withOrgAction(async (ctx, decisionId: unknown): Promise<DecisionResult> => {
  const d = await findDecision(ctx, decisionId);
  if (!d) return { ok: false, error: GONE };
  if (d.status !== "OPEN") return { ok: false, error: SETTLED };
  if (d.ownerId === ctx.userId) return { ok: true, id: d.id };
  if (d.ownerId !== null) return { ok: false, error: "Someone already owns it." };
  await ctx.db.decision.update({
    where: { id: d.id },
    data: { ownerId: ctx.userId, updatedAt: new Date() },
    select: { id: true },
  });
  return { ok: true, id: d.id };
});

const decideTx = withOrgAction(
  async (ctx, decisionId: unknown, outcome: unknown): Promise<DecisionResult> => {
    const d = await findDecision(ctx, decisionId);
    if (!d) return { ok: false, error: GONE };
    if (d.status !== "OPEN") return { ok: false, error: SETTLED };
    if (!canSettle(ctx, d)) return { ok: false, error: NOT_YOURS };
    const clean = cleanOutcome(outcome);
    if (!clean.ok) return clean;
    const now = new Date();
    await ctx.db.decision.update({
      where: { id: d.id },
      // Deciding an unowned one makes you its owner.
      data: {
        status: "DECIDED",
        outcome: clean.outcome,
        decidedAt: now,
        ownerId: d.ownerId ?? ctx.userId,
        updatedAt: now,
      },
      select: { id: true },
    });
    return { ok: true, id: d.id };
  },
);

const dropTx = withOrgAction(async (ctx, decisionId: unknown): Promise<DecisionResult> => {
  const d = await findDecision(ctx, decisionId);
  if (!d) return { ok: false, error: GONE };
  if (d.status !== "OPEN") return { ok: false, error: SETTLED };
  if (!canSettle(ctx, d)) return { ok: false, error: NOT_YOURS };
  await ctx.db.decision.update({
    where: { id: d.id },
    data: { status: "DROPPED", updatedAt: new Date() },
    select: { id: true },
  });
  return { ok: true, id: d.id };
});

const linkTx = withOrgAction(
  async (ctx, decisionId: unknown, ref: unknown): Promise<DecisionResult> => {
    const d = await findDecision(ctx, decisionId);
    if (!d) return { ok: false, error: GONE };
    if (d.status !== "OPEN") return { ok: false, error: SETTLED };
    if (!canSettle(ctx, d)) return { ok: false, error: NOT_YOURS };
    const refs = parseRefs([ref]);
    if (!refs || !(await addLinks(ctx, d.id, refs))) return { ok: false, error: NO_LINK };
    return { ok: true, id: d.id };
  },
);

function run(fn: () => Promise<DecisionResult>): Promise<DecisionResult> {
  return runResult(fn, { gone: GONE, label: "decisions" });
}

/**
 * Any member raises a decision, optionally linked to what it came from
 * (event, note, poll, form or task ids the member can see). Returns its id.
 */
export async function createDecision(
  orgId: string,
  input: { question: string; detail?: string | null; links?: DecisionLinkInput[] },
): Promise<DecisionResult> {
  return run(() => createTx(orgId, input));
}

/** You become the owner of an open decision nobody owns yet. */
export async function takeDecision(orgId: string, decisionId: string): Promise<DecisionResult> {
  return run(() => takeTx(orgId, decisionId));
}

/** Settles an open decision with what was decided ("Dec 5"): its owner, its raiser or an admin. */
export async function decide(
  orgId: string,
  decisionId: string,
  outcome: string,
): Promise<DecisionResult> {
  return run(() => decideTx(orgId, decisionId, outcome));
}

/** Drops an open decision: it won't be decided. */
export async function dropDecision(orgId: string, decisionId: string): Promise<DecisionResult> {
  return run(() => dropTx(orgId, decisionId));
}

/**
 * Links one more thing to an open decision (an event, note, poll, form or
 * task): its owner, its raiser or an admin.
 */
export async function linkDecision(
  orgId: string,
  decisionId: string,
  ref: DecisionLinkInput,
): Promise<DecisionResult> {
  return run(() => linkTx(orgId, decisionId, ref));
}
