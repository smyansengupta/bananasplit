// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Each organization's own keys against the real roles and policies on the
 * local database: an admin saves a Tavily key (stored encrypted, shown
 * back only as "tvly-…" and its last four), a member can't, only an owner
 * removes; the meter counts searches, texts and minutes on the right key;
 * the monthly spending cap refuses more work with a plain message; and the
 * CRM never falls back to Bananasplit's own Claude key. Skipped when the
 * database is not reachable.
 */

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock, getSession: vi.fn() }));
vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));
vi.mock("@/server/org-chart/queries", () => ({ getPublishedOrgChart: vi.fn(async () => null) }));

import { ForbiddenError } from "@/lib/auth/errors";
import { NO_AI_KEY_MESSAGE } from "@/lib/crm/org-keys";
import { authDb, disconnectAll } from "@/server/db/clients";
import { withOrgTx } from "@/server/db/context";
import { resolveActor } from "@/server/integrations/service";
import { getSecret } from "@/server/secrets";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";

import { CrmError } from "./access";
import { crmCredentials } from "./ai";
import { dataClients } from "./data-connectors";
import { loadOrgKeys, removeOrgKey, saveOrgKey, testOrgKey } from "./org-keys";
import { summarizeTranscript } from "./phone/summary";
import { runSetup } from "./setup";
import { assertCanSpend, costOf, meterUse, underCap } from "./spend";

const tag = randomBytes(4).toString("hex");
const orgA = `c_orgkeys_${tag}`;
const TAVILY_KEY = `tvly-${randomBytes(12).toString("hex")}4f2a`;

type U = { id: string; email: string; name: string };
let owner: U;
let admin: U;
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

function signIn(user: U) {
  requireUserMock.mockResolvedValue(user);
}

beforeAll(async () => {
  try {
    owner = await makeUser("orgkeys-owner");
    admin = await makeUser("orgkeys-admin");
    member = await makeUser("orgkeys-member");
    await ownerDb.organization.create({
      data: { id: orgA, name: "Org Keys Test", slug: `org-keys-test-${tag}`, timezone: "UTC", plan: "SOCIETY" },
    });
    await ownerDb.membership.createMany({
      data: [
        { organizationId: orgA, userId: owner.id, role: "OWNER" },
        { organizationId: orgA, userId: admin.id, role: "ADMIN" },
        { organizationId: orgA, userId: member.id, role: "MEMBER" },
      ],
    });
    await ownerDb.orgSettings.upsert({
      where: { organizationId: orgA },
      create: { organizationId: orgA, addOns: ["crm"] },
      update: { addOns: ["crm"] },
    });
    signIn(owner);
    await withOrgTx(orgA, (ctx) => runSetup(ctx, ["sponsors"]));
  } catch (error) {
    console.warn("[org-keys.db.test] skipped:", error instanceof Error ? error.message : error);
    reachable = false;
  }
});

afterAll(async () => {
  vi.restoreAllMocks();
  if (reachable) {
    await ownerDb.organization.deleteMany({ where: { id: orgA } });
    await ownerDb.user.deleteMany({ where: { id: { in: [owner, admin, member].filter(Boolean).map((u) => u.id) } } });
  }
  await disconnectAll();
  await disconnectOwnerDb();
});

