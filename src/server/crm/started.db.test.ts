// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * "Get your CRM started" against the real roles and policies on the local
 * database: a first visit before the CRM's settings exist reads without
 * writing, the first answer makes the row, a step finishes itself when the
 * thing exists, an owner checks off organization steps and a member only
 * their own, and Hide's Undo puts back exactly what was there, leaving
 * Home's entries alone. Skipped when the database is not reachable.
 */

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock, getSession: vi.fn() }));
vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));
vi.mock("@/server/org-chart/queries", () => ({ getPublishedOrgChart: vi.fn(async () => null) }));

import { crmStartedProgress } from "@/lib/crm/started";
import { ensurePersonalLink, updateLink } from "@/server/booking/links";
import { authDb, disconnectAll } from "@/server/db/clients";
import { withOrgTx, type OrgContext } from "@/server/db/context";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";

import { crmAccess, CrmError } from "./access";
import { saveMemberSettings } from "./outreach/member";
import { runSetup, shareOutOwners } from "./setup";
import { hideCrmStarted, loadCrmStarted, restoreCrmStarted, setCrmStepSkipped } from "./started";

const tag = randomBytes(4).toString("hex");
const org = `c_started_${tag}`;

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
  return withOrgTx(org, fn as never) as Promise<T>;
}

async function load(user: U) {
  const access = await as(user, (ctx) => crmAccess(ctx));
  requireUserMock.mockResolvedValue(user);
  requireUserMock.mockResolvedValue(user);
  const data = await loadCrmStarted({ organizationId: org, userId: user.id, access });
  const viewer = { admin: access.admin, personal: access.personal };
  return { access, data, viewer };
}

beforeAll(async () => {
  try {
    owner = await makeUser("started-owner");
    member = await makeUser("started-member");
    await ownerDb.organization.create({
      data: { id: org, name: "Started Test", slug: `started-${tag}`, timezone: "UTC", plan: "SOCIETY" },
    });
    await ownerDb.membership.createMany({
      data: [
        { organizationId: org, userId: owner.id, role: "OWNER" },
        { organizationId: org, userId: member.id, role: "MEMBER" },
      ],
    });
    await ownerDb.orgSettings.upsert({
      where: { organizationId: org },
      create: { organizationId: org, addOns: ["crm"], startedSkipped: ["database"] },
      update: { addOns: ["crm"], startedSkipped: ["database"] },
    });
  } catch (error) {
    console.warn("[started.db.test] skipped:", error instanceof Error ? error.message : error);
    reachable = false;
  }
});

afterAll(async () => {
  if (reachable) {
    await ownerDb.organization.deleteMany({ where: { id: org } });
    await ownerDb.user.deleteMany({
      where: { id: { in: [owner, member].filter(Boolean).map((u) => u.id) } },
    });
  }
  await disconnectAll();
  await disconnectOwnerDb();
});

