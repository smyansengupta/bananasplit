// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The CRM in the rest of the app, against the real roles and policies:
 * workspace search finds CRM people, companies and deals only where the
 * CRM is added and on the plan, and only the ones the member may see
 * (OWN access); an open task linked to a record is its next step (People's
 * cell, Today's "no next step"), and completing it clears that; the links
 * out of Finance and a member's page find the same record. One throwaway
 * organization, removed in afterAll. Skipped when the database is not
 * reachable.
 */

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock, getSession: vi.fn() }));
vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));
vi.mock("@/server/org-chart/queries", () => ({ getPublishedOrgChart: vi.fn(async () => null) }));

import { crmRecordHref } from "@/lib/crm/href";
import type { SearchResponse } from "@/lib/search/types";
import { authDb, disconnectAll } from "@/server/db/clients";
import { withOrgTx, type OrgContext } from "@/server/db/context";
import { loadSearchViewer } from "@/server/search/viewer";
import { searchWorkspace } from "@/server/search/workspace";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";

import { createCompany } from "./companies";
import { createDeal } from "./deals";
import { crmPersonForMember, financeCrmLinks } from "./outside-links";
import { createPerson } from "./people";
import { listPipelines } from "./pipelines";
import { todayList } from "./queries";
import { runSetup } from "./setup";
import { taskSteps } from "./task-steps";

const tag = randomBytes(4).toString("hex");
const orgId = `c_crmlinks_${tag}`;
const slug = `crm-links-${tag}`;
type U = { id: string; email: string; name: string };
let owner: U;
let member: U;
let reachable = true;
const ids = { ownersPerson: "", membersPerson: "", company: "", deal: "", sponsor: "", sponsorship: "" };

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
  return withOrgTx(orgId, fn);
}

async function search(user: U, query: string): Promise<SearchResponse> {
  return as(user, async (ctx) => {
    const viewer = await loadSearchViewer(ctx.db, ctx);
    return searchWorkspace(ctx.db, viewer!, { query, scope: "crm" });
  });
}

const keys = (res: SearchResponse) => res.groups.flatMap((g) => g.hits.map((h) => h.key));

beforeAll(async () => {
  try {
    owner = await makeUser("crmlinks-owner");
    member = await makeUser("crmlinks-member");
    await ownerDb.organization.create({
      data: { id: orgId, name: "CRM Links", slug, timezone: "UTC", plan: "SOCIETY" },
    });
    await ownerDb.membership.createMany({
      data: [
        { organizationId: orgId, userId: owner.id, role: "OWNER" },
        { organizationId: orgId, userId: member.id, role: "MEMBER" },
      ],
    });
    await ownerDb.orgSettings.upsert({
      where: { organizationId: orgId },
      create: { organizationId: orgId, addOns: ["crm", "finance"] },
      update: { addOns: ["crm", "finance"] },
    });
    await as(owner, (ctx) => runSetup(ctx, ["donors"]));
    ids.ownersPerson = (
      await as(owner, (ctx) =>
        createPerson(ctx, { name: `Zephyr Owned ${tag}`, primaryEmail: `zo-${tag}@example.org` }),
      )
    ).id;
    // The member is a CRM person too, linked by their email.
    ids.membersPerson = (
      await as(member, (ctx) =>
        createPerson(ctx, { name: `Zephyr Member ${tag}`, primaryEmail: member.email }),
      )
    ).id;
    ids.company = (await as(owner, (ctx) => createCompany(ctx, { name: `Zephyr Works ${tag}` }))).id;
    const pipelines = await as(owner, (ctx) => listPipelines(ctx.db, orgId));
    ids.deal = (
      await as(owner, (ctx) =>
        createDeal(ctx, { pipelineId: pipelines[0]!.id, title: `Zephyr pledge ${tag}` }),
      )
    ).id;
    // A Finance partner tied to the company, and a Finance deal tied to the CRM deal.
    const period = await ownerDb.budgetPeriod.create({
      data: {
        organizationId: orgId,
        label: "2026",
        startsOn: new Date("2026-01-01"),
        endsOn: new Date("2026-12-31"),
        isActive: true,
      },
    });
    ids.sponsor = (
      await ownerDb.sponsor.create({ data: { organizationId: orgId, name: `Zephyr Works ${tag}` } })
    ).id;
    ids.sponsorship = (
      await ownerDb.sponsorship.create({
        data: {
          organizationId: orgId,
          sponsorId: ids.sponsor,
          budgetPeriodId: period.id,
          amountCents: 50_000,
          ownerId: owner.id,
        },
      })
    ).id;
    await ownerDb.crmCompany.update({ where: { id: ids.company }, data: { sponsorId: ids.sponsor } });
    await ownerDb.crmDeal.update({ where: { id: ids.deal }, data: { sponsorshipId: ids.sponsorship } });
  } catch (error) {
    console.warn("[crm-links.db.test] skipped:", error instanceof Error ? error.message : error);
    reachable = false;
  }
});