describe("the organization's own keys", () => {
  it("lets an admin save and test a key, shows it masked, and never returns it", async () => {
    if (!reachable) return;
    // Tavily's usage endpoint, faked: the test is the account's (free) usage.
    vi.spyOn(dataClients, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ key: { usage: 12, limit: 1000 } }), { status: 200, headers: { "content-type": "application/json" } }),
    );

    signIn(member);
    await expect(saveOrgKey(orgA, await resolveActor(orgA), "tavily", { apiKey: TAVILY_KEY })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(loadOrgKeys(orgA, await resolveActor(orgA))).rejects.toBeInstanceOf(ForbiddenError);

    signIn(admin);
    const actor = await resolveActor(orgA);
    const saved = await saveOrgKey(orgA, actor, "tavily", { apiKey: TAVILY_KEY });
    expect(saved.ok).toBe(true);
    expect(JSON.stringify(saved)).not.toContain(TAVILY_KEY);
    expect(await getSecret({ orgId: orgA, provider: "TAVILY", kind: "API_KEY" })).toBe(TAVILY_KEY);
    const row = await ownerDb.orgSecret.findFirst({ where: { organizationId: orgA }, select: { ciphertext: true } });
    expect(Buffer.from(row!.ciphertext).toString("utf8")).not.toContain(TAVILY_KEY);

    expect((await testOrgKey(orgA, actor, "tavily")).ok).toBe(true);
    const view = await loadOrgKeys(orgA, actor);
    const tavily = view.keys.find((k) => k.id === "tavily")!;
    expect(tavily).toMatchObject({ masked: "tvly-…4f2a", status: "connected" });
    expect(JSON.stringify(view)).not.toContain(TAVILY_KEY);
    expect(view.canRemove).toBe(false);
    expect(view.keys.find((k) => k.id === "anthropic")!.status).toBe("none");

    // Only owners remove a key.
    await expect(removeOrgKey(orgA, actor, "tavily")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("meters each use on its own key and counts it toward the month", async () => {
    if (!reachable) return;
    await meterUse({ organizationId: orgA, userId: admin.id, feature: "crm.research", provider: "tavily", what: "tavily.search", units: 2 });
    await meterUse({ organizationId: orgA, userId: admin.id, feature: "crm.text", provider: "twilio", what: "text.segment" });
    await meterUse({ organizationId: orgA, userId: admin.id, feature: "crm.call", provider: "twilio", what: "call.minute", units: 3 });
    signIn(admin);
    const view = await loadOrgKeys(orgA, await resolveActor(orgA));
    expect(view.keys.find((k) => k.id === "tavily")).toMatchObject({ spentMicros: costOf("tavily.search", 2), uses: 1 });
    expect(view.keys.find((k) => k.id === "twilio")).toMatchObject({
      spentMicros: costOf("text.segment") + costOf("call.minute", 3),
      uses: 2,
    });
    expect(view.spentMicros).toBe(costOf("tavily.search", 2) + costOf("text.segment") + costOf("call.minute", 3));
  });

  it("refuses work past the monthly spending cap, in plain words", async () => {
    if (!reachable) return;
    await ownerDb.crmSettings.update({ where: { organizationId: orgA }, data: { aiMonthlyCapCents: 5 } });
    try {
      expect(await underCap(orgA)).toBe(false);
      const refused = await assertCanSpend(orgA, costOf("text.segment")).catch((e: unknown) => e);
      expect(refused).toBeInstanceOf(CrmError);
      expect((refused as Error).message).toBe(
        "Your organization has reached this month's spending cap of $0.05. An owner or admin can raise it in CRM settings > Connections.",
      );
    } finally {
      await ownerDb.crmSettings.update({ where: { organizationId: orgA }, data: { aiMonthlyCapCents: null } });
    }
    expect(await underCap(orgA)).toBe(true);
  });

  it("never runs the CRM on Bananasplit's own Claude key", async () => {
    if (!reachable) return;
    const env = { ANTHROPIC_API_KEY: "sk-ant-platform-key-for-test" };
    expect(await crmCredentials(orgA, env)).toBeNull();
    // With BANANASPLIT_AI switched on (the later plan) it may.
    expect((await crmCredentials(orgA, { ...env, BANANASPLIT_AI: "1" }))?.id).toBe("platform");
  });

  it("asks for a key when there's no AI, instead of failing", async () => {
    if (!reachable || process.env.AI_STANDIN === "1") return;
    const r = await summarizeTranscript(orgA, { transcript: "We'll send the deck by Friday.", kind: "call" });
    expect(r).toEqual({ ok: false, reason: "no-ai", message: NO_AI_KEY_MESSAGE });
  });

  it("lets an owner remove a key", async () => {
    if (!reachable) return;
    signIn(owner);
    const actor = await resolveActor(orgA);
    expect(await removeOrgKey(orgA, actor, "tavily")).toEqual({ ok: true, message: "Removed. The Tavily key was deleted." });
    const view = await loadOrgKeys(orgA, actor);
    expect(view.canRemove).toBe(true);
    expect(view.keys.find((k) => k.id === "tavily")).toMatchObject({ masked: null, status: "none" });
  });
});