describe("Get your CRM started", () => {
  it("reads a first visit without writing anything, and offers who to bring in", async () => {
    if (!reachable) return;
    const { access, data, viewer } = await load(owner);
    expect(access.settings).toBeNull();
    expect(data.state.kinds).toBe(false);
    expect(data.counts?.members).toBe(2);
    expect(crmStartedProgress(viewer, data.state, data.skipped).finished).toBe(0);
    expect(data.signature).toBe("started-owner\nStarted Test");
    expect(data.meetingLink).toMatch(/^[^/]+\/book\/started-owner-…$/);
    expect(data.quarter).toMatch(/^\d{4}-Q[1-4]$/);
    expect(await ownerDb.crmSettings.findUnique({ where: { organizationId: org } })).toBeNull();
    expect(await ownerDb.crmMemberSettings.count({ where: { organizationId: org } })).toBe(0);
    expect(await ownerDb.crmBookingPage.count({ where: { organizationId: org } })).toBe(0);
  });

  it("makes the CRM from the first answer, and that step finishes itself", async () => {
    if (!reachable) return;
    await as(owner, (ctx) => runSetup(ctx, ["members"]));
    const { access, data } = await load(owner);
    expect(access.settings).not.toBeNull();
    expect(data.state.kinds).toBe(true);
  });

  it("finishes your signature and meeting link steps when they exist, for a member too", async () => {
    if (!reachable) return;
    const before = await load(member);
    expect(before.data.state).toMatchObject({ mailbox: false, booking: false });
    expect(
      crmStartedProgress(before.viewer, before.data.state, before.data.skipped).steps.map(
        (s) => s.key,
      ),
    ).toEqual(["booking", "mailbox"]);
    expect(before.data.quarter).toBeNull();
    await as(member, (ctx) => saveMemberSettings(ctx, { signature: "Sam" }));
    await as(member, async (ctx) => {
      const link = await ensurePersonalLink(ctx);
      await updateLink(ctx, link.id, { active: true });
    });
    const after = await load(member);
    expect(after.data.state).toMatchObject({ mailbox: true, booking: true });
    expect(crmStartedProgress(after.viewer, after.data.state, after.data.skipped).complete).toBe(true);
  });

  it("lets a member check off only their own steps", async () => {
    if (!reachable) return;
    const { access } = await load(member);
    await as(member, (ctx) => setCrmStepSkipped(ctx, access, "booking", true));
    expect((await load(member)).data.skipped).toEqual(["booking"]);
    await expect(
      as(member, (ctx) => setCrmStepSkipped(ctx, access, "goal", true)),
    ).rejects.toBeInstanceOf(CrmError);
    await as(member, (ctx) => setCrmStepSkipped(ctx, access, "booking", false));
    expect((await load(member)).data.skipped).toEqual([]);
  });

  it("never checks off the first answer", async () => {
    if (!reachable) return;
    const { access } = await load(owner);
    await expect(
      as(owner, (ctx) => setCrmStepSkipped(ctx, access, "kinds", true)),
    ).rejects.toBeInstanceOf(CrmError);
  });

  it("keeps an owner's checked-off steps beside Home's, and a member doesn't see them", async () => {
    if (!reachable) return;
    const { access } = await load(owner);
    await as(owner, (ctx) => setCrmStepSkipped(ctx, access, "goal", true));
    const row = await ownerDb.orgSettings.findUnique({
      where: { organizationId: org },
      select: { startedSkipped: true },
    });
    expect(row?.startedSkipped.sort()).toEqual(["crm:goal", "database"]);
    expect((await load(owner)).data.skipped).toEqual(["goal"]);
    expect((await load(member)).data.skipped).toEqual([]);
  });

  it("hides everything, and Undo puts back exactly what was there", async () => {
    if (!reachable) return;
    // A step that has left the list keeps its entry through all of this.
    await ownerDb.orgSettings.update({
      where: { organizationId: org },
      data: { startedSkipped: { push: "crm:phone" } },
    });
    const { access, viewer } = await load(owner);
    const previous = await as(owner, (ctx) => hideCrmStarted(ctx, access));
    expect(previous).toEqual({ org: ["crm:goal"], own: [] });
    const hidden = await load(owner);
    expect(crmStartedProgress(viewer, hidden.data.state, hidden.data.skipped).complete).toBe(true);

    await as(owner, (ctx) => restoreCrmStarted(ctx, access, previous));
    const back = await load(owner);
    expect(back.data.skipped).toEqual(["goal"]);
    const row = await ownerDb.orgSettings.findUnique({
      where: { organizationId: org },
      select: { startedSkipped: true },
    });
    expect(row?.startedSkipped.sort()).toEqual(["crm:goal", "crm:phone", "database"]);
  });

  it("finishes who looks after them once new people have somewhere to go", async () => {
    if (!reachable) return;
    expect((await load(owner)).data.state.owner).toBe(false);
    await as(owner, (ctx) => shareOutOwners(ctx, "split", new Date(0)));
    expect((await load(owner)).data.state.owner).toBe(true);
  });
});
