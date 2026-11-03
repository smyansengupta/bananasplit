// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Phase 3 against the real roles and policies on the local database: setup's
 * starter views and reports; a recipe switched on, set off by a real stage
 * move (the crm-event job), starting a project in Tasks; loop protection
 * and the hourly cap; a dry run that changes nothing; score rules; Inbox
 * signals; forecast snapshots; and a CRM report widget. One throwaway
 * organization, made as the table owner and removed in afterAll. Skipped
 * when the database is not reachable.
 */

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock, getSession: vi.fn() }));
vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));
vi.mock("@/server/org-chart/queries", () => ({ getPublishedOrgChart: vi.fn(async () => null) }));

import { authDb, disconnectAll } from "@/server/db/clients";
import { withOrgTx, withSystemOrgTx, type OrgContext } from "@/server/db/context";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";
import { periodOf } from "@/lib/crm/forecast";

import { createDeal, moveDeal, updateDeal } from "./deals";
import type { CrmEventPayload } from "./events";
import { snapshotsFor, takeSnapshot } from "./forecast";
import { createPerson } from "./people";
import { crmWidgetPayload } from "./report-widgets";
import { recomputeScoresPage, saveScoreRule } from "./scoring";
import { raiseSignals, signalsFor } from "./signals";
import { runSetup } from "./setup";
import { dryRunWorkflow, handleCrmEvent, runWorkflowOn } from "./workflow-engine";
import { enableRecipe, saveWorkflow } from "./workflows";

const tag = randomBytes(4).toString("hex");
const org = `c_crmauto_${tag}`;

type U = { id: string; email: string; name: string };
let owner: U;
let member: U;
let reachable = true;

async function makeUser(local: string): Promise<U> {
  const email = `${local}-${tag}@example.edu`;
  const row = await authDb.user.create({
    data: { email, name: local, emailVerified: new Date(), onboardedAt: new Date() },
    select: { id: true, email: true, name: true },
  });
  return { id: row.id, email: row.email, name: row.name ?? local };
}

function as<T>(user: U, fn: (ctx: OrgContext) => Promise<T>): Promise<T> {
  requireUserMock.mockResolvedValue(user);
  return withOrgTx(org, fn);
}

/** Runs the pending crm-event jobs, as the job runner would. */
async function drainEvents(): Promise<number> {
  let n = 0;
  for (let round = 0; round < 5; round++) {
    const jobs = await ownerDb.job.findMany({
      where: { organizationId: org, kind: "crm-event", status: "PENDING" },
      orderBy: { runAt: "asc" },
    });
    if (jobs.length === 0) break;
    for (const j of jobs) {
      await ownerDb.job.update({ where: { id: j.id }, data: { status: "DONE" } });
      await handleCrmEvent(org, j.payload as unknown as CrmEventPayload, { jobKey: j.dedupeKey });
      n++;
    }
  }
  return n;
}

beforeAll(async () => {
  try {
    owner = await makeUser("auto-owner");
    member = await makeUser("auto-member");
    await ownerDb.organization.create({
      data: { id: org, name: "CRM Auto", slug: `crm-auto-${tag}`, timezone: "UTC", plan: "SOCIETY" },
    });
    await ownerDb.membership.createMany({
      data: [
        { organizationId: org, userId: owner.id, role: "OWNER" },
        { organizationId: org, userId: member.id, role: "MEMBER" },
      ],
    });
    await ownerDb.orgSettings.upsert({
      where: { organizationId: org },
      create: { organizationId: org, addOns: ["crm", "finance"] },
      update: { addOns: ["crm", "finance"] },
    });
  } catch (error) {
    console.warn("[automation.db.test] skipped:", error instanceof Error ? error.message : error);
    reachable = false;
  }
});

afterAll(async () => {
  if (reachable) {
    await ownerDb.job.deleteMany({ where: { organizationId: org } });
    await ownerDb.organization.deleteMany({ where: { id: org } });
    await ownerDb.user.deleteMany({ where: { id: { in: [owner, member].filter(Boolean).map((u) => u.id) } } });
  }
  await disconnectAll();
  await disconnectOwnerDb();
});

