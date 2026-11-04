// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The CRM's ready-made reports against the real roles and policies on the
 * local database: setup makes Deals, People and Outreach in Databases >
 * Reports once; the classics count who was talked to, who converted and
 * the most common issue; the Report buttons find the report, or make one
 * when it's gone. One throwaway organization, made as the table owner and
 * removed in afterAll. Skipped when the database is not reachable.
 */

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock, getSession: vi.fn() }));
vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));
vi.mock("@/server/org-chart/queries", () => ({ getPublishedOrgChart: vi.fn(async () => null) }));

import type { CrmListPayload, CrmStatPayload } from "@/lib/reports/crm-widgets";
import { authDb, disconnectAll } from "@/server/db/clients";
import { withOrgTx, type OrgContext } from "@/server/db/context";
import { readyReportId } from "@/server/reports/ready";
import { reportViewer } from "@/server/reports/run";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";

import { logActivity } from "./activity";
import { createDeal, moveDeal } from "./deals";
import { createPerson } from "./people";
import { crmWidgetPayload } from "./report-widgets";
import { runSetup } from "./setup";

const tag = randomBytes(4).toString("hex");
const org = `c_crmready_${tag}`;
const slug = `crm-ready-${tag}`;

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

beforeAll(async () => {
  try {
    owner = await makeUser("ready-owner");
    member = await makeUser("ready-member");
    await ownerDb.organization.create({
      data: { id: org, name: "CRM Ready", slug, timezone: "UTC", plan: "SOCIETY" },
    });
    await ownerDb.membership.createMany({
      data: [
        { organizationId: org, userId: owner.id, role: "OWNER" },
        { organizationId: org, userId: member.id, role: "MEMBER" },
      ],
    });
    await ownerDb.orgSettings.upsert({
      where: { organizationId: org },
      create: { organizationId: org, addOns: ["crm"] },
      update: { addOns: ["crm"] },
    });
  } catch (error) {
    console.warn("[report-ready.db.test] skipped:", error instanceof Error ? error.message : error);
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

describe("the CRM's ready-made reports against the local database", () => {
  let pipeline: { id: string; databaseId: string; won: string };
  let peopleKey: string;

  it("makes Deals, People and Outreach once at setup", async () => {
    if (!reachable) return;
    await as(owner, (ctx) => runSetup(ctx, ["clients"]));
    const p = await ownerDb.crmPipeline.findFirstOrThrow({ where: { organizationId: org, template: "clients" }, include: { stages: true } });
    pipeline = { id: p.id, databaseId: p.databaseId!, won: p.stages.find((s) => s.kind === "WON")!.id };
    const people = await ownerDb.databaseDefinition.findFirstOrThrow({ where: { organizationId: org, kind: "CRM_PEOPLE" } });
    peopleKey = `custom:${people.id}`;
    const reports = await ownerDb.report.findMany({ where: { organizationId: org }, select: { title: true, source: true } });
    expect(reports.map((r) => r.title).sort()).toEqual(["Clients", "Outreach", "People"]);
    expect(reports.find((r) => r.title === "Clients")!.source).toBe(`custom:${pipeline.databaseId}`);
    await as(owner, (ctx) => runSetup(ctx, ["clients"]));
    expect(await ownerDb.report.count({ where: { organizationId: org } })).toBe(3);
  });

  it("counts who was talked to, who converted, and the most common issue", async () => {
    if (!reachable) return;
    const ids = await as(member, async (ctx) => {
      const make = async (name: string, relationship?: string) =>
        (await createPerson(ctx, { name, relationship: relationship ?? null })).id;
      const ada = await make("Ada Talked");
      const ben = await make("Ben Client", "client");
      const cy = await make("Cy Voicemail");
      const di = await make("Di Interested");
      const ed = await make("Ed Untouched");
      const now = new Date();
      const log = (kind: "EMAIL" | "CALL" | "MEETING", id: string, extra: { direction?: "INBOUND" | "OUTBOUND"; meta?: Record<string, unknown> } = {}) =>
        logActivity(ctx.db, {
          organizationId: org,
          kind,
          targets: [{ kind: "person", id }],
          occurredAt: now,
          actorId: member.id,
          createdById: member.id,
          direction: extra.direction ?? null,
          meta: extra.meta,
        });
      await log("EMAIL", ada, { direction: "INBOUND" });
      await log("CALL", ben, { direction: "OUTBOUND", meta: { outcome: "connected" } });
      await log("CALL", cy, { direction: "OUTBOUND", meta: { outcome: "voicemail" } });
      await log("MEETING", di);
      // Di is interested: on an open deal. A won deal makes Ada converted.
      await createDeal(ctx, { pipelineId: pipeline.id, title: "Di's project", primaryPersonId: di });
      const won = await createDeal(ctx, { pipelineId: pipeline.id, title: "Ada's project", amount: 1200, primaryPersonId: ada });
      await moveDeal(ctx, won.id, { stageId: pipeline.won });
      return { ada, ben, cy, di, ed };
    });
    const issue = (text: string) => ({ _issue: { text, at: new Date().toISOString(), model: null, sources: [] } });
    await ownerDb.crmPerson.update({ where: { id: ids.ada }, data: { enrichment: issue("Budget is tight") } });
    await ownerDb.crmPerson.update({ where: { id: ids.ben }, data: { enrichment: issue("budget is tight.") } });
    await ownerDb.crmPerson.update({ where: { id: ids.cy }, data: { enrichment: issue("No time") } });

    const widget = (type: Parameters<typeof crmWidgetPayload>[1], crm: Parameters<typeof crmWidgetPayload>[0]["crm"] = { kind: "people" }) =>
      as(member, (ctx) =>
        crmWidgetPayload({ db: ctx.db, organizationId: org, slug, tz: "UTC", range: { from: null, to: null }, crm }, type),
      );

    const talked = (await widget("crm-talked-to"))!.data as CrmStatPayload;
    // Ada wrote back, Ben took a call, Di met; Cy's voicemail and Ed don't count.
    expect(talked.value).toBe(3);
    expect(talked.parts[0]).toEqual({ label: "Of everyone in People", value: "60%" });

    const converted = (await widget("crm-converted"))!.data as CrmListPayload;
    expect(converted.rows.map((r) => [r.key, r.value])).toEqual([
      ["talked", 3],
      ["interested", 3],
      ["converted", 2],
    ]);
    expect(converted.headline).toEqual({ value: "2", detail: "67% of the people talked to" });

    const issues = (await widget("crm-top-issues"))!.data as CrmListPayload;
    expect(issues.rows[0]).toMatchObject({ label: "Budget is tight", value: 2 });
    expect(issues.rows[0]!.links!.map((l) => l.label).sort()).toEqual(["Ada Talked", "Ben Client"]);
    expect(issues.issues).toHaveLength(2);

    const crm = { kind: "pipeline" as const, pipelineId: pipeline.id, hasAmount: true };
    const won = (await widget("crm-won", crm))!.data as CrmStatPayload;
    expect(won).toMatchObject({ value: 120_000, format: "money" });
    const open = (await widget("crm-open", crm))!.data as CrmStatPayload;
    expect(open.value).toBe(0);
    expect(open.rows.map((r) => r.label)).toEqual(["Di's project"]);
  });

  it("opens the ready-made report, and makes one again when it's gone", async () => {
    if (!reachable) return;
    const v = (user: U) => as(user, async (ctx) => reportViewer(ctx));
    const find = (make: boolean) =>
      as(member, async (ctx) => readyReportId(await reportViewer(ctx), "people", peopleKey, { make }));
    await v(member);
    const first = await find(false);
    expect(first).toBeTruthy();
    expect(await find(true)).toBe(first);
    await ownerDb.report.update({ where: { id: first! }, data: { archivedAt: new Date() } });
    expect(await find(false)).toBeNull();
    const again = await find(true);
    expect(again).toBeTruthy();
    expect(again).not.toBe(first);
    expect(await find(true)).toBe(again);
    // Not a CRM database: nothing to open.
    expect(await as(member, async (ctx) => readyReportId(await reportViewer(ctx), "deals", peopleKey, { make: true }))).toBeNull();
  });
});
