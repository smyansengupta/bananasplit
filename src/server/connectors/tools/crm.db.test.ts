// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The CRM's connector tools against the real roles and policies
 * (src/test/connector-fixture.ts): refused until the organization adds the
 * CRM; search, a timeline, who we haven't talked to and pipelines as the
 * member; logging applied at once on a WRITE grant (low risk) while field
 * changes and drafts wait in the review queue with the app as their source;
 * the database tools reading the CRM's People database; and everything run
 * through the MCP server so the SDK checks the output schemas.
 */

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock }));
vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));
vi.mock("@/server/org-chart/queries", () => ({ getPublishedOrgChart: vi.fn(async () => null) }));

import { createPerson } from "@/server/crm/people";
import { runSetup } from "@/server/crm/setup";
import { disconnectAll } from "@/server/db/clients";
import { withOrgTx } from "@/server/db/context";
import { setUpConnectorFixture, type ConnectorFixture } from "@/test/connector-fixture";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";

import { crmNotContactedTool, crmPipelinesTool, crmSearchTool, crmTimelineTool } from "./crm";
import { crmDraftEmailTool, crmUpdateRecordTool, logToTimeline } from "./crm-writes";

let fx: ConnectorFixture | null = null;
let personId = "";

beforeAll(async () => {
  fx = await setUpConnectorFixture("tool-crm");
});

afterAll(async () => {
  await fx?.cleanup();
  await disconnectAll();
  await disconnectOwnerDb();
});

describe("the CRM tools", () => {
  it("refuse a space that hasn't added the CRM", async () => {
    if (!fx) return;
    const session = await fx.session(fx.alice);
    await expect(crmSearchTool(session, { space: fx.club.id, query: "" })).rejects.toThrow();
    const r = await fx.call(session, "crm_search", { space: fx.club.id, query: "" }).catch((e: Error) => e);
    expect(r).toBeInstanceOf(Error);
  });

  it("search, read a timeline, list who's gone quiet and the pipelines, as the member", async () => {
    if (!fx) return;
    const { alice, bob, club } = fx;
    await ownerDb.orgSettings.upsert({
      where: { organizationId: club.id },
      create: { organizationId: club.id, addOns: ["crm"] },
      update: { addOns: { push: "crm" } },
    });
    requireUserMock.mockResolvedValue({ id: bob.id, email: bob.email, name: bob.name });
    await withOrgTx(club.id, (ctx) => runSetup(ctx, ["sponsors"]));
    personId = (await withOrgTx(club.id, (ctx) => createPerson(ctx, { name: "Mara Quinn", title: "Head of partnerships", companyName: "Harbor Light" }))).id;
    await ownerDb.crmPerson.update({ where: { id: personId }, data: { lastContactedAt: new Date(Date.now() - 90 * 86_400_000) } });

    const session = await fx.session(alice);
    const found = await crmSearchTool(session, { space: club.id, query: "mara" });
    expect(found.results).toHaveLength(1);
    expect(found.results[0]).toMatchObject({ kind: "person", name: "Mara Quinn", detail: "Head of partnerships at Harbor Light" });
    const id = found.results[0]!.id;
    expect(id).toBe(`crmperson:${club.id}:${personId}`);

    const cold = await crmNotContactedTool(session, { space: club.id, days: 60 });
    expect(cold.results.map((r) => r.name)).toContain("Mara Quinn");
    const pipelines = await crmPipelinesTool(session, { space: club.id });
    expect(pipelines.pipelines.map((p) => p.name)).toContain("Sponsorships");

    const tl = await crmTimelineTool(session, { id });
    expect(tl.record.name).toBe("Mara Quinn");
    // Through the MCP server, against the output schemas.
    const viaServer = await fx.call(session, "crm_search", { space: club.id, query: "mara" });
    expect((viaServer.results as unknown[]).length).toBe(1);
    await fx.call(session, "crm_timeline", { id });
    await fx.call(session, "crm_changes_since", { id, since: "2026-01-01" });
    await fx.call(session, "fetch", { id });
  });

  it("log at once on a WRITE grant; field changes and drafts wait for a person", async () => {
    if (!fx || !personId) return;
    const { alice, club } = fx;
    const session = await fx.session(alice, { access: "WRITE", clientName: "Claude" });
    const id = `crmperson:${club.id}:${personId}`;
    const logged = await logToTimeline(session, "crm_log_activity", { id, kind: "call", text: "Talked about the spring sponsorship.", direction: "outbound" });
    expect(logged.status).toBe("applied");
    const activity = await ownerDb.crmActivity.findFirst({ where: { organizationId: club.id, kind: "CALL" }, orderBy: { createdAt: "desc" } });
    expect(activity?.body).toBe("Talked about the spring sponsorship.");
    expect((activity?.meta as { via?: string }).via).toBe("connector");
    // A call moved "last contacted" to now.
    const mara = await ownerDb.crmPerson.findUniqueOrThrow({ where: { id: personId } });
    expect(Date.now() - mara.lastContactedAt!.getTime()).toBeLessThan(60_000);
    const audit = await ownerDb.orgAuditLog.findFirst({ where: { organizationId: club.id, action: "connector.crm_log_activity" } });
    expect(audit).not.toBeNull();

    const change = await crmUpdateRecordTool(session, { id, changes: { title: "Director of partnerships" }, why: "Her new email signature" });
    expect(change.status).toBe("queued");
    const suggestion = await ownerDb.crmSuggestion.findUniqueOrThrow({ where: { id: change.suggestionId! } });
    expect(suggestion).toMatchObject({ kind: "UPDATE_FIELD", source: "CONNECTOR", status: "PENDING", proposedById: alice.id });
    expect((await ownerDb.crmPerson.findUniqueOrThrow({ where: { id: personId } })).title).toBe("Head of partnerships");
    await expect(crmUpdateRecordTool(session, { id, changes: { strength: "100" } })).rejects.toThrow(/can't be changed here/);

    const draft = await crmDraftEmailTool(session, { id, subject: "Spring", body: "Hi Mara, ..." });
    expect(draft.status).toBe("queued");
    // Nothing sent: an unsent draft waits in compose (and in Review).
    const mail = await ownerDb.crmEmailMessage.findMany({ where: { organizationId: club.id }, select: { status: true, personId: true } });
    expect(mail).toEqual([{ status: "DRAFT", personId }]);
    expect(await ownerDb.crmSuggestion.count({ where: { organizationId: club.id, kind: "DRAFT_EMAIL", status: "PENDING" } })).toBe(1);
    await fx.call(session, "crm_add_note", { id, text: "Prefers email." });
  });

  it("let the database tools read the CRM's People", async () => {
    if (!fx || !personId) return;
    const { alice, club } = fx;
    const session = await fx.session(alice);
    const list = await fx.call(session, "list_databases", { space: club.id });
    const people = (list.databases as { id: string; kind: string }[]).find((d) => d.kind === "crm_people");
    expect(people).toBeTruthy();
    const rows = await fx.call(session, "query_database", { id: people!.id, query: "Mara" });
    expect((rows.rows as unknown[]).length).toBe(1);
  });
});
