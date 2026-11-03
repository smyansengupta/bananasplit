// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Forms against the real roles and policies on the local database, in an
 * organization with the CRM switched on: an owner makes a form from each
 * template, saves its settings, publishes it, sends its answers to the CRM
 * (its CRM destination), and someone answers it, which reaches the CRM.
 * Skipped when the database is not reachable.
 */

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock, getSession: vi.fn() }));
vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));
vi.mock("@/server/org-chart/queries", () => ({ getPublishedOrgChart: vi.fn(async () => null) }));
vi.mock("@/server/jobs/kick", () => ({ scheduleKick: vi.fn() }));

import { suggestMap } from "@/lib/crm/outreach/form-map";
import { authDb, disconnectAll } from "@/server/db/clients";
import { withOrgTx, type OrgContext } from "@/server/db/context";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";

import { formToCrm, saveFormDestination } from "../crm/outreach/intake";
import { runSetup } from "../crm/setup";
import { createForm, saveSettings, setPublished } from "./forms";
import { formPageTarget, submitResponse } from "./public";

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
  it("makes, sets up and publishes a form from every template in an organization with the CRM", async () => {
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

  it("sends a form's answers to the CRM: the destination saves, and an answer makes a person", async () => {
    if (!reachable) return;
    const form = await as(owner, (ctx) => createForm(ctx, { templateId: "interest" }));
    const questions = (await ownerDb.form.findUniqueOrThrow({ where: { id: form.id } })).questions as unknown as {
      id: string;
      type: string;
      title: string;
      fieldId?: string;
    }[];
    const map = suggestMap(questions);
    expect(Object.values(map)).toContain("email");
    await as(owner, (ctx) => saveFormDestination(ctx, form.id, { object: "person", map, route: false }));
    await as(owner, (ctx) => setPublished(ctx, form.id, true));
    expect((await ownerDb.form.findUniqueOrThrow({ where: { id: form.id } })).crmDestination).toMatchObject({ object: "person" });

    // Someone answers it.
    const target = await formPageTarget(form.slug);
    expect(target).not.toBeNull();
    const answers: Record<string, unknown> = {};
    for (const q of questions) {
      const key = map[q.id];
      if (key === "email") answers[q.id] = `ada-${tag}@harbor.org`;
      else if (key === "name") answers[q.id] = "Ada Lovelace";
      else if (key === "firstName") answers[q.id] = "Ada";
      else if (key === "lastName") answers[q.id] = "Lovelace";
    }
    const result = await submitResponse(target!, { answers, other: {} } as never, { userId: null, name: null, email: null });
    expect(result.ok).toBe(true);
    const intake = await formToCrm(target!, (result as { responseId: string }).responseId);
    expect(intake?.personId).toBeTruthy();
    const person = await ownerDb.crmPerson.findUniqueOrThrow({ where: { id: intake!.personId } });
    expect(person.primaryEmail).toBe(`ada-${tag}@harbor.org`);
    // And the answer queues a refresh of their timeline at once.
    expect(await ownerDb.job.count({ where: { organizationId: org, kind: "crm-refresh", dedupeKey: { startsWith: "crm-refresh:m:response:" } } })).toBe(1);
  });
});
