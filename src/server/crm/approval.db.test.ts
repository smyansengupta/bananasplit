// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Nothing sends unapproved, and the CRM reaches the Inbox (docs/features/
 * crm.md, "Nothing sends unapproved" and "The CRM in the Inbox"), against
 * the real roles and policies on the local database:
 *
 * - a plan's first email goes when a person pressed Start; every later
 *   email is a draft in To approve, the plan waits for it, Send carries on,
 *   and a reply withdraws the one still waiting;
 * - anything an automation enrolled drafts even its first email;
 * - CRM settings can't switch sending on its own back on;
 * - someone new for a member is one Inbox row per burst, linked to the card;
 *   whoever added them hears nothing; a new member reaches the managers.
 *
 * Skipped when the database is not reachable.
 */

process.env.EMAIL_DELIVERY = "sink";

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock, getSession: vi.fn() }));
vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));
vi.mock("@/server/org-chart/queries", () => ({ getPublishedOrgChart: vi.fn(async () => null) }));
vi.mock("@/server/jobs/kick", () => ({ scheduleKick: vi.fn() }));

import { readAutonomy } from "@/lib/crm/settings-prefs";
import { authDb, disconnectAll } from "@/server/db/clients";
import { withOrgTx, withSystemOrgTx, type OrgContext } from "@/server/db/context";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";

import { crmEventJob, type CrmEventPayload } from "./events";
import { crmMemberJoined } from "./inbox-notify";
import { ingestEmail } from "./outreach/inbound";
import { composeEmail, crmSendJob } from "./outreach/send";
import {
  approvedByStart,
  createSequence,
  crmSequenceJob,
  enroll,
  saveSequence,
  setSequenceStatus,
} from "./outreach/sequences";
import { createPerson } from "./people";
import { rejectSuggestion } from "./review";
import { saveAutonomy } from "./settings";
import { runSetup } from "./setup";

const tag = randomBytes(4).toString("hex");
const org = `c_crmok_${tag}`;

type U = { id: string; email: string; name: string };
let owner: U;
let member: U;
let reachable = true;

async function makeUser(local: string, name: string): Promise<U> {
  const email = `${local}-${tag}@example.edu`;
  const row = await authDb.user.create({
    data: { email, name, emailVerified: new Date(), onboardedAt: new Date() },
    select: { id: true, email: true, name: true },
  });
  return { id: row.id, email: row.email, name: row.name ?? name };
}

function as<T>(user: U, fn: (ctx: OrgContext) => Promise<T>): Promise<T> {
  requireUserMock.mockResolvedValue(user);
  return withOrgTx(org, fn);
}

function run<P>(payload: P, dedupeKey = "k") {
  return {
    id: "j",
    kind: "k",
    organizationId: org,
    payload,
    dedupeKey,
    attempt: 1,
    maxAttempts: 8,
    signal: new AbortController().signal,
    deadline: Date.now() + 60_000,
  };
}

/** Runs the pending crm-event jobs whole (workflows and listeners), as the job runner would. */
async function drainEvents(): Promise<void> {
  for (let round = 0; round < 5; round++) {
    const jobs = await ownerDb.job.findMany({
      where: { organizationId: org, kind: "crm-event", status: "PENDING" },
      orderBy: { runAt: "asc" },
    });
    if (jobs.length === 0) return;
    for (const j of jobs) {
      await ownerDb.job.update({ where: { id: j.id }, data: { status: "DONE" } });
      await crmEventJob(run(j.payload as unknown as CrmEventPayload, j.dedupeKey));
    }
  }
}

/** Every email that left, or is about to, for one person. */
const goingOut = (personId: string) =>
  ownerDb.crmEmailMessage.count({ where: { organizationId: org, personId, status: { in: ["QUEUED", "SENT"] } } });

