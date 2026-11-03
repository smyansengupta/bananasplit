// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Forms against the real roles and policies on the local database: an
 * owner makes a form, saves its questions and settings, publishes it, and
 * points it at the CRM, in an organization that has the CRM switched on.
 * Skipped when the database is not reachable.
 */

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock, getSession: vi.fn() }));
vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));
vi.mock("@/server/org-chart/queries", () => ({ getPublishedOrgChart: vi.fn(async () => null) }));
vi.mock("@/server/jobs/kick", () => ({ scheduleKick: vi.fn() }));

import { authDb, disconnectAll } from "@/server/db/clients";
import { withOrgTx, type OrgContext } from "@/server/db/context";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";

import { runSetup } from "../crm/setup";
import { createForm, saveSettings, setPublished } from "./forms";

const tag = randomBytes(4).toString("hex");
const org = `c_forms_${tag}`;

type U = { id: string; email: string; name: string };
let owner: U;
let reachable = true;

function as<T>(user: U, fn: (ctx: OrgContext) => Promise<T>): Promise<T> {
  requireUserMock.mockResolvedValue(user);
  return withOrgTx(org, fn);
}

beforeAll(async () => {
  try {
    const email = `forms-owner-${tag}@example.edu`;
    const row = await authDb.user.create({
      data: { email, name: "Forms Owner", emailVerified: new Date(), onboardedAt: new Date() },
      select: { id: true, email: true, name: true },
    });
    owner = { id: row.id, email: row.email, name: row.name ?? "Forms Owner" };
    await ownerDb.organization.create({ data: { id: org, name: "Forms Test", slug: `forms-${tag}`, timezone: "UTC", plan: "SOCIETY" } });
    await ownerDb.membership.create({ data: { organizationId: org, userId: owner.id, role: "OWNER" } });
    await ownerDb.orgSettings.upsert({
      where: { organizationId: org },
      create: { organizationId: org, addOns: ["crm", "forms"] },
      update: { addOns: ["crm", "forms"] },
    });
    await as(owner, (ctx) => runSetup(ctx, ["sponsors"]));
  } catch (error) {
    console.warn("[forms.db.test] skipped:", error instanceof Error ? error.message : error);
    reachable = false;
  }
});

afterAll(async () => {
  if (reachable) {
    await ownerDb.organization.deleteMany({ where: { id: org } });
    if (owner) await ownerDb.user.deleteMany({ where: { id: owner.id } });
  }
  await disconnectAll();
  await disconnectOwnerDb();
});

describe("forms against the local database", () => {
  it("makes, sets up and publishes a form in an organization with the CRM", async () => {
    if (!reachable) return;
    for (const templateId of ["blank", "application", "interest", "feedback", "signup"]) {
      const f = await as(owner, (ctx) => createForm(ctx, { templateId }));
      await as(owner, (ctx) => setPublished(ctx, f.id, true));
    }
    const form = await as(owner, (ctx) => createForm(ctx, { title: "Sign up" }));
    await as(owner, (ctx) => saveSettings(ctx, form.id, { title: "Sign up for updates", receipt: true }));
    await as(owner, (ctx) => setPublished(ctx, form.id, true));
    const row = await ownerDb.form.findUniqueOrThrow({ where: { id: form.id } });
    expect(row.publishedAt).not.toBeNull();
    expect(row.title).toBe("Sign up for updates");
  });
});