describe("CRM automation and numbers against the local database", () => {
  let clients: { id: string; won: string; lead: string };

  it("makes each pipeline's saved views and starter report at setup", async () => {
    if (!reachable) return;
    await as(owner, (ctx) => runSetup(ctx, ["clients", "donors"]));
    const pipelines = await ownerDb.crmPipeline.findMany({ where: { organizationId: org }, include: { stages: true } });
    const c = pipelines.find((p) => p.template === "clients")!;
    clients = { id: c.id, won: c.stages.find((s) => s.key === "WON")!.id, lead: c.stages.find((s) => s.key === "LEAD")!.id };
    const views = await ownerDb.crmView.findMany({ where: { organizationId: org, objectKind: "deals", pipelineId: c.id } });
    expect(views.map((v) => v.name).sort()).toEqual(["Best scores", "Mine", "No next step", "Stuck"]);
    const reports = await ownerDb.report.findMany({ where: { organizationId: org }, select: { title: true, widgets: true } });
    expect(reports.map((r) => r.title).sort()).toEqual(["Clients report", "Donations report", "Outreach"]);
    const clientReport = reports.find((r) => r.title === "Clients report")!;
    expect((clientReport.widgets as { type: string }[]).map((w) => w.type)).toEqual(expect.arrayContaining(["crm-velocity", "crm-conversion"]));
    // Again: nothing more.
    await as(owner, (ctx) => runSetup(ctx, ["clients"]));
    expect(await ownerDb.report.count({ where: { organizationId: org } })).toBe(3);
  });

  it("runs a recipe from a real stage move: a won client starts a project", async () => {
    if (!reachable) return;
    const wf = await as(owner, (ctx) => enableRecipe(ctx, "client-yes"));
    const deal = await as(member, (ctx) => createDeal(ctx, { pipelineId: clients.id, title: "Harbor Light website" }));
    await as(member, (ctx) => moveDeal(ctx, deal.id, { stageId: clients.won }));
    expect(await drainEvents()).toBeGreaterThan(0);
    const runs = await ownerDb.crmWorkflowRun.findMany({ where: { workflowId: wf.id } });
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("DONE");
    const links = await ownerDb.itemLink.findMany({ where: { organizationId: org, fromKind: "task", toKind: "crm-deal", toId: deal.id } });
    expect(links).toHaveLength(1);
    const epic = await ownerDb.task.findUniqueOrThrow({ where: { id: links[0]!.fromId } });
    expect(epic.type).toBe("EPIC");
    expect(epic.title).toBe("Harbor Light website");
    expect(epic.ownerId).toBe(member.id);
    expect(await ownerDb.task.count({ where: { parentTaskId: epic.id } })).toBe(4);
    // The history says an automation did it, and the same job twice runs it once.
    const job = await ownerDb.job.findFirst({ where: { organizationId: org, kind: "crm-event" }, orderBy: { runAt: "asc" } });
    await handleCrmEvent(org, job!.payload as unknown as CrmEventPayload, { jobKey: job!.dedupeKey });
    expect(await ownerDb.crmWorkflowRun.count({ where: { workflowId: wf.id } })).toBe(1);
    await ownerDb.crmWorkflow.update({ where: { id: wf.id }, data: { status: "OFF" } });
  });

  it("never re-fires a workflow on its own change, and caps runs per record", async () => {
    if (!reachable) return;
    const wf = await as(owner, (ctx) =>
      saveWorkflow(ctx, {
        workflow: {
          name: "Echo",
          trigger: { type: "field.changed", params: { object: "deal", field: "nextStep" } },
          conditions: [],
          actions: [{ type: "field.set", params: { field: "nextStep", value: "Set by the automation" } }],
        },
        status: "ON",
      }),
    );
    const deal = await as(member, (ctx) => createDeal(ctx, { pipelineId: clients.id, title: "Loop check" }));
    await drainEvents();
    await as(member, (ctx) => updateDeal(ctx, deal.id, { nextStep: "Call them" }));
    await drainEvents();
    const runs = await ownerDb.crmWorkflowRun.findMany({ where: { workflowId: wf.id } });
    expect(runs).toHaveLength(1);
    expect((await ownerDb.crmDeal.findUniqueOrThrow({ where: { id: deal.id } })).nextStep).toBe("Set by the automation");
    const history = await ownerDb.crmFieldHistory.findFirst({ where: { targetId: deal.id, field: "nextStep", source: "automation" } });
    expect(history).not.toBeNull();

    // The hourly cap: five runs on one record, then one note, then nothing.
    const row = await ownerDb.crmWorkflow.findUniqueOrThrow({ where: { id: wf.id } });
    for (let i = 0; i < 7; i++) {
      await runWorkflowOn(org, row, { kind: "deal", id: deal.id, event: "test", key: `cap:${i}` }, { roles: new Map() });
    }
    const all = await ownerDb.crmWorkflowRun.findMany({ where: { workflowId: wf.id } });
    expect(all.filter((r) => r.status !== "SKIPPED")).toHaveLength(5);
    expect(all.filter((r) => r.status === "SKIPPED")).toHaveLength(1);
    await ownerDb.crmWorkflow.update({ where: { id: wf.id }, data: { status: "OFF" } });
  });

  it("tries a workflow without changing anything", async () => {
    if (!reachable) return;
    const person = await as(member, (ctx) => createPerson(ctx, { name: "Grace Hopper", primaryEmail: "grace@navy.example.com" }));
    const wf = await as(owner, (ctx) =>
      saveWorkflow(ctx, {
        workflow: {
          name: "Welcome task",
          trigger: { type: "record.created", params: { object: "person" } },
          conditions: [{ field: "name", op: "contains", value: "grace" }],
          actions: [
            { type: "task.create", params: { title: "Say hello to {name}", dueInDays: 1, assignTo: "owner" } },
            { type: "webhook.call", params: { url: "https://hooks.example.com/crm" } },
          ],
        },
      }),
    );
    const tasksBefore = await ownerDb.task.count({ where: { organizationId: org } });
    const r = await as(owner, (ctx) => dryRunWorkflow(ctx, wf.id, { kind: "person", id: person.id }));
    expect(r.conditionsMet).toBe(true);
    expect(r.log.map((e) => e.ok)).toEqual([true, true]);
    expect(r.log[0]!.detail).toMatch(/Would create "Say hello to Grace Hopper"/);
    expect(await ownerDb.task.count({ where: { organizationId: org } })).toBe(tasksBefore);
    expect(await ownerDb.job.count({ where: { organizationId: org, kind: "crm-workflow-call" } })).toBe(0);
    const runs = await ownerDb.crmWorkflowRun.findMany({ where: { workflowId: wf.id } });
    expect(runs.map((x) => x.dryRun)).toEqual([true]);
    // Members don't shape automations.
    await expect(as(member, (ctx) => saveWorkflow(ctx, { workflow: { name: "x", trigger: { type: "deal.stuck", params: {} }, actions: [{ type: "notify", params: { to: "owner", message: "x" } }] } }))).rejects.toThrow();
  });

  it("scores people by rules, raises signals once, snapshots the forecast and computes a widget", async () => {
    if (!reachable) return;
    await as(owner, (ctx) => saveScoreRule(ctx, { rule: { objectKind: "people", label: "Has a title", condition: { field: "title", op: "not_empty" }, points: 30, active: true } }));
    const p = await as(member, (ctx) => createPerson(ctx, { name: "Katherine Johnson", title: "Mathematician" }));
    let cursor: string | null = null;
    do {
      cursor = (await withSystemOrgTx(org, ({ db }) => recomputeScoresPage(db, org, cursor))).cursor;
    } while (cursor);
    expect((await ownerDb.crmPerson.findUniqueOrThrow({ where: { id: p.id } })).score).toBe(30);

    const stuck = await as(member, (ctx) => createDeal(ctx, { pipelineId: clients.id, stageId: clients.lead, title: "Old lead" }));
    await ownerDb.crmDeal.update({ where: { id: stuck.id }, data: { stageEnteredAt: new Date(Date.now() - 40 * 86_400_000) } });
    const raised = await withSystemOrgTx(org, ({ db }) => raiseSignals(db, org, new Map()));
    expect(raised).toBeGreaterThan(0);
    const again = await withSystemOrgTx(org, ({ db }) => raiseSignals(db, org, new Map()));
    expect(again).toBe(0);
    const mine = await as(member, (ctx) => signalsFor(ctx.db, org, member.id));
    expect(mine.some((s) => s.kind === "stuck" && s.targetId === stuck.id)).toBe(true);
    expect(await as(owner, (ctx) => signalsFor(ctx.db, org, owner.id))).toEqual([]);

    const today = new Date().toISOString().slice(0, 10);
    const period = periodOf("quarter", today);
    await as(member, (ctx) => takeSnapshot(ctx.db, org, clients.id, period, today));
    expect(await as(member, (ctx) => takeSnapshot(ctx.db, org, clients.id, period, today))).toBe(false);
    const snaps = await as(member, (ctx) => snapshotsFor(ctx.db, org, clients.id, period));
    expect(snaps).toHaveLength(1);
    expect(snaps[0]!.data.won.count).toBeGreaterThanOrEqual(1);

    const payload = await as(member, (ctx) =>
      crmWidgetPayload(
        { db: ctx.db, organizationId: org, slug: `crm-auto-${tag}`, tz: "UTC", range: { from: null, to: null }, crm: { kind: "pipeline", pipelineId: clients.id, hasAmount: true } },
        "crm-conversion",
      ),
    );
    expect(payload?.type).toBe("crm-conversion");
    const rows = (payload!.data as { rows: { label: string; value: number }[] }).rows;
    expect(rows[0]!.label).toBe("Lead");
    expect(rows[0]!.value).toBeGreaterThanOrEqual(3);
    expect(rows.find((r) => r.label === "Won")!.value).toBe(1);
    const reached = await as(member, (ctx) =>
      crmWidgetPayload({ db: ctx.db, organizationId: org, slug: "x", tz: "UTC", range: { from: today, to: today }, crm: { kind: "people" } }, "crm-reply-rate"),
    );
    expect(reached?.data).toMatchObject({ value: null, empty: expect.any(String) });
  });
});
