import { withSystemOrgTx, type TxClient } from "@/server/db/context";
import { enqueueJob } from "@/server/jobs/enqueue";
import { PermanentJobError, type JobHandler } from "@/server/jobs/types";
import { sanitize } from "@/server/jobs/sanitize";

import { CrmError } from "./access";
import { AiCapError, NoAiConnectionError } from "./ai";
import { autoFields, fillTurn, pollBatch } from "./ai-fields";
import { jobWho } from "./ai-tx";
import { readAgentSettings, runFollowUpAgent, runResearchAgent } from "./agents";
import { refreshIssue } from "./issue";

/**
 * The CRM's AI jobs (src/server/jobs/registry.ts row crm-ai): filling an
 * AI field's column a few rows a turn, polling a Message Batch, the
 * research agent on a new person or company, the follow-up agent, and the
 * daily sweep that starts whatever is set to run by itself. Every model
 * call is outside a transaction and goes through runCrmAi (cap, AiUsage).
 * A job acts as a member (jobTx): the one who started it, or whoever
 * switched the automatic runs on, and stops if they've left.
 */

export type CrmAiPayload = {
  action: "fill" | "batch-poll" | "research" | "follow-up" | "sweep" | "new-record" | "issue";
  userId?: string;
  fieldId?: string;
  onlyEmpty?: boolean;
  after?: string;
  since?: string;
  batchViewId?: string;
  personId?: string;
  companyId?: string;
};

/** The member automatic runs act as: who switched them on, else the first owner. */
async function actingMember(db: TxClient, organizationId: string, preferred: string | null): Promise<string | null> {
  if (preferred) {
    const m = await db.membership.findUnique({ where: { userId_organizationId: { userId: preferred, organizationId } }, select: { userId: true } });
    if (m) return m.userId;
  }
  const owner = await db.membership.findFirst({ where: { organizationId, role: "OWNER" }, orderBy: { joinedAt: "asc" }, select: { userId: true } });
  return owner?.userId ?? null;
}

async function continueWith(orgId: string, key: string, payload: CrmAiPayload, runAt?: Date): Promise<void> {
  await withSystemOrgTx(orgId, ({ db }) =>
    enqueueJob(db, { orgId, kind: "crm-ai", key, payload, runAt, noKick: true }),
  );
}

export const crmAiJob: JobHandler<CrmAiPayload> = async (run) => {
  const orgId = run.organizationId;
  if (!orgId) throw new PermanentJobError("crm-ai needs an organization");
  const p = run.payload;
  try {
    switch (p.action) {
      case "fill": {
        if (!p.fieldId || !p.userId) throw new PermanentJobError("a fill names its field and member");
        let after = p.after ?? null;
        while (Date.now() < run.deadline - 10_000) {
          const turn = await fillTurn(jobWho(orgId, p.userId), p.fieldId, {
            onlyEmpty: p.onlyEmpty !== false,
            after,
            since: p.since ? new Date(p.since) : null,
            deadline: run.deadline,
          });
          after = turn.last;
          if (!turn.more) return;
        }
        if (after) await continueWith(orgId, `fill:${p.fieldId}:${after}`, { ...p, after });
        return;
      }
      case "batch-poll": {
        if (!p.batchViewId || !p.userId) throw new PermanentJobError("a batch poll names its batch and member");
        const finished = await pollBatch(jobWho(orgId, p.userId), p.batchViewId);
        // Batches finish within a day, usually far sooner: look again in ten minutes.
        if (!finished) await continueWith(orgId, `batch:${p.batchViewId}:${Date.now().toString(36)}`, p, new Date(Date.now() + 10 * 60_000));
        return;
      }
      case "research": {
        if (!p.userId || (!p.personId && !p.companyId)) throw new PermanentJobError("research names a record and a member");
        await runResearchAgent(jobWho(orgId, p.userId), p.personId ? { kind: "person", id: p.personId } : { kind: "company", id: p.companyId! }, { auto: true });
        return;
      }
      case "follow-up": {
        if (!p.userId) throw new PermanentJobError("the follow-up agent runs for a member");
        const settings = await withSystemOrgTx(orgId, ({ db }) => readAgentSettings(db, orgId));
        await runFollowUpAgent(jobWho(orgId, p.userId), { days: settings.followUpDays, limit: 5, auto: true });
        return;
      }
      case "new-record":
        await onNewRecord(orgId, p);
        return;
      case "issue": {
        if (!p.personId) throw new PermanentJobError("an issue names its person");
        // As whoever wrote the note (still a member), else the member automatic runs act as.
        const member = await withSystemOrgTx(orgId, async ({ db }) =>
          actingMember(db, orgId, p.userId ?? (await readAgentSettings(db, orgId)).by),
        );
        if (!member) return;
        await refreshIssue(jobWho(orgId, member), p.personId, { job: true }).catch((error: unknown) => {
          // Gone since (merged or trashed): nothing to keep.
          if (error instanceof CrmError) return;
          throw error;
        });
        return;
      }
      case "sweep":
        await sweep(orgId);
        return;
    }
  } catch (error) {
    // Out of budget or nothing connected: nothing to retry until a person acts.
    if (error instanceof AiCapError || error instanceof NoAiConnectionError) {
      console.warn("[crm-ai] stopped:", sanitize(error, 200));
      return;
    }
    throw error;
  }
};

