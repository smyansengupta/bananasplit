// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The review queue against the real roles and policies on the local
 * database: suggestions proposed by AI and connected apps, accepted through
 * the CRM's core with field history source "ai" or "connector", undone (the
 * record goes back, the suggestion waits again), rejected, accepted in a
 * batch with one refused, and hidden from a member who can't see the record
 * (OWN access). Also the CRM's AI through the local stand-in: a summary kept
 * on the record, a transcript's promises as task suggestions, AiUsage rows,
 * and the hard monthly cap. Skipped when the database is not reachable.
 */

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock, getSession: vi.fn() }));
vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));
vi.mock("@/server/org-chart/queries", () => ({ getPublishedOrgChart: vi.fn(async () => null) }));

import { authDb, disconnectAll } from "@/server/db/clients";
import { withOrgTx, type OrgContext } from "@/server/db/context";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";

import { CrmError } from "./access";
import { AiCapError } from "./ai";
import { jobWho } from "./ai-tx";
import { readTranscript, summarizeRecord } from "./assist";
import { readEnrichment } from "./enrichment-store";
import { createPerson } from "./people";
import { acceptSuggestion, acceptSuggestions, listQueue, proposeChange, queueCount, rejectSuggestion, undoSuggestion } from "./review";
import { runSetup } from "./setup";

const tag = randomBytes(4).toString("hex");
const orgA = `c_crmai_a_${tag}`;

type U = { id: string; email: string; name: string };
let owner: U;
let member: U;
let reachable = true;
let standin = true;

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
  standin = process.env.AI_STANDIN === "1" && !process.env.VERCEL;
  try {
    owner = await makeUser("crmai-owner");
    member = await makeUser("crmai-member");
    await ownerDb.organization.create({
      data: { id: orgA, name: "CRM AI Test", slug: `crm-ai-test-${tag}`, timezone: "UTC", plan: "SOCIETY" },
    });
    await ownerDb.membership.createMany({
      data: [
        { organizationId: orgA, userId: owner.id, role: "OWNER" },
        { organizationId: orgA, userId: member.id, role: "MEMBER" },
      ],
    });
    await ownerDb.orgSettings.upsert({
      where: { organizationId: orgA },
      create: { organizationId: orgA, addOns: ["crm"] },
      update: { addOns: ["crm"] },
    });
    await as(owner, orgA, (ctx) => runSetup(ctx, ["sponsors"]));
  } catch (error) {
    console.warn("[review.db.test] skipped:", error instanceof Error ? error.message : error);
    reachable = false;
  }
});

afterAll(async () => {
  if (reachable) {
    await ownerDb.organization.deleteMany({ where: { id: orgA } });
    await ownerDb.user.deleteMany({ where: { id: { in: [owner, member].filter(Boolean).map((u) => u.id) } } });
  }
  await disconnectAll();
  await disconnectOwnerDb();
});

