// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Phase 5 against the real roles and policies on the local database: the
 * public API's create, update, trash, pagination and scopes in the key's
 * organization only; the quote flow from draft to a typed-name acceptance
 * that moves the item to won; STOP and START on an incoming text; and the
 * event bus queueing for an active webhook. Two throwaway organizations,
 * removed in afterAll. Skipped when the database is not reachable.
 */

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock, getSession: vi.fn() }));
vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));
vi.mock("@/server/org-chart/queries", () => ({ getPublishedOrgChart: vi.fn(async () => null) }));

import { authDb, disconnectAll } from "@/server/db/clients";
import { withOrgTx, withSystemOrgTx, type OrgContext } from "@/server/db/context";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";

import { handleApi } from "./api/handlers";
import { createApiKey, hashApiKey } from "./api/keys";
import { createDeal } from "./deals";
import { createPerson } from "./people";
import { receiveText } from "./phone/texts";
import { createQuote, loadPublicQuote, respondToQuote, saveQuote, sendQuote } from "./quotes";
import { runSetup } from "./setup";
import { listPipelines } from "./pipelines";
import { createWebhook } from "./webhooks";

const tag = randomBytes(4).toString("hex");
const orgA = `c_crmp5_a_${tag}`;
const orgB = `c_crmp5_b_${tag}`;

type U = { id: string; email: string; name: string };
let ownerA: U;
let memberA: U;
let ownerB: U;
let reachable = true;

async function makeUser(local: string): Promise<U> {
  const email = `${local}-${tag}@example.edu`;
  const row = await authDb.user.create({
    data: { email, name: local, emailVerified: new Date(), onboardedAt: new Date() },
    select: { id: true, email: true, name: true },
  });
  return { id: row.id, email: row.email, name: row.name ?? local };
}

function as<T>(user: U, org: string, fn: (ctx: OrgContext) => Promise<T>): Promise<T> {
  requireUserMock.mockResolvedValue(user);
  return withOrgTx(org, fn);
}

beforeAll(async () => {
  try {
    ownerA = await makeUser("p5-owner-a");
    memberA = await makeUser("p5-member-a");
    ownerB = await makeUser("p5-owner-b");
    await ownerDb.organization.createMany({
      data: [
        { id: orgA, name: "Phase 5 A", slug: `p5-a-${tag}`, timezone: "UTC", plan: "SOCIETY" },
        { id: orgB, name: "Phase 5 B", slug: `p5-b-${tag}`, timezone: "UTC", plan: "SOCIETY" },
      ],
    });
    await ownerDb.membership.createMany({
      data: [
        { organizationId: orgA, userId: ownerA.id, role: "OWNER" },
        { organizationId: orgA, userId: memberA.id, role: "MEMBER" },
        { organizationId: orgB, userId: ownerB.id, role: "OWNER" },
      ],
    });
    for (const id of [orgA, orgB]) {
      await ownerDb.orgSettings.upsert({
        where: { organizationId: id },
        create: { organizationId: id, addOns: ["crm"] },
        update: { addOns: ["crm"] },
      });
    }
    await as(ownerA, orgA, (ctx) => runSetup(ctx, ["clients"]));
    await as(ownerB, orgB, (ctx) => runSetup(ctx, ["clients"]));
  } catch (error) {
    console.warn("[phase5.db.test] skipped:", error instanceof Error ? error.message : error);
    reachable = false;
  }
});

afterAll(async () => {
  if (reachable) {
    await ownerDb.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await ownerDb.user.deleteMany({ where: { id: { in: [ownerA, memberA, ownerB].filter(Boolean).map((u) => u.id) } } });
  }
  await disconnectAll();
  await disconnectOwnerDb();
});

