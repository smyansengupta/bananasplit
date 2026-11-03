// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * A Personal space's CRM against the real roles and policies on the local
 * database (docs/features/crm.md, "Personal CRM"): Personal Plus sets it up
 * with its own answers and no Member type, the owner adds people and
 * deals, the CRM's databases list in Personal's Databases, and Personal
 * Free is refused. Two throwaway Personal spaces are made as the table
 * owner (one on Plus, one on Free) and removed in afterAll. Skipped when
 * the database is not reachable.
 */

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock, getSession: vi.fn() }));
vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));
vi.mock("@/server/org-chart/queries", () => ({ getPublishedOrgChart: vi.fn(async () => null) }));

import { authDb, disconnectAll } from "@/server/db/clients";
import { withOrgTx, type OrgContext } from "@/server/db/context";
import { LISTED_DEFINITIONS } from "@/server/databases/types";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";

import { crmAccess, CrmError } from "./access";
import { createDeal } from "./deals";
import { createPerson } from "./people";
import { listPipelines } from "./pipelines";
import { runSetup } from "./setup";

const tag = randomBytes(4).toString("hex");
const plusOrg = `c_crmpersonal_plus_${tag}`;
const freeOrg = `c_crmpersonal_free_${tag}`;

type U = { id: string; email: string; name: string };
let plusOwner: U;
let freeOwner: U;
let reachable = true;

async function makeUser(local: string): Promise<U> {
  const email = `${local}-${tag}@example.com`;
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
    plusOwner = await makeUser("crm-personal-plus");
    freeOwner = await makeUser("crm-personal-free");
    // A Personal space starts on Personal Free; Plus is bought, so it moves there after.
    await ownerDb.organization.createMany({
      data: [
        {
          id: plusOrg,
          name: "Plus",
          slug: `crm-p-plus-${tag}`,
          timezone: "UTC",
          kind: "PERSONAL",
          plan: "FREE",
          personalOwnerId: plusOwner.id,
        },
        {
          id: freeOrg,
          name: "Free",
          slug: `crm-p-free-${tag}`,
          timezone: "UTC",
          kind: "PERSONAL",
          plan: "FREE",
          personalOwnerId: freeOwner.id,
        },
      ],
    });
    await ownerDb.organization.update({ where: { id: plusOrg }, data: { plan: "PERSONAL_PLUS" } });
    await ownerDb.membership.createMany({
      data: [
        { organizationId: plusOrg, userId: plusOwner.id, role: "OWNER" },
        { organizationId: freeOrg, userId: freeOwner.id, role: "OWNER" },
      ],
    });
    for (const id of [plusOrg, freeOrg]) {
      await ownerDb.orgSettings.upsert({
        where: { organizationId: id },
        create: { organizationId: id, addOns: ["crm"] },
        update: { addOns: ["crm"] },
      });
    }
  } catch (error) {
    console.warn("[personal.db.test] skipped:", error instanceof Error ? error.message : error);
    reachable = false;
  }
});

afterAll(async () => {
  if (reachable) {
    await ownerDb.organization.deleteMany({ where: { id: { in: [plusOrg, freeOrg] } } });
    await ownerDb.user.deleteMany({
      where: { id: { in: [plusOwner, freeOwner].filter(Boolean).map((u) => u.id) } },
    });
  }
  await disconnectAll();
  await disconnectOwnerDb();
});

describe("the CRM in a Personal space", () => {
  it("sets up on Personal Plus with its own answers, and no Member type", async () => {
    if (!reachable) return;
    const access = await as(plusOwner, plusOrg, (ctx) => crmAccess(ctx));
    expect(access).toMatchObject({
      added: true,
      personal: true,
      onPlan: true,
      admin: true,
      manager: true,
    });
    // "members" isn't a Personal answer, so only Clients is made.
    const r = await as(plusOwner, plusOrg, (ctx) => runSetup(ctx, ["clients", "members"]));
    expect(r.pipelines).toBe(1);
    const pipelines = await as(plusOwner, plusOrg, (ctx) => listPipelines(ctx.db, plusOrg));
    expect(pipelines.map((p) => p.template)).toEqual(["clients"]);
    const settings = await as(plusOwner, plusOrg, (ctx) => crmAccess(ctx));
    expect(settings.settings?.relationshipTypes.map((t) => t.id)).toEqual(["client"]);
  });

  it("adds people and deals, and lists the CRM's databases in Personal's Databases", async () => {
    if (!reachable) return;
    const person = await as(plusOwner, plusOrg, (ctx) =>
      createPerson(ctx, {
        firstName: "Priya",
        lastName: "Raman",
        primaryEmail: `priya-${tag}@example.com`,
      }),
    );
    const [pipeline] = await as(plusOwner, plusOrg, (ctx) => listPipelines(ctx.db, plusOrg));
    const deal = await as(plusOwner, plusOrg, (ctx) =>
      createDeal(ctx, { pipelineId: pipeline!.id, title: "Website redesign", people: [person.id] }),
    );
    expect(deal.id).toBeTruthy();
    const listed = await as(plusOwner, plusOrg, (ctx) =>
      ctx.db.databaseDefinition.findMany({
        where: { organizationId: plusOrg, archivedAt: null, ...LISTED_DEFINITIONS },
        select: { kind: true },
      }),
    );
    const kinds = listed.map((d) => d.kind).sort();
    expect(kinds).toEqual(["CRM_COMPANIES", "CRM_PEOPLE", "CRM_PIPELINE"]);
  });

  it("refuses Personal Free, saying Personal Plus has it", async () => {
    if (!reachable) return;
    const access = await as(freeOwner, freeOrg, (ctx) => crmAccess(ctx));
    expect(access.onPlan).toBe(false);
    const refused = await as(freeOwner, freeOrg, (ctx) => runSetup(ctx, ["clients"])).catch(
      (e) => e,
    );
    expect(refused).toBeInstanceOf(CrmError);
    expect((refused as CrmError).message).toBe("The CRM comes with Personal Plus.");
  });
});