describe("the review queue", () => {
  it("accepts a field change through the core with source ai, and undoes it", async () => {
    if (!reachable) return;
    const { id: personId } = await as(owner, orgA, (ctx) => createPerson(ctx, { name: "Mara Quinn", title: "Barista" }));
    const { id } = await as(owner, orgA, (ctx) =>
      proposeChange(ctx.db, {
        organizationId: orgA,
        kind: "UPDATE_FIELD",
        source: "AI",
        title: "Update Mara's title",
        payload: { changes: [{ field: "title", label: "Title", after: "Head of partnerships" }] },
        target: { kind: "person", id: personId },
        citation: { kind: "meeting", label: "Sponsorship call on Nov 2" },
        proposedById: owner.id,
        assigneeId: owner.id,
      }),
    );
    // The before was read from the record.
    const queued = await as(owner, orgA, (ctx) => listQueue(ctx.db, orgA, owner.id));
    const item = queued.find((q) => q.id === id)!;
    expect(item.rows).toEqual([{ label: "Title", before: "Barista", after: "Head of partnerships" }]);
    expect(item.citation?.label).toBe("Sponsorship call on Nov 2");
    // The same suggestion again is the same row.
    const again = await as(owner, orgA, (ctx) =>
      proposeChange(ctx.db, {
        organizationId: orgA,
        kind: "UPDATE_FIELD",
        source: "AI",
        title: "Update Mara's title",
        payload: { changes: [{ field: "title", label: "Title", after: "Head of partnerships" }] },
        target: { kind: "person", id: personId },
      }),
    );
    expect(again).toEqual({ id, duplicate: true });

    await as(owner, orgA, (ctx) => acceptSuggestion(ctx, id));
    const after = await ownerDb.crmPerson.findUniqueOrThrow({ where: { id: personId } });
    expect(after.title).toBe("Head of partnerships");
    const history = await ownerDb.crmFieldHistory.findMany({ where: { targetId: personId, field: "title" } });
    expect(history.map((h) => h.source)).toContain("ai");
    const enrichment = after.enrichment as Record<string, { label?: string }>;
    expect(enrichment.title?.label).toBe("Sponsorship call on Nov 2");
    await expect(as(owner, orgA, (ctx) => acceptSuggestion(ctx, id))).rejects.toThrow(CrmError);
    // Only whoever accepted it undoes it.
    await expect(as(member, orgA, (ctx) => undoSuggestion(ctx, id))).rejects.toThrow(/Only the person who accepted it/);

    await as(owner, orgA, (ctx) => undoSuggestion(ctx, id));
    const back = await ownerDb.crmPerson.findUniqueOrThrow({ where: { id: personId } });
    expect(back.title).toBe("Barista");
    const row = await ownerDb.crmSuggestion.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("PENDING");
    expect((row.payload as Record<string, unknown>).applied).toBeUndefined();
  });

  it("makes a person from a connected app's suggestion, with their note, and trashes them on undo", async () => {
    if (!reachable) return;
    const { id } = await as(member, orgA, (ctx) =>
      proposeChange(ctx.db, {
        organizationId: orgA,
        kind: "CREATE_PERSON",
        source: "CONNECTOR",
        title: "Add Theo Park",
        payload: {
          person: { name: "Theo Park", primaryEmail: "Theo@Example.org", title: "Director" },
          activity: { kind: "NOTE", subject: "How we know them", body: "Met at the fair." },
        },
        citation: { kind: "connector", label: "Claude: asked to add this person" },
        proposedById: member.id,
        assigneeId: member.id,
      }),
    );
    // The assignee is told (an Inbox notification), not the one who proposed it.
    expect(await ownerDb.notification.count({ where: { organizationId: orgA, type: "CRM_REVIEW" } })).toBe(0);
    const { applied } = await as(member, orgA, (ctx) => acceptSuggestion(ctx, id));
    const theo = await ownerDb.crmPerson.findUniqueOrThrow({ where: { id: applied.createdId! } });
    expect(theo.primaryEmail).toBe("theo@example.org");
    expect(theo.source).toBe("connected app");
    const history = await ownerDb.crmFieldHistory.findFirst({ where: { targetId: theo.id, field: "created" } });
    expect(history?.source).toBe("connector");
    const note = await ownerDb.crmActivity.findUniqueOrThrow({ where: { id: applied.activityId! } });
    expect(note.body).toBe("Met at the fair.");
    await as(member, orgA, (ctx) => undoSuggestion(ctx, id));
    expect((await ownerDb.crmPerson.findUniqueOrThrow({ where: { id: theo.id } })).deletedAt).not.toBeNull();
    expect((await ownerDb.crmActivity.findUniqueOrThrow({ where: { id: applied.activityId! } })).deletedAt).not.toBeNull();
  });

  it("notifies an assignee, rejects, and accepts a batch with one refused", async () => {
    if (!reachable) return;
    const { id: personId } = await as(owner, orgA, (ctx) => createPerson(ctx, { name: "Ines Ruiz" }));
    const log = await as(owner, orgA, (ctx) =>
      proposeChange(ctx.db, {
        organizationId: orgA,
        kind: "LOG_ACTIVITY",
        source: "AI",
        title: "Log the call with Ines",
        payload: { kind: "CALL", subject: "Call", body: "Talked budget.", targets: [{ kind: "person", id: personId }] },
        target: { kind: "person", id: personId },
        proposedById: owner.id,
        assigneeId: member.id,
      }),
    );
    expect(await ownerDb.notification.count({ where: { organizationId: orgA, userId: member.id, type: "CRM_REVIEW" } })).toBe(1);
    expect(await as(member, orgA, (ctx) => queueCount(ctx.db, orgA, member.id))).toBeGreaterThan(0);
    const bad = await as(owner, orgA, (ctx) =>
      proposeChange(ctx.db, {
        organizationId: orgA,
        kind: "UPDATE_FIELD",
        source: "AI",
        title: "A change the core refuses",
        payload: { changes: [{ field: "strength", label: "Strength", after: 99 }] },
        target: { kind: "person", id: personId },
      }),
    );
    const rejectMe = await as(owner, orgA, (ctx) =>
      proposeChange(ctx.db, {
        organizationId: orgA,
        kind: "UPDATE_FIELD",
        source: "AI",
        title: "Rename",
        payload: { changes: [{ field: "location", label: "Location", after: "Lisbon" }] },
        target: { kind: "person", id: personId },
      }),
    );
    await as(owner, orgA, (ctx) => rejectSuggestion(ctx, rejectMe.id));
    expect((await ownerDb.crmSuggestion.findUniqueOrThrow({ where: { id: rejectMe.id } })).status).toBe("REJECTED");

    const r = await as(member, orgA, (ctx) => acceptSuggestions(ctx, [log.id, bad.id]));
    expect(r.accepted).toEqual([log.id]);
    expect(r.failed.map((f) => f.id)).toEqual([bad.id]);
    const ines = await ownerDb.crmPerson.findUniqueOrThrow({ where: { id: personId } });
    // A call moves "last contacted".
    expect(ines.lastContactedAt).not.toBeNull();
    expect((await ownerDb.crmSuggestion.findUniqueOrThrow({ where: { id: bad.id } })).status).toBe("PENDING");
  });

  it("hides a suggestion about a record the member can't see", async () => {
    if (!reachable) return;
    await ownerDb.crmSettings.update({ where: { organizationId: orgA }, data: { memberAccess: "OWN" } });
    try {
      const { id: personId } = await as(owner, orgA, (ctx) => createPerson(ctx, { name: "Private Donor" }));
      const { id } = await as(owner, orgA, (ctx) =>
        proposeChange(ctx.db, {
          organizationId: orgA,
          kind: "UPDATE_FIELD",
          source: "AI",
          title: "Something about the donor",
          payload: { changes: [{ field: "title", label: "Title", after: "Trustee" }] },
          target: { kind: "person", id: personId },
        }),
      );
      const seen = await as(member, orgA, (ctx) => listQueue(ctx.db, orgA, member.id));
      expect(seen.some((s) => s.id === id)).toBe(false);
      await expect(as(member, orgA, (ctx) => acceptSuggestion(ctx, id))).rejects.toThrow();
      const owners = await as(owner, orgA, (ctx) => listQueue(ctx.db, orgA, owner.id));
      expect(owners.some((s) => s.id === id)).toBe(true);
    } finally {
      await ownerDb.crmSettings.update({ where: { organizationId: orgA }, data: { memberAccess: "ALL" } });
    }
  });
});