/** A new person or company: AI fields set to fill new rows, and research when it's switched on. */
async function onNewRecord(orgId: string, p: CrmAiPayload): Promise<void> {
  const plan = await withSystemOrgTx(orgId, async ({ db }) => {
    const settings = await readAgentSettings(db, orgId);
    const member = await actingMember(db, orgId, settings.by);
    const fields = (await autoFields(db, orgId)).filter((f) => f.auto === "new");
    const kind = p.personId ? "CRM_PEOPLE" : "CRM_COMPANIES";
    const onKind = fields.length
      ? await db.databaseField.findMany({ where: { organizationId: orgId, id: { in: fields.map((f) => f.id) }, database: { kind } }, select: { id: true } })
      : [];
    return { settings, member, fieldIds: onKind.map((f) => f.id) };
  });
  if (!plan.member) return;
  const since = new Date(Date.now() - 2 * 86_400_000).toISOString();
  for (const fieldId of plan.fieldIds) {
    await continueWith(orgId, `fill:${fieldId}:new:${p.personId ?? p.companyId}`, { action: "fill", fieldId, userId: plan.member, onlyEmpty: true, since });
  }
  if (plan.settings.researchNew) {
    await continueWith(orgId, `research:${p.personId ?? p.companyId}`, {
      action: "research",
      userId: plan.member,
      ...(p.personId ? { personId: p.personId } : { companyId: p.companyId }),
    });
  }
}

/** The daily sweep: AI fields on their schedule and for new rows, new records to research, the follow-up agent. */
async function sweep(orgId: string, now: Date = new Date()): Promise<void> {
  const plan = await withSystemOrgTx(orgId, async ({ db }) => {
    const settings = await readAgentSettings(db, orgId);
    const member = await actingMember(db, orgId, settings.by);
    const fields = await autoFields(db, orgId);
    const yesterday = new Date(now.getTime() - 86_400_000);
    const fresh = settings.researchNew
      ? {
          people: await db.crmPerson.findMany({ where: { organizationId: orgId, deletedAt: null, createdAt: { gte: yesterday } }, select: { id: true, enrichment: true }, take: 25 }),
          companies: await db.crmCompany.findMany({ where: { organizationId: orgId, deletedAt: null, createdAt: { gte: yesterday } }, select: { id: true, enrichment: true }, take: 25 }),
        }
      : { people: [], companies: [] };
    const owners = settings.followUp
      ? await db.crmPerson.groupBy({
          by: ["ownerId"],
          where: { organizationId: orgId, deletedAt: null, status: "ACTIVE", doNotContact: false, ownerId: { not: null }, lastContactedAt: { lt: new Date(now.getTime() - settings.followUpDays * 86_400_000) } },
          _count: { _all: true },
        })
      : [];
    return { settings, member, fields, fresh, owners: owners.map((o) => o.ownerId!).filter(Boolean) };
  });
  if (!plan.member) return;
  const day = now.toISOString().slice(0, 10);
  const monday = now.getUTCDay() === 1;
  for (const f of plan.fields) {
    if (f.auto === "daily" || (f.auto === "weekly" && monday)) {
      await continueWith(orgId, `fill:${f.id}:${day}`, { action: "fill", fieldId: f.id, userId: plan.member, onlyEmpty: false });
    } else if (f.auto === "new") {
      await continueWith(orgId, `fill:${f.id}:new:${day}`, { action: "fill", fieldId: f.id, userId: plan.member, onlyEmpty: true, since: f.createdAt.toISOString() });
    }
  }
  const unresearched = (e: unknown) => !(e && typeof e === "object" && "_research" in (e as object));
  for (const person of plan.fresh.people.filter((x) => unresearched(x.enrichment))) {
    await continueWith(orgId, `research:${person.id}`, { action: "research", userId: plan.member, personId: person.id });
  }
  for (const company of plan.fresh.companies.filter((x) => unresearched(x.enrichment))) {
    await continueWith(orgId, `research:${company.id}`, { action: "research", userId: plan.member, companyId: company.id });
  }
  for (const owner of plan.owners.slice(0, 50)) {
    await continueWith(orgId, `follow-up:${owner}:${day}`, { action: "follow-up", userId: owner });
  }
}

/**
 * Once a day per organization with the CRM set up and anything automatic
 * switched on: the sweep. Called by the daily cron beside scheduleCrmRefresh.
 */
export async function scheduleCrmAi(orgId: string, now: Date = new Date()): Promise<number> {
  return withSystemOrgTx(orgId, async ({ db }) => {
    const settings = await db.orgSettings.findUnique({ where: { organizationId: orgId }, select: { addOns: true } });
    if (!settings?.addOns.includes("crm")) return 0;
    const crm = await db.crmSettings.findUnique({ where: { organizationId: orgId }, select: { setupDoneAt: true } });
    if (!crm?.setupDoneAt) return 0;
    const agents = await readAgentSettings(db, orgId);
    const fields = await autoFields(db, orgId);
    if (!agents.researchNew && !agents.followUp && fields.length === 0) return 0;
    const id = await enqueueJob(db, {
      orgId,
      kind: "crm-ai",
      key: `sweep:${now.toISOString().slice(0, 10)}`,
      payload: { action: "sweep" },
      once: true,
      noKick: true,
    });
    return id ? 1 : 0;
  });
}

/**
 * A new person or company was added (the crm-refresh for one person calls
 * this): queue its automatic AI work, if any is switched on. Cheap when
 * nothing is.
 */
export async function queueNewRecordAi(db: TxClient, orgId: string, record: { personId?: string; companyId?: string }): Promise<void> {
  const agents = await readAgentSettings(db, orgId);
  const fields = (await autoFields(db, orgId)).filter((f) => f.auto === "new");
  if (!agents.researchNew && fields.length === 0) return;
  const id = record.personId ?? record.companyId;
  if (!id) return;
  await enqueueJob(db, {
    orgId,
    kind: "crm-ai",
    key: `new:${id}`,
    payload: { action: "new-record", ...(record.personId ? { personId: record.personId } : { companyId: record.companyId }) },
    noKick: true,
  });
}