afterAll(async () => {
  if (reachable) {
    await ownerDb.organization.deleteMany({ where: { id: orgId } });
    await ownerDb.user.deleteMany({
      where: { id: { in: [owner, member].filter(Boolean).map((u) => u.id) } },
    });
  }
  await disconnectAll();
  await disconnectOwnerDb();
});

describe("CRM search", () => {
  it("finds people, companies and deals, each opening its card", async () => {
    if (!reachable) return;
    const res = await search(member, `zephyr ${tag}`);
    expect(res.groups.map((g) => g.id)).toEqual(["crm"]);
    expect(keys(res)).toEqual(
      expect.arrayContaining([
        `crm-person:${ids.ownersPerson}`,
        `crm-person:${ids.membersPerson}`,
        `crm-company:${ids.company}`,
        `crm-deal:${ids.deal}`,
      ]),
    );
    const deal = res.groups[0]!.hits.find((h) => h.key === `crm-deal:${ids.deal}`);
    expect(deal?.href).toBe(crmRecordHref(slug, "deal", ids.deal));
  });

  it("shows a member on OWN access only their own", async () => {
    if (!reachable) return;
    await ownerDb.crmSettings.update({ where: { organizationId: orgId }, data: { memberAccess: "OWN" } });
    try {
      const mine = keys(await search(member, `zephyr ${tag}`));
      expect(mine).toContain(`crm-person:${ids.membersPerson}`);
      expect(mine).not.toContain(`crm-person:${ids.ownersPerson}`);
      expect(mine).not.toContain(`crm-deal:${ids.deal}`);
      // Owners still see everyone's.
      expect(keys(await search(owner, `zephyr ${tag}`))).toContain(`crm-person:${ids.ownersPerson}`);
    } finally {
      await ownerDb.crmSettings.update({ where: { organizationId: orgId }, data: { memberAccess: "ALL" } });
    }
  });

  it("finds nothing in the CRM when it isn't added or isn't on the plan", async () => {
    if (!reachable) return;
    await ownerDb.orgSettings.update({ where: { organizationId: orgId }, data: { addOns: ["finance"] } });
    try {
      expect(keys(await search(owner, `zephyr ${tag}`)).some((k) => k.startsWith("crm-"))).toBe(false);
    } finally {
      await ownerDb.orgSettings.update({ where: { organizationId: orgId }, data: { addOns: ["crm", "finance"] } });
    }
    await ownerDb.organization.update({ where: { id: orgId }, data: { plan: "CLUB" } });
    try {
      expect(keys(await search(owner, `zephyr ${tag}`)).some((k) => k.startsWith("crm-"))).toBe(false);
    } finally {
      await ownerDb.organization.update({ where: { id: orgId }, data: { plan: "SOCIETY" } });
    }
  });
});

describe("a linked task as the next step", () => {
  it("counts while open, for people and deals, and clears when done", async () => {
    if (!reachable) return;
    const task = await ownerDb.task.create({
      data: {
        organizationId: orgId,
        title: "Send the deck",
        rank: "a0",
        createdById: owner.id,
        ownerId: owner.id,
        dueDate: new Date("2026-11-20T00:00:00.000Z"),
      },
    });
    await ownerDb.itemLink.createMany({
      data: [
        { organizationId: orgId, fromKind: "task", fromId: task.id, toKind: "crm-person", toId: ids.ownersPerson },
        { organizationId: orgId, fromKind: "crm-deal", fromId: ids.deal, toKind: "task", toId: task.id },
      ],
    });
    const people = await as(owner, (ctx) => taskSteps(ctx.db, orgId, "person", [ids.ownersPerson, ids.membersPerson]));
    expect(people.get(ids.ownersPerson)).toEqual({ taskId: task.id, title: "Send the deck", dueKey: "2026-11-20" });
    expect(people.has(ids.membersPerson)).toBe(false);
    const noStep = async () =>
      (await as(owner, (ctx) => todayList(ctx.db, orgId, owner.id, new Map(), { mine: false }))).nostep.map((d) => d.id);
    expect(await noStep()).not.toContain(ids.deal);

    await ownerDb.task.update({ where: { id: task.id }, data: { status: "COMPLETED", completedAt: new Date() } });
    const after = await as(owner, (ctx) => taskSteps(ctx.db, orgId, "person", [ids.ownersPerson]));
    expect(after.size).toBe(0);
    expect(await noStep()).toContain(ids.deal);
  });
});

describe("links into the CRM", () => {
  it("finds Finance's partner and deal, and a member who is a CRM person", async () => {
    if (!reachable) return;
    const links = await as(owner, (ctx) =>
      financeCrmLinks(ctx, slug, { sponsors: [{ id: ids.sponsor }], sponsorshipIds: [ids.sponsorship] }),
    );
    expect(links.partners[ids.sponsor]).toBe(crmRecordHref(slug, "company", ids.company));
    expect(links.deals[ids.sponsorship]).toBe(crmRecordHref(slug, "deal", ids.deal));
    expect(await as(owner, (ctx) => crmPersonForMember(ctx, slug, member.id))).toBe(
      crmRecordHref(slug, "person", ids.membersPerson),
    );
    expect(await as(owner, (ctx) => crmPersonForMember(ctx, slug, owner.id))).toBeNull();
  });
});