beforeAll(async () => {
  try {
    owner = await makeUser("ok-owner", "Olive Owner");
    member = await makeUser("ok-member", "Max Member");
    await ownerDb.organization.create({
      data: { id: org, name: "CRM Approvals", slug: `crm-ok-${tag}`, timezone: "America/New_York", plan: "SOCIETY" },
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
    await as(owner, (ctx) => runSetup(ctx, ["sponsors"]));
  } catch (error) {
    console.warn("[approval.db.test] skipped:", error instanceof Error ? error.message : error);
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

describe("nothing sends unapproved", () => {
  it("only the first step goes on Start, and only when a person enrolled them", () => {
    expect(approvedByStart({ enrolledById: "u1" }, 0)).toBe(true);
    expect(approvedByStart({ enrolledById: "u1" }, 1)).toBe(false);
    expect(approvedByStart({ enrolledById: "u1" }, 4)).toBe(false);
    expect(approvedByStart({ enrolledById: null }, 0)).toBe(false);
  });

  it("drafts a plan's later emails for the sender, waits for them, and drops them on a reply", async () => {
    if (!reachable) return;
    const grace = await as(member, (ctx) =>
      createPerson(ctx, { name: "Grace Hopper", primaryEmail: `grace-${tag}@navy.example` }),
    );
    const seq = await as(member, (ctx) => createSequence(ctx, "Three touches"));
    await as(member, (ctx) =>
      saveSequence(ctx, seq.id, {
        sendWindow: { days: [1, 2, 3, 4, 5, 6, 7], startHour: 0, endHour: 24 },
        steps: [
          { kind: "EMAIL", delayDays: 0, subject: "Hello {{first_name}}", body: "Hi {{first_name}}" },
          { kind: "EMAIL", delayDays: 0, subject: "", body: "Just checking in, {{first_name}}" },
          { kind: "EMAIL", delayDays: 0, subject: "", body: "Last note, {{first_name}}" },
        ],
      }),
    );
    await as(member, (ctx) => setSequenceStatus(ctx, seq.id, "ON"));
    expect((await as(member, (ctx) => enroll(ctx, seq.id, [grace.id]))).enrolled).toBe(1);
    const e = await ownerDb.crmEnrollment.findFirstOrThrow({ where: { sequenceId: seq.id } });

    // Step one: the member pressed Start, so it goes.
    await crmSequenceJob(run({ enrollmentId: e.id, step: 0 }));
    const first = await ownerDb.crmEmailMessage.findFirstOrThrow({ where: { enrollmentId: e.id, status: "QUEUED" } });
    await crmSendJob(run({ messageId: first.id }));
    expect(await goingOut(grace.id)).toBe(1);

    // Step two: a draft in the member's To approve and Inbox; nothing goes.
    await crmSequenceJob(run({ enrollmentId: e.id, step: 1 }));
    expect(await goingOut(grace.id)).toBe(1);
    const draft = await ownerDb.crmEmailMessage.findFirstOrThrow({ where: { enrollmentId: e.id, status: "DRAFT" } });
    expect(draft).toMatchObject({ mailboxUserId: member.id, bodyText: "Just checking in, Grace", subject: "Re: Hello Grace" });
    const ask = await ownerDb.crmSuggestion.findFirstOrThrow({
      where: { organizationId: org, kind: "DRAFT_EMAIL", status: "PENDING", targetId: grace.id },
    });
    expect(ask.assigneeId).toBe(member.id);
    expect((ask.payload as { draftId?: string }).draftId).toBe(draft.id);
    const told = await ownerDb.notification.findFirstOrThrow({
      where: { organizationId: org, userId: member.id, type: "CRM_REVIEW" },
    });
    expect(told.linkUrl).toContain("show=approve");

    // Step three can't run past a waiting draft: it waits too.
    await crmSequenceJob(run({ enrollmentId: e.id, step: 2 }));
    expect(await ownerDb.crmEmailMessage.count({ where: { enrollmentId: e.id, status: "DRAFT" } })).toBe(1);
    expect(await goingOut(grace.id)).toBe(1);

    // The member presses Send: it goes in the plan's thread, and the plan carries on.
    const sent = await as(member, (ctx) =>
      composeEmail(ctx, { personId: grace.id, subject: draft.subject!, body: draft.bodyText!, draftId: draft.id, confirmConflict: true }),
    );
    if (!("messageId" in sent)) throw new Error("expected a send");
    const second = await ownerDb.crmEmailMessage.findUniqueOrThrow({ where: { id: sent.messageId } });
    expect(second).toMatchObject({ enrollmentId: e.id, threadId: first.threadId, createdById: member.id, status: "QUEUED" });
    expect((await ownerDb.crmSuggestion.findUniqueOrThrow({ where: { id: ask.id } })).status).toBe("ACCEPTED");
    await crmSendJob(run({ messageId: second.id }));
    await crmSequenceJob(run({ enrollmentId: e.id, step: 2 }));
    expect(await goingOut(grace.id)).toBe(2);
    const third = await ownerDb.crmEmailMessage.findFirstOrThrow({ where: { enrollmentId: e.id, status: "DRAFT" } });
    expect(third.bodyText).toBe("Last note, Grace");

    // She replies: the plan stops and the draft still waiting is withdrawn.
    const out = await ownerDb.crmEmailMessage.findUniqueOrThrow({ where: { id: first.id } });
    await ingestEmail(
      { kind: "reply", organizationId: org, messageId: out.id },
      {
        messageId: `reply-${tag}@navy.example`,
        inReplyTo: out.messageIdHeader,
        references: [],
        from: `grace-${tag}@navy.example`,
        to: [],
        cc: [],
        subject: "Re: Hello Grace",
        text: "Thanks, let's talk.",
        date: new Date(),
        headers: {},
      },
    );
    expect((await ownerDb.crmEmailMessage.findUniqueOrThrow({ where: { id: third.id } })).status).toBe("FAILED");
    expect(
      await ownerDb.crmSuggestion.count({ where: { organizationId: org, kind: "DRAFT_EMAIL", status: "PENDING", targetId: grace.id } }),
    ).toBe(0);
    expect((await ownerDb.crmEnrollment.findUniqueOrThrow({ where: { id: e.id } })).status).toBe("REPLIED");
    expect(await goingOut(grace.id)).toBe(2);
  });

  it("drafts even the first email of anything an automation enrolled, and Don't send moves the plan on", async () => {
    if (!reachable) return;
    const lin = await as(member, (ctx) => createPerson(ctx, { name: "Lin Park", primaryEmail: `lin-${tag}@park.example` }));
    const seq = await as(member, (ctx) => createSequence(ctx, "Automated welcome"));
    await as(member, (ctx) =>
      saveSequence(ctx, seq.id, {
        sendWindow: { days: [1, 2, 3, 4, 5, 6, 7], startHour: 0, endHour: 24 },
        steps: [{ kind: "EMAIL", delayDays: 0, subject: "Welcome {{first_name}}", body: "Hi {{first_name}}" }],
      }),
    );
    await as(member, (ctx) => setSequenceStatus(ctx, seq.id, "ON"));
    await as(member, (ctx) => enroll(ctx, seq.id, [lin.id], { byAutomation: true }));
    const e = await ownerDb.crmEnrollment.findFirstOrThrow({ where: { sequenceId: seq.id } });
    expect(e.enrolledById).toBeNull();
    await crmSequenceJob(run({ enrollmentId: e.id, step: 0 }));
    expect(await goingOut(lin.id)).toBe(0);
    const ask = await ownerDb.crmSuggestion.findFirstOrThrow({
      where: { organizationId: org, kind: "DRAFT_EMAIL", status: "PENDING", targetId: lin.id },
    });
    // The last step's draft keeps the enrollment open until it's dealt with.
    expect((await ownerDb.crmEnrollment.findUniqueOrThrow({ where: { id: e.id } })).status).toBe("ACTIVE");
    await as(member, (ctx) => rejectSuggestion(ctx, ask.id));
    expect(await ownerDb.crmEmailMessage.count({ where: { enrollmentId: e.id, status: "DRAFT" } })).toBe(0);
    await crmSequenceJob(run({ enrollmentId: e.id, step: 1 }));
    expect((await ownerDb.crmEnrollment.findUniqueOrThrow({ where: { id: e.id } })).status).toBe("FINISHED");
    expect(await goingOut(lin.id)).toBe(0);
  });

  it("won't let CRM settings switch sending on its own back on", async () => {
    if (!reachable) return;
    const saved = await as(owner, (ctx) => saveAutonomy(ctx, { emails: "auto", merges: "auto" }));
    expect(saved.emails).toBe("suggest");
    expect(saved.merges).toBe("auto");
    expect(readAutonomy({ emails: "tell" }).emails).toBe("suggest");
  });
});

describe("the CRM in the Inbox", () => {
  it("tells the owner about people added for them, one row per burst, and not whoever added them", async () => {
    if (!reachable) return;
    const before = await ownerDb.notification.count({ where: { organizationId: org, userId: member.id, type: "CRM_NEW" } });
    expect(before).toBe(0);
    const ids: string[] = [];
    for (const name of ["Ada Lovelace", "Alan Turing", "Katherine Johnson"]) {
      ids.push((await as(owner, (ctx) => createPerson(ctx, { name, ownerId: member.id }))).id);
    }
    await drainEvents();
    const rows = await ownerDb.notification.findMany({ where: { organizationId: org, userId: member.id, type: "CRM_NEW" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe("3 new people in the CRM");
    expect(rows[0]!.body).toContain("Katherine Johnson");
    expect(await ownerDb.notification.count({ where: { organizationId: org, userId: owner.id, type: "CRM_NEW" } })).toBe(0);

    // Read, the next one starts its own row, linked to the person's card.
    await ownerDb.notification.updateMany({ where: { id: rows[0]!.id }, data: { readAt: new Date() } });
    const dot = await as(owner, (ctx) => createPerson(ctx, { name: "Dorothy Vaughan", ownerId: member.id }));
    await drainEvents();
    const next = await ownerDb.notification.findFirstOrThrow({
      where: { organizationId: org, userId: member.id, type: "CRM_NEW", readAt: null },
    });
    expect(next.title).toBe("New person: Dorothy Vaughan");
    expect(next.body).toContain("Added for you by Olive Owner");
    expect(next.linkUrl).toBe(`/app/crm-ok-${tag}/crm/people?open=person%3A${dot.id}`);

    // A member adding someone for themselves queues nothing at all.
    const jobs = await ownerDb.job.count({ where: { organizationId: org, kind: "crm-event" } });
    await as(member, (ctx) => createPerson(ctx, { name: "Mary Jackson" }));
    expect(await ownerDb.job.count({ where: { organizationId: org, kind: "crm-event" } })).toBe(jobs);
  });

  it("tells the managers about a new member", async () => {
    if (!reachable) return;
    await withSystemOrgTx(org, ({ db }) => crmMemberJoined(db, org, member.id));
    const row = await ownerDb.notification.findFirstOrThrow({ where: { organizationId: org, userId: owner.id, type: "CRM_NEW" } });
    expect(row.title).toBe("New member: Max Member");
    expect(await ownerDb.notification.count({ where: { organizationId: org, userId: member.id, title: { startsWith: "New member" } } })).toBe(0);
  });
});