describe("Phase 5 against the local database", () => {
  it("the API creates, updates, trashes and pages in the key's organization only", async () => {
    if (!reachable) return;
    // Members can't make keys (RLS on CrmApiKey).
    await expect(as(memberA, orgA, (ctx) => createApiKey(ctx.db, orgA, memberA.id, { name: "x", write: true }))).rejects.toThrow();
    const write = await as(ownerA, orgA, (ctx) => createApiKey(ctx.db, orgA, ownerA.id, { name: "Zapier", write: true }));
    const read = await as(ownerA, orgA, (ctx) => createApiKey(ctx.db, orgA, ownerA.id, { name: "Sheet", write: false }));
    const stored = await ownerDb.crmApiKey.findUniqueOrThrow({ where: { id: write.id } });
    expect(stored.keyHash).toBe(hashApiKey(write.key));
    expect(stored.keyHash).not.toContain(write.key);
    const keyA = { keyId: write.id, organizationId: orgA, scopes: ["read", "write"] as ("read" | "write")[], createdById: ownerA.id };
    const readOnly = { ...keyA, keyId: read.id, scopes: ["read"] as ("read" | "write")[] };

    const made = await handleApi(keyA, "POST", ["people"], new URLSearchParams(), { name: "Api Person", email: "API@Example.org", title: "Lead" });
    expect(made.status).toBe(201);
    const person = made.body as { id: string; email: string; trashed: boolean };
    expect(person.email).toBe("api@example.org");
    const history = await ownerDb.crmFieldHistory.findMany({ where: { targetId: person.id }, select: { source: true, changedById: true } });
    expect(history.every((h) => h.source === "api" && h.changedById === null)).toBe(true);

    const patched = await handleApi(keyA, "PATCH", ["people", person.id], new URLSearchParams(), { title: "Director" });
    expect((patched.body as { title: string }).title).toBe("Director");
    const bad = await handleApi(keyA, "PATCH", ["people", person.id], new URLSearchParams(), { nope: 1 });
    expect(bad.status).toBe(422);
    expect(await handleApi(readOnly, "POST", ["people"], new URLSearchParams(), { name: "x" })).toMatchObject({ status: 403 });

    for (const n of [1, 2, 3]) await handleApi(keyA, "POST", ["people"], new URLSearchParams(), { name: `Paged ${n}` });
    const first = await handleApi(readOnly, "GET", ["people"], new URLSearchParams({ limit: "2", q: "Paged" }), undefined);
    const p1 = first.body as { data: { name: string }[]; hasMore: boolean; nextCursor: string };
    expect(p1.data.map((d) => d.name)).toEqual(["Paged 3", "Paged 2"]);
    expect(p1.hasMore).toBe(true);
    const second = await handleApi(readOnly, "GET", ["people"], new URLSearchParams({ limit: "2", q: "Paged", cursor: p1.nextCursor }), undefined);
    expect((second.body as { data: { name: string }[]; hasMore: boolean }).data.map((d) => d.name)).toEqual(["Paged 1"]);

    const trashed = await handleApi(keyA, "PATCH", ["people", person.id], new URLSearchParams(), { trashed: true });
    expect((trashed.body as { trashed: boolean }).trashed).toBe(true);
    expect(await ownerDb.crmPerson.count({ where: { id: person.id } })).toBe(1);

    // An item through the API, moved by stage.
    const pipes = await ownerDb.crmPipeline.findFirstOrThrow({ where: { organizationId: orgA }, include: { stages: { orderBy: { sortOrder: "asc" } } } });
    const item = await handleApi(keyA, "POST", ["items"], new URLSearchParams(), { pipelineId: pipes.id, title: "Website rebuild", amountCents: 250_000 });
    expect(item.status).toBe(201);
    expect((item.body as { amountCents: number }).amountCents).toBe(250_000);
    const open2 = pipes.stages.filter((s) => s.kind === "OPEN")[1]!;
    const moved = await handleApi(keyA, "PATCH", ["items", (item.body as { id: string }).id], new URLSearchParams(), { stageId: open2.id });
    expect((moved.body as { stageId: string }).stageId).toBe(open2.id);

    // Another organization's key sees none of it.
    const keyB = { ...keyA, organizationId: orgB };
    expect((await handleApi(keyB, "GET", ["people", person.id], new URLSearchParams(), undefined)).status).toBe(404);
    expect((await handleApi(keyB, "PATCH", ["people", person.id], new URLSearchParams(), { title: "x" })).status).toBe(404);
  });

  it("numbers quotes, and a typed-name acceptance moves the item to won", async () => {
    if (!reachable) return;
    const pipeline = (await as(ownerA, orgA, (ctx) => listPipelines(ctx.db, orgA)))[0]!;
    const deal = await as(memberA, orgA, (ctx) => createDeal(ctx, { pipelineId: pipeline.id, title: "Spring sponsorship", amount: 1500 }));
    const q1 = await as(memberA, orgA, (ctx) => createQuote(ctx, { dealId: deal.id }));
    const q2 = await as(memberA, orgA, (ctx) => createQuote(ctx, { dealId: deal.id }));
    const inv = await as(memberA, orgA, (ctx) => createQuote(ctx, { dealId: deal.id, kind: "invoice" }));
    expect([q1.number, q2.number, inv.number]).toEqual(["Q-0001", "Q-0002", "INV-0001"]);
    await as(memberA, orgA, (ctx) =>
      saveQuote(ctx, q1.id, { lines: [{ description: "Booth", quantity: 2, unitCents: 50_000 }, { description: "Logo", quantity: 1, unitCents: 25_000 }], taxBps: 1000 }),
    );
    const { token } = await as(memberA, orgA, (ctx) => sendQuote(ctx, q1.id));
    const row = await ownerDb.crmQuote.findUniqueOrThrow({ where: { id: q1.id } });
    expect(row.status).toBe("SENT");
    expect(row.totalCents).toBe(137_500);
    expect(row.publicTokenHash).not.toContain(token.split(".")[1]!);

    const view = await loadPublicQuote(token);
    expect(view).toMatchObject({ number: "Q-0001", totalCents: 137_500, canRespond: true });
    expect(await loadPublicQuote(`${orgA}.${"x".repeat(43)}`)).toBeNull();
    // A token for one organization can't open another's quote.
    expect(await loadPublicQuote(`${orgB}.${token.split(".")[1]}`)).toBeNull();

    expect(await respondToQuote(token, { accept: true, name: "x", ip: "203.0.113.9" })).toMatchObject({ ok: false });
    expect(await respondToQuote(token, { accept: true, name: "Mara Quinn", ip: "203.0.113.9" })).toMatchObject({ ok: true });
    const accepted = await ownerDb.crmQuote.findUniqueOrThrow({ where: { id: q1.id } });
    expect(accepted).toMatchObject({ status: "ACCEPTED", acceptedName: "Mara Quinn" });
    expect(accepted.acceptedIpHash).toMatch(/^[0-9a-f]{64}$/);
    expect(accepted.acceptedIpHash).not.toContain("203.0.113.9");
    const won = await ownerDb.crmDeal.findUniqueOrThrow({ where: { id: deal.id }, include: { stage: true } });
    expect(won.stage.kind).toBe("WON");
    expect(await respondToQuote(token, { accept: true, name: "Mara Quinn", ip: "203.0.113.9" })).toMatchObject({ ok: false });
    // Re-sending makes a new link; the old one stops working.
    await as(memberA, orgA, (ctx) => saveQuote(ctx, q2.id, { lines: [{ description: "x", quantity: 1, unitCents: 100 }] }));
    const t1 = (await as(memberA, orgA, (ctx) => sendQuote(ctx, q2.id))).token;
    const t2 = (await as(memberA, orgA, (ctx) => sendQuote(ctx, q2.id))).token;
    expect(await loadPublicQuote(t1)).toBeNull();
    expect(await loadPublicQuote(t2)).not.toBeNull();
  });

  it("STOP and START on an incoming text set consent and do-not-contact", async () => {
    if (!reachable) return;
    const { id } = await as(memberA, orgA, (ctx) => createPerson(ctx, { name: "Text Person", phone: "(617) 555-0101" }));
    await ownerDb.crmPerson.update({
      where: { id },
      data: { consent: { text: { granted: true, how: "verbal", at: new Date().toISOString() } } },
    });
    const stop = await withSystemOrgTx(orgA, ({ db }) =>
      receiveText(db, orgA, { provider: "telnyx", from: "+16175550101", to: "+15550000000", body: "STOP", providerMessageId: `m1${tag}` }),
    );
    expect(stop).toMatchObject({ keyword: "stop", matched: true });
    let p = await ownerDb.crmPerson.findUniqueOrThrow({ where: { id } });
    expect(p.doNotContact).toBe(true);
    expect((p.consent as { text: { granted: boolean; how: string } }).text).toMatchObject({ granted: false, how: "texted STOP" });
    // The same message again is ignored.
    expect(
      await withSystemOrgTx(orgA, ({ db }) =>
        receiveText(db, orgA, { provider: "telnyx", from: "+16175550101", to: "+15550000000", body: "STOP", providerMessageId: `m1${tag}` }),
      ),
    ).toBeNull();
    await withSystemOrgTx(orgA, ({ db }) =>
      receiveText(db, orgA, { provider: "telnyx", from: "+1 617 555 0101", to: "+15550000000", body: "start", providerMessageId: `m2${tag}` }),
    );
    p = await ownerDb.crmPerson.findUniqueOrThrow({ where: { id } });
    expect(p.doNotContact).toBe(false);
    expect((p.consent as { text: { granted: boolean } }).text.granted).toBe(true);
    const texts = await ownerDb.crmActivity.count({ where: { organizationId: orgA, kind: "TEXT", sourceKind: "text" } });
    expect(texts).toBe(2);
    // Another organization's text from the same number matches nobody there.
    const other = await withSystemOrgTx(orgB, ({ db }) =>
      receiveText(db, orgB, { provider: "telnyx", from: "+16175550101", to: "+15550000001", body: "hi", providerMessageId: `m3${tag}` }),
    );
    expect(other).toMatchObject({ matched: false });
  });

  it("an active webhook makes a member's change queue an event", async () => {
    if (!reachable) return;
    const countEvents = () => ownerDb.job.count({ where: { organizationId: orgB, kind: "crm-event" } });
    const before = await countEvents();
    await as(ownerB, orgB, (ctx) => createPerson(ctx, { name: "Before hook" }));
    expect(await countEvents()).toBe(before);
    await as(ownerB, orgB, (ctx) => createWebhook(ctx.db, orgB, ownerB.id, { url: "https://hooks.example.com/catch", events: ["person.created"] }));
    expect((await ownerDb.crmSettings.findUniqueOrThrow({ where: { organizationId: orgB } })).webhookEvents).toEqual(["person.created"]);
    await as(ownerB, orgB, (ctx) => createPerson(ctx, { name: "After hook" }));
    expect(await countEvents()).toBe(before + 1);
    await expect(
      as(ownerB, orgB, (ctx) => createWebhook(ctx.db, orgB, ownerB.id, { url: "https://10.0.0.1/x", events: ["person.created"] })),
    ).rejects.toThrow(/private/);
  });
});