describe("the CRM's AI on the local stand-in", () => {
  it("keeps a summary on the record, metered in AiUsage", async () => {
    if (!reachable || !standin) return;
    const { id } = await as(owner, orgA, (ctx) => createPerson(ctx, { name: "Sam Lee", title: "Treasurer" }));
    const summary = await summarizeRecord(jobWho(orgA, owner.id), { kind: "person", id });
    expect(summary.text).toContain("Sam Lee");
    const stored = await as(owner, orgA, (ctx) => readEnrichment(ctx.db, orgA, { kind: "person", id }));
    expect(stored._summary?.text).toBe(summary.text);
    const usage = await ownerDb.aiUsage.findMany({ where: { organizationId: orgA, feature: "crm.summary" } });
    expect(usage.length).toBeGreaterThan(0);
    expect(usage[0]!.provider).toBe("standin");
  });

  it("turns a transcript's promises into task suggestions: ours dated, theirs as follow-ups", async () => {
    if (!reachable || !standin) return;
    const { id } = await as(owner, orgA, (ctx) => createPerson(ctx, { name: "Ruth Ade" }));
    const r = await readTranscript(jobWho(orgA, owner.id), {
      target: { kind: "person", id },
      text: "We talked about the spring sponsorship.\nMe: I'll send the deck Friday.\nRuth: They'll confirm the budget in March.",
      source: "pasted",
      meetingDay: "2026-11-02",
    });
    expect(r.queued).toBeGreaterThanOrEqual(3);
    const tasks = await ownerDb.crmSuggestion.findMany({ where: { organizationId: orgA, kind: "CREATE_TASK", targetId: id } });
    const ours = tasks.find((t) => (t.payload as { promiseBy?: string }).promiseBy === "us")!;
    const theirs = tasks.find((t) => (t.payload as { promiseBy?: string }).promiseBy === "them")!;
    expect((ours.payload as { dueDate: string }).dueDate).toBe("2026-11-06");
    expect((theirs.payload as { followUp: boolean }).followUp).toBe(true);
    // Accepting the follow-up makes the task and moves the next follow-up.
    await as(owner, orgA, (ctx) => acceptSuggestion(ctx, theirs.id));
    const person = await ownerDb.crmPerson.findUniqueOrThrow({ where: { id } });
    expect(person.nextFollowUpAt?.toISOString().slice(0, 10)).toBe((theirs.payload as { dueDate: string }).dueDate);
    const link = await ownerDb.itemLink.findFirst({ where: { organizationId: orgA, toKind: "crm-person", toId: id, fromKind: "task" } });
    expect(link).not.toBeNull();
  });

  it("stops at the monthly cap", async () => {
    if (!reachable || !standin) return;
    await ownerDb.aiUsage.create({
      data: { organizationId: orgA, userId: owner.id, feature: "crm.draft", provider: "claude", model: "claude-sonnet-5", costMicros: 2_000_000, paidBy: "ORG_KEY" },
    });
    await ownerDb.crmSettings.update({ where: { organizationId: orgA }, data: { aiMonthlyCapCents: 100 } });
    try {
      const { id } = await as(owner, orgA, (ctx) => createPerson(ctx, { name: "Capped Person" }));
      await expect(summarizeRecord(jobWho(orgA, owner.id), { kind: "person", id })).rejects.toThrow(AiCapError);
    } finally {
      await ownerDb.crmSettings.update({ where: { organizationId: orgA }, data: { aiMonthlyCapCents: null } });
    }
  });
});
