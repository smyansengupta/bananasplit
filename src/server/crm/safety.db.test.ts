// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The CRM's safety fixes (docs/features/crm.md, "Nothing sends unapproved",
 * "Email in", "Merging", "Whose keys pay for what"), against the real roles
 * and policies on the local database:
 *
 * - approval is checked again when mail and texts leave;
 * - a draft is sent once, never after it was withdrawn, and Undo gives it back;
 * - Start approves a plan's first email only for its maker or a manager, and
 *   freezes what it previewed; a running plan is its maker's to edit;
 * - mail coming in acts only for a sender that checked out, and only for them;
 * - the biggest issue reads only what everyone who sees the person can see;
 * - a bulk edit's events carry its batch and the Inbox leaves them be;
 * - the spending cap stops group mail and holds room for calls in flight;
 * - our own sender carries only mail a person pressed Send on;
 * - a merge can be undone; notes-to-task stays on its record.
 *
 * Skipped when the database is not reachable. No mail or text leaves
 * (EMAIL_DELIVERY=sink; texts never reach a provider here).
 */

process.env.EMAIL_DELIVERY = "sink";

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock, getSession: vi.fn() }));
vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));
vi.mock("@/server/org-chart/queries", () => ({ getPublishedOrgChart: vi.fn(async () => null) }));
vi.mock("@/server/jobs/kick", () => ({ scheduleKick: vi.fn() }));
// The organization pays for its mail (as if its own Resend sender were set
// up), so the spending cap applies; the send itself still goes to the sink.
vi.mock("./outreach/mailbox", async (load) => ({
  ...(await load<typeof import("./outreach/mailbox")>()),
  orgPaysForMail: vi.fn(async () => true),
}));

import { pushDealStepAction } from "@/app/app/[orgSlug]/crm/deal-actions";
import { createPlanAction } from "@/app/app/[orgSlug]/crm/outreach/actions";
import { EmailConfigError } from "@/server/email/transport";
import { authDb, disconnectAll } from "@/server/db/clients";
import { withOrgTx, withSystemOrgTx, type OrgContext } from "@/server/db/context";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";

import { logActivity } from "./activity";
import { AiCapError, reserveUnderCap } from "./ai";
import { jobWho } from "./ai-tx";
import { emitCrmEvent, type CrmEventPayload } from "./events";
import { inboxListener } from "./inbox-notify";
import { loadIssueInputs } from "./issue";
import { mergePeople, undoMerge } from "./merge";
import { draftNoteTask, undoNoteTask } from "./note-task";
import { ingestEmail } from "./outreach/inbound";
import { sendFromMailbox } from "./outreach/mailbox";
import { savePlanExtras } from "./outreach/plans";
import { cancelEmail, composeEmail, crmSendJob, deliver, queueEmail, saveDraft } from "./outreach/send";
import { createSequence, crmSequenceJob, enroll, saveSequence, setSequenceStatus } from "./outreach/sequences";
import { createPerson } from "./people";
import { crmTextSendJob } from "./phone/jobs";
import { runSetup } from "./setup";

const tag = randomBytes(4).toString("hex");
const org = `c_crmsafe_${tag}`;

type U = { id: string; email: string; name: string };
let owner: U;
let member: U;
let other: U;
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

function run<P>(payload: P) {
  return {
    id: "j",
    kind: "k",
    organizationId: org,
    payload,
    dedupeKey: "k",
    attempt: 1,
    maxAttempts: 8,
    signal: new AbortController().signal,
    deadline: Date.now() + 60_000,
  };
}

const ALL_WEEK = { days: [1, 2, 3, 4, 5, 6, 7], startHour: 0, endHour: 24 };

/** A plan with one email step, on, made by `maker`. */
async function onePlan(maker: U, name: string, body = "Hi {{first_name}}") {
  const seq = await as(maker, (ctx) => createSequence(ctx, name));
  await as(maker, (ctx) =>
    saveSequence(ctx, seq.id, {
      sendWindow: ALL_WEEK,
      steps: [
        { kind: "EMAIL", delayDays: 0, subject: "Hello {{first_name}}", body },
        { kind: "EMAIL", delayDays: 0, subject: "", body: "Following up, {{first_name}}" },
      ],
    }),
  );
  await as(maker, (ctx) => setSequenceStatus(ctx, seq.id, "ON"));
  return seq;
}

const inbound = (over: Partial<Parameters<typeof ingestEmail>[1]>): Parameters<typeof ingestEmail>[1] => ({
  messageId: `m-${randomBytes(4).toString("hex")}@mail.example`,
  inReplyTo: null,
  references: [],
  from: "someone@example.com",
  to: [],
  cc: [],
  subject: "Re: Hello",
  text: "Thanks!",
  date: new Date(),
  headers: {},
  ...over,
});

beforeAll(async () => {
  try {
    owner = await makeUser("safe-owner", "Olive Owner");
    member = await makeUser("safe-member", "Max Member");
    other = await makeUser("safe-other", "Nia Other");
    await ownerDb.organization.create({
      data: { id: org, name: "CRM Safety", slug: `crm-safe-${tag}`, timezone: "UTC", plan: "SOCIETY" },
    });
    await ownerDb.membership.createMany({
      data: [
        { organizationId: org, userId: owner.id, role: "OWNER" },
        { organizationId: org, userId: member.id, role: "MEMBER" },
        { organizationId: org, userId: other.id, role: "MEMBER" },
      ],
    });
    await ownerDb.orgSettings.upsert({
      where: { organizationId: org },
      create: { organizationId: org, addOns: ["crm"] },
      update: { addOns: ["crm"] },
    });
    await as(owner, (ctx) => runSetup(ctx, ["sponsors"]));
  } catch (error) {
    console.warn("[safety.db.test] skipped:", error instanceof Error ? error.message : error);
    reachable = false;
  }
});

afterAll(async () => {
  if (reachable) {
    await ownerDb.job.deleteMany({ where: { organizationId: org } });
    await ownerDb.organization.deleteMany({ where: { id: org } });
    await ownerDb.user.deleteMany({ where: { id: { in: [owner, member, other].filter(Boolean).map((u) => u.id) } } });
  }
  await disconnectAll();
  await disconnectOwnerDb();
});

describe("approval when it leaves", () => {
  it("turns an automation's email queued before approvals into a draft instead of sending it", async () => {
    if (!reachable) return;
    const theo = await as(member, (ctx) => createPerson(ctx, { name: "Theo Park", primaryEmail: `theo-${tag}@park.example` }));
    // As an automation queued it before every email needed a person: no one approved it.
    const { messageId } = await withSystemOrgTx(org, ({ db }) =>
      queueEmail(db, {
        organizationId: org,
        senderId: member.id,
        createdById: null,
        personId: theo.id,
        subject: "Welcome, Theo",
        body: "Hi Theo, welcome aboard.",
        workflowId: "wf_legacy",
      }),
    );
    expect((await ownerDb.crmEmailMessage.findUniqueOrThrow({ where: { id: messageId } })).approval).toBeNull();
    await crmSendJob(run({ messageId }));
    const m = await ownerDb.crmEmailMessage.findUniqueOrThrow({ where: { id: messageId } });
    expect(m).toMatchObject({ status: "DRAFT", sentAt: null, mailboxUserId: member.id });
    const ask = await ownerDb.crmSuggestion.findFirstOrThrow({
      where: { organizationId: org, kind: "DRAFT_EMAIL", status: "PENDING", targetId: theo.id },
    });
    expect(ask.assigneeId).toBe(member.id);
    expect((ask.payload as { draftId?: string }).draftId).toBe(messageId);
  });

  it("holds an email whose approver left, and a text nobody approved", async () => {
    if (!reachable) return;
    const ida = await as(member, (ctx) => createPerson(ctx, { name: "Ida Wells", primaryEmail: `ida-${tag}@wells.example` }));
    const { messageId } = await withSystemOrgTx(org, ({ db }) =>
      queueEmail(db, {
        organizationId: org,
        senderId: member.id,
        createdById: null,
        personId: ida.id,
        subject: "Hello Ida",
        body: "Hi",
        approval: { kind: "send", by: "u_gone_from_org" },
      }),
    );
    expect(await deliver(org, messageId)).toBe("held");
    expect((await ownerDb.crmEmailMessage.findUniqueOrThrow({ where: { id: messageId } })).status).toBe("DRAFT");

    await ownerDb.crmPerson.update({ where: { id: ida.id }, data: { phone: "+15551234567", consent: { text: { granted: true, how: "form" } } } });
    const text = await ownerDb.crmTextMessage.create({
      data: {
        organizationId: org,
        personId: ida.id,
        userId: member.id,
        direction: "OUTBOUND",
        fromNumber: "+15550000000",
        toNumber: "+15551234567",
        body: "Hi Ida",
        provider: "telnyx",
        status: "queued",
      },
    });
    await crmTextSendJob(run({ textId: text.id }));
    expect((await ownerDb.crmTextMessage.findUniqueOrThrow({ where: { id: text.id } })).status).toBe("held-for-ok");
    expect(
      await ownerDb.notification.count({ where: { organizationId: org, userId: member.id, type: "CRM_REVIEW", title: { startsWith: "Didn't text" } } }),
    ).toBe(1);
  });
});

describe("drafts", () => {
  it("sends a draft once from two places, gives it back on Undo, and refuses it once sent or withdrawn", async () => {
    if (!reachable) return;
    const kim = await as(member, (ctx) => createPerson(ctx, { name: "Kim Lee", primaryEmail: `kim-${tag}@lee.example` }));
    const draft = await withSystemOrgTx(org, ({ db }) =>
      saveDraft(db, { organizationId: org, ownerId: member.id, personId: kim.id, subject: "Checking in", body: "Hi Kim", createdById: null }),
    );
    const ask = await withSystemOrgTx(org, ({ db }) =>
      db.crmSuggestion.create({
        data: { organizationId: org, kind: "DRAFT_EMAIL", source: "AUTOMATION", title: "Email Kim", payload: { draftId: draft.draftId }, targetKind: "person", targetId: kim.id, assigneeId: member.id },
      }),
    );
    const send = () =>
      as(member, (ctx) =>
        composeEmail(ctx, { personId: kim.id, subject: "Checking in", body: "Hi Kim", draftId: draft.draftId, holdSeconds: 12, confirmConflict: true }),
      );
    // Today and Power hour at once: one goes, the other is told.
    const both = await Promise.allSettled([send(), send()]);
    expect(both.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const refused = both.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(String(refused.reason?.message)).toMatch(/already on its way/);
    const first = (both.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<{ messageId: string }>).value;

    // Held on the server's clock: the job won't send it early.
    const queued = await ownerDb.crmEmailMessage.findUniqueOrThrow({ where: { id: first.messageId } });
    expect(queued.scheduledFor!.getTime()).toBeGreaterThan(Date.now() + 8_000);
    expect(await deliver(org, first.messageId)).toBe("later");

    // Undo: the draft is back as it was, its To approve row still waiting.
    await as(member, (ctx) => cancelEmail(ctx, first.messageId));
    expect((await ownerDb.crmEmailMessage.findUniqueOrThrow({ where: { id: draft.draftId } })).status).toBe("DRAFT");
    expect((await ownerDb.crmSuggestion.findUniqueOrThrow({ where: { id: ask.id } })).status).toBe("PENDING");

    // Sent for real: only when it leaves does the draft go and its row close.
    const again = await as(member, (ctx) =>
      composeEmail(ctx, { personId: kim.id, subject: "Checking in", body: "Hi Kim", draftId: draft.draftId, confirmConflict: true }),
    );
    if (!("messageId" in again)) throw new Error("expected a send");
    expect((await ownerDb.crmSuggestion.findUniqueOrThrow({ where: { id: ask.id } })).status).toBe("PENDING");
    expect(await deliver(org, again.messageId)).toBe("sent");
    expect((await ownerDb.crmSuggestion.findUniqueOrThrow({ where: { id: ask.id } })).status).toBe("ACCEPTED");
    await expect(send()).rejects.toThrow(/isn't here any more|already went/);
  });

  it("won't send a draft a reply withdrew", async () => {
    if (!reachable) return;
    const ana = await as(member, (ctx) => createPerson(ctx, { name: "Ana Diaz", primaryEmail: `ana-${tag}@diaz.example` }));
    const seq = await onePlan(member, "Withdrawn plan");
    await as(member, (ctx) => enroll(ctx, seq.id, [ana.id]));
    const e = await ownerDb.crmEnrollment.findFirstOrThrow({ where: { sequenceId: seq.id } });
    await crmSequenceJob(run({ enrollmentId: e.id, step: 0 }));
    const out = await ownerDb.crmEmailMessage.findFirstOrThrow({ where: { enrollmentId: e.id, status: "QUEUED" } });
    await crmSendJob(run({ messageId: out.id }));
    await crmSequenceJob(run({ enrollmentId: e.id, step: 1 }));
    const draft = await ownerDb.crmEmailMessage.findFirstOrThrow({ where: { enrollmentId: e.id, status: "DRAFT" } });
    const sent = await ownerDb.crmEmailMessage.findUniqueOrThrow({ where: { id: out.id } });
    await ingestEmail(
      { kind: "reply", organizationId: org, messageId: out.id },
      inbound({ inReplyTo: sent.messageIdHeader, from: `ana-${tag}@diaz.example`, senderVerified: true }),
    );
    await expect(
      as(member, (ctx) => composeEmail(ctx, { personId: ana.id, subject: "x", body: "x", draftId: draft.id, confirmConflict: true })),
    ).rejects.toThrow(/withdrawn because they replied/);
  });
});

describe("plans", () => {
  it("lets Start approve only its own or its maker's first email, and freezes what it previewed", async () => {
    if (!reachable) return;
    const raj = await as(owner, (ctx) => createPerson(ctx, { name: "Raj Patel", primaryEmail: `raj-${tag}@patel.example`, ownerId: other.id }));
    const seq = await onePlan(owner, "From each owner");

    // A member who neither made it nor manages the CRM, sending as another member: a draft for that member.
    expect((await as(member, (ctx) => enroll(ctx, seq.id, [raj.id], { senderId: other.id, confirmConflicts: true }))).enrolled).toBe(1);
    const e1 = await ownerDb.crmEnrollment.findFirstOrThrow({ where: { sequenceId: seq.id, personId: raj.id } });
    expect(e1.nextStep).toBe(1);
    const d = await ownerDb.crmEmailMessage.findFirstOrThrow({ where: { enrollmentId: e1.id } });
    expect(d).toMatchObject({ status: "DRAFT", mailboxUserId: other.id, subject: "Hello Raj" });
    expect(await ownerDb.crmEmailMessage.count({ where: { enrollmentId: e1.id, status: { in: ["QUEUED", "SENT"] } } })).toBe(0);

    // The maker starting it for another owner: approved, frozen as written.
    const lu = await as(owner, (ctx) => createPerson(ctx, { name: "Lu Chen", primaryEmail: `lu-${tag}@chen.example`, ownerId: other.id }));
    await as(owner, (ctx) => enroll(ctx, seq.id, [lu.id], { senderId: other.id, confirmConflicts: true }));
    const e2 = await ownerDb.crmEnrollment.findFirstOrThrow({ where: { sequenceId: seq.id, personId: lu.id } });
    expect(await ownerDb.crmEmailMessage.findFirstOrThrow({ where: { enrollmentId: e2.id } })).toMatchObject({
      status: "SCHEDULED",
      approval: "start",
      approvedById: owner.id,
      bodyText: "Hi Lu",
    });
    // Edited after Start: what goes is what Start saw.
    await as(owner, (ctx) =>
      saveSequence(ctx, seq.id, { steps: [{ kind: "EMAIL", delayDays: 0, subject: "Changed", body: "Changed words" }] }),
    );
    await crmSequenceJob(run({ enrollmentId: e2.id, step: 0 }));
    const q = await ownerDb.crmEmailMessage.findFirstOrThrow({ where: { enrollmentId: e2.id, status: "QUEUED" } });
    expect(q).toMatchObject({ subject: "Hello Lu", bodyText: "Hi Lu", approval: "start", approvedById: owner.id });
    expect(await ownerDb.crmEmailMessage.count({ where: { enrollmentId: e2.id, status: "SCHEDULED" } })).toBe(0);
    expect(await deliver(org, q.id)).toBe("sent");
  });

  it("doesn't let a member's own plan send as someone else, or a stopped plan be changed under another's OK", async () => {
    if (!reachable) return;
    // A plain member makes a plan and starts it from another member's mailbox: a draft for that member.
    const mine = await onePlan(member, "Member sends as someone else");
    const kim = await as(owner, (ctx) => createPerson(ctx, { name: "Kim Park", primaryEmail: `kim-${tag}@park.example`, ownerId: other.id }));
    await as(member, (ctx) => enroll(ctx, mine.id, [kim.id], { senderId: other.id, confirmConflicts: true }));
    const e = await ownerDb.crmEnrollment.findFirstOrThrow({ where: { sequenceId: mine.id, personId: kim.id } });
    expect(await ownerDb.crmEmailMessage.count({ where: { enrollmentId: e.id, status: { in: ["QUEUED", "SCHEDULED", "SENT"] } } })).toBe(0);
    expect(await ownerDb.crmEmailMessage.count({ where: { enrollmentId: e.id, status: "DRAFT", mailboxUserId: other.id } })).toBe(1);

    // Someone else's plan that has run: switching it off doesn't make it anyone's.
    const theirs = await onePlan(owner, "Owner's plan, switched off");
    const lee = await as(owner, (ctx) => createPerson(ctx, { name: "Lee Ray", primaryEmail: `lee-${tag}@ray.example` }));
    await as(owner, (ctx) => enroll(ctx, theirs.id, [lee.id]));
    await expect(as(member, (ctx) => setSequenceStatus(ctx, theirs.id, "OFF"))).rejects.toThrow(/Only whoever made it/);
    await as(owner, (ctx) => setSequenceStatus(ctx, theirs.id, "OFF"));
    await expect(as(member, (ctx) => saveSequence(ctx, theirs.id, { name: "Mine now" }))).rejects.toThrow(/Only whoever made it/);
    await expect(as(member, (ctx) => setSequenceStatus(ctx, theirs.id, "ON"))).rejects.toThrow(/Only whoever made it/);

    // Only whoever sends it (or a CRM manager) calls off a queued email.
    const sam = await as(owner, (ctx) => createPerson(ctx, { name: "Sam Cole", primaryEmail: `sam-${tag}@cole.example` }));
    const queued = await as(owner, (ctx) => composeEmail(ctx, { personId: sam.id, subject: "Numbers", body: "The figure is 123k.", holdSeconds: 60, confirmConflict: true }));
    const msgId = (queued as { messageId: string }).messageId;
    await expect(as(member, (ctx) => cancelEmail(ctx, msgId))).rejects.toThrow(/Only whoever sends it/);

    // Their address changes while it waits: it doesn't follow the record, it waits for a new OK.
    await ownerDb.crmPersonEmail.updateMany({ where: { organizationId: org, personId: sam.id }, data: { email: `attacker-${tag}@example.com` } });
    await ownerDb.crmPerson.update({ where: { id: sam.id }, data: { primaryEmail: `attacker-${tag}@example.com` } });
    await ownerDb.crmEmailMessage.update({ where: { id: msgId }, data: { scheduledFor: new Date(Date.now() - 1000) } });
    expect(await deliver(org, msgId)).not.toBe("sent");
    const after = await ownerDb.crmEmailMessage.findUniqueOrThrow({ where: { id: msgId } });
    expect(after.status).not.toBe("SENT");
  });

  it("keeps a running plan its maker's to edit", async () => {
    if (!reachable) return;
    const seq = await onePlan(owner, "Owner's running plan");
    await expect(as(member, (ctx) => saveSequence(ctx, seq.id, { name: "Mine now" }))).rejects.toThrow(/Only whoever made it/);
    await expect(as(member, (ctx) => savePlanExtras(ctx, seq.id, { from: "me" }))).rejects.toThrow(/Only whoever made it/);
    const mine = await onePlan(member, "Member's plan");
    await as(member, (ctx) => saveSequence(ctx, mine.id, { name: "Renamed" }));
    // An owner manages the CRM: they may.
    await as(owner, (ctx) => saveSequence(ctx, mine.id, { name: "Renamed by the owner" }));
  });
});

describe("mail coming in", () => {
  it("acts only for a sender that checked out, only for them, and folds replies into one Inbox row", async () => {
    if (!reachable) return;
    const pia = await as(member, (ctx) => createPerson(ctx, { name: "Pia Ruiz", primaryEmail: `pia-${tag}@ruiz.example` }));
    const quinn = await as(member, (ctx) => createPerson(ctx, { name: "Quinn Ray", primaryEmail: `quinn-${tag}@ray.example` }));
    const seq = await onePlan(member, "Inbound plan");
    await as(member, (ctx) => enroll(ctx, seq.id, [pia.id, quinn.id], { confirmConflicts: true }));
    const ePia = await ownerDb.crmEnrollment.findFirstOrThrow({ where: { sequenceId: seq.id, personId: pia.id } });
    const eQuinn = await ownerDb.crmEnrollment.findFirstOrThrow({ where: { sequenceId: seq.id, personId: quinn.id } });
    await crmSequenceJob(run({ enrollmentId: ePia.id, step: 0 }));
    const out = await ownerDb.crmEmailMessage.findFirstOrThrow({ where: { enrollmentId: ePia.id, status: "QUEUED" } });
    await crmSendJob(run({ messageId: out.id }));
    const sent = await ownerDb.crmEmailMessage.findUniqueOrThrow({ where: { id: out.id } });
    const reply = { kind: "reply" as const, organizationId: org, messageId: out.id };
    // Earlier replies in this file were read: a new burst starts its own row.
    await ownerDb.notification.updateMany({ where: { organizationId: org, userId: member.id, type: "CRM_REPLY" }, data: { readAt: new Date() } });

    // A forged From: a member's address, unverified. Never logged as theirs.
    const forged = await ingestEmail(reply, inbound({ from: member.email, inReplyTo: sent.messageIdHeader }));
    expect(forged).toMatchObject({ status: "ignored" });
    expect(await ownerDb.crmEmailMessage.count({ where: { organizationId: org, direction: "OUTBOUND", mailbox: "REPLY" } })).toBe(0);

    // Pia's address, unchecked: nothing stops, nothing is written.
    const unchecked = await ingestEmail(reply, inbound({ from: `pia-${tag}@ruiz.example`, inReplyTo: sent.messageIdHeader }));
    expect(unchecked.status).toBe("ignored");
    expect((await ownerDb.crmEnrollment.findUniqueOrThrow({ where: { id: ePia.id } })).status).toBe("ACTIVE");

    // Pia, checked, with Quinn on Cc: Pia's plan stops; Quinn's doesn't, and nothing lands on Quinn's timeline.
    const real = await ingestEmail(
      reply,
      inbound({ from: `Pia <pia-${tag}@ruiz.example>`, cc: [`quinn-${tag}@ray.example`], inReplyTo: sent.messageIdHeader, senderVerified: true }),
    );
    expect(real).toMatchObject({ status: "logged", people: [pia.id] });
    expect((await ownerDb.crmEnrollment.findUniqueOrThrow({ where: { id: ePia.id } })).status).toBe("REPLIED");
    expect((await ownerDb.crmEnrollment.findUniqueOrThrow({ where: { id: eQuinn.id } })).status).toBe("ACTIVE");
    const msg = await ownerDb.crmEmailMessage.findUniqueOrThrow({ where: { id: real.messageId! } });
    expect(await ownerDb.crmActivityTarget.count({ where: { activityId: msg.activityId!, targetKind: "person", targetId: quinn.id } })).toBe(0);

    // A second reply: one Inbox row for the member, and one issue refresh this hour.
    await ingestEmail(reply, inbound({ from: `pia-${tag}@ruiz.example`, inReplyTo: sent.messageIdHeader, senderVerified: true, text: "One more thing." }));
    const rows = await ownerDb.notification.findMany({ where: { organizationId: org, userId: member.id, type: "CRM_REPLY", readAt: null } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe("2 new replies");
    const issueJobs = await ownerDb.job.findMany({ where: { organizationId: org, kind: "crm-ai", dedupeKey: { startsWith: `crm-ai:issue:${pia.id}` } } });
    expect(issueJobs).toHaveLength(1);
    expect(issueJobs[0]!.dedupeKey).toMatch(/:h[0-9a-z]+$/);
  });
});

describe("biggest issue", () => {
  it("reads only entries everyone who sees the person can see", async () => {
    if (!reachable) return;
    const zoe = await as(member, (ctx) => createPerson(ctx, { name: "Zoe Hart", primaryEmail: `zoe-${tag}@hart.example` }));
    const ids = await withSystemOrgTx(org, async ({ db }) => {
      const note = (by: string, body: string, privateToId: string | null = null) =>
        logActivity(db, { organizationId: org, kind: "NOTE", body, targets: [{ kind: "person", id: zoe.id }], actorId: by, createdById: by, privateToId });
      return {
        mine: await note(member.id, "Export is too slow"),
        theirs: await note(other.id, "Mentioned a lawsuit"),
        secret: await note(member.id, "Private thought", member.id),
      };
    });
    const read = () => withSystemOrgTx(org, async ({ db }) => (await loadIssueInputs(db, org, zoe.id))!.sources.map((s) => s.id));
    // Everyone sees everything but private entries.
    expect((await read()).sort()).toEqual([ids.mine, ids.theirs].sort());
    // Members see only their own: Zoe is Max's, so only what Max can see counts.
    await ownerDb.crmSettings.update({ where: { organizationId: org }, data: { memberAccess: "OWN" } });
    try {
      expect(await read()).toEqual([ids.mine]);
    } finally {
      await ownerDb.crmSettings.update({ where: { organizationId: org }, data: { memberAccess: "ALL" } });
    }
  });
});

describe("events and the Inbox", () => {
  it("queues events only for triggers in use, carries a bulk edit's batch, and the Inbox leaves it to the edit's own line", async () => {
    if (!reachable) return;
    const vic = await as(owner, (ctx) => createPerson(ctx, { name: "Vic Stone", ownerId: owner.id }));
    const count = () => ownerDb.job.count({ where: { organizationId: org, kind: "crm-event" } });
    await ownerDb.crmSettings.update({ where: { organizationId: org }, data: { workflowTriggers: ["record.created"] } });
    const before = await count();
    await withSystemOrgTx(org, ({ db }) =>
      emitCrmEvent(db, org, { type: "record.changed", targetKind: "person", targetId: vic.id, fields: ["title"], userId: owner.id, source: "user" }),
    );
    expect(await count()).toBe(before);

    await ownerDb.crmSettings.update({ where: { organizationId: org }, data: { workflowTriggers: ["field.changed"] } });
    await withSystemOrgTx(org, ({ db }) =>
      emitCrmEvent(db, org, { type: "record.changed", targetKind: "person", targetId: vic.id, fields: ["ownerId"], userId: owner.id, source: "user", batchId: "b_bulk1" }),
    );
    const job = await ownerDb.job.findFirstOrThrow({ where: { organizationId: org, kind: "crm-event" }, orderBy: { createdAt: "desc" } });
    const payload = job.payload as unknown as CrmEventPayload;
    expect(payload.batchId).toBe("b_bulk1");
    const told = () => ownerDb.notification.count({ where: { organizationId: org, type: "CRM_ASSIGNED" } });
    const was = await told();
    await inboxListener(org, payload, { jobKey: job.dedupeKey });
    expect(await told()).toBe(was);
    await ownerDb.crmSettings.update({ where: { organizationId: org }, data: { workflowTriggers: [] } });
  });
});

describe("spending and our sender", () => {
  it("stops group mail at the cap but not one-to-one, and holds room for calls in flight", async () => {
    if (!reachable) return;
    const ben = await as(member, (ctx) => createPerson(ctx, { name: "Ben Ito", primaryEmail: `ben-${tag}@ito.example` }));
    await ownerDb.crmSettings.update({ where: { organizationId: org }, data: { aiMonthlyCapCents: 1 } });
    const spent = await ownerDb.aiUsage.create({
      data: { organizationId: org, feature: "crm.summary", provider: "claude", costMicros: 20_000, paidBy: "ORG_KEY" },
    });
    try {
      const queue = (workflowId: string | null) =>
        withSystemOrgTx(org, ({ db }) =>
          queueEmail(db, {
            organizationId: org,
            senderId: member.id,
            createdById: member.id,
            personId: ben.id,
            subject: "Hi",
            body: "Hi Ben",
            workflowId,
          }),
        );
      const group = await queue("wf_sent_by_a_person");
      expect(await deliver(org, group.messageId)).toBe("failed");
      expect((await ownerDb.crmEmailMessage.findUniqueOrThrow({ where: { id: group.messageId } })).error).toMatch(/spending cap/);
      const single = await queue(null);
      expect(await deliver(org, single.messageId)).toBe("sent");

      // Room for one call left: two at once can't both take it.
      await ownerDb.aiUsage.delete({ where: { id: spent.id } });
      const both = await Promise.allSettled([reserveUnderCap(org, 6_000), reserveUnderCap(org, 6_000)]);
      expect(both.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect((both.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toBeInstanceOf(AiCapError);
      for (const r of both) if (r.status === "fulfilled") await r.value.release();
      const again = await reserveUnderCap(org, 6_000);
      await again.release();
    } finally {
      await ownerDb.crmSettings.update({ where: { organizationId: org }, data: { aiMonthlyCapCents: null } });
      await ownerDb.aiUsage.deleteMany({ where: { organizationId: org } });
    }
  });

  it("carries on our own sender only mail a person pressed Send on, and counts it", async () => {
    if (!reachable) return;
    await expect(
      sendFromMailbox({
        organizationId: org,
        senderUserId: member.id,
        senderName: "Max",
        purpose: "one-to-one",
        pressedSend: false,
        message: { to: `nobody-${tag}@example.com`, subject: "x", text: "x", html: "x" },
        idempotencyKey: `t-${tag}`,
      }),
    ).rejects.toBeInstanceOf(EmailConfigError);
    const cy = await as(member, (ctx) => createPerson(ctx, { name: "Cy Bell", primaryEmail: `cy-${tag}@bell.example` }));
    // Mail nobody pressed Send on, marked untracked: no person approved it, so it waits as a draft.
    const receipt = await withSystemOrgTx(org, ({ db }) =>
      queueEmail(db, { organizationId: org, senderId: member.id, createdById: null, personId: cy.id, subject: "Booked", body: "You're booked", track: false }),
    );
    expect(await deliver(org, receipt.messageId)).toBe("held");
    const pressed = await as(member, (ctx) => composeEmail(ctx, { personId: cy.id, subject: "Hello", body: "Hi Cy", confirmConflict: true }));
    if (!("messageId" in pressed)) throw new Error("expected a send");
    expect(await deliver(org, pressed.messageId)).toBe("sent");
    expect(await ownerDb.aiUsage.count({ where: { organizationId: org, feature: "crm.email.platform", paidBy: "PLATFORM" } })).toBeGreaterThan(0);
  });
});

describe("merge undo and notes", () => {
  it("undoes a merge: both people back with their addresses, timeline, plans and fields", async () => {
    if (!reachable) return;
    const keep = await as(member, (ctx) => createPerson(ctx, { name: "Dee Fox", primaryEmail: `dee-${tag}@fox.example` }));
    const drop = await as(member, (ctx) =>
      createPerson(ctx, { name: "Dee Fox", primaryEmail: `dee.fox-${tag}@work.example`, title: "CTO" }),
    );
    const note = await withSystemOrgTx(org, ({ db }) =>
      logActivity(db, { organizationId: org, kind: "NOTE", body: "Met at the fair", targets: [{ kind: "person", id: drop.id }], actorId: member.id, createdById: member.id }),
    );
    const seq = await onePlan(member, "Merge plan");
    await as(member, (ctx) => enroll(ctx, seq.id, [keep.id, drop.id], { confirmConflicts: true }));
    const dropEnrollment = await ownerDb.crmEnrollment.findFirstOrThrow({ where: { sequenceId: seq.id, personId: drop.id } });

    const merged = await as(member, (ctx) => mergePeople(ctx, keep.id, drop.id));
    // In the same plan twice: the duplicate's enrollment stops.
    expect((await ownerDb.crmEnrollment.findUniqueOrThrow({ where: { id: dropEnrollment.id } })).status).toBe("STOPPED");
    expect((await ownerDb.crmPerson.findUniqueOrThrow({ where: { id: keep.id } })).title).toBe("CTO");

    await as(member, (ctx) => undoMerge(ctx, merged.undoId));
    const back = await ownerDb.crmPerson.findUniqueOrThrow({ where: { id: drop.id } });
    expect(back.deletedAt).toBeNull();
    expect((await ownerDb.crmPerson.findUniqueOrThrow({ where: { id: keep.id } })).title).toBeNull();
    expect((await ownerDb.crmPersonEmail.findMany({ where: { personId: drop.id } })).map((e) => e.email)).toEqual([`dee.fox-${tag}@work.example`]);
    expect(await ownerDb.crmActivityTarget.count({ where: { activityId: note, targetKind: "person", targetId: drop.id } })).toBe(1);
    expect(await ownerDb.crmEnrollment.findUniqueOrThrow({ where: { id: dropEnrollment.id } })).toMatchObject({ personId: drop.id, status: "PAUSED" });
    await expect(as(member, (ctx) => undoMerge(ctx, merged.undoId))).rejects.toThrow(/can't be undone/);
  });

  it("undoes only the task a note made, and a company's tasks come only from its own notes", async () => {
    if (!reachable) return;
    const eve = await as(member, (ctx) => createPerson(ctx, { name: "Eve Moss" }));
    const row = await withSystemOrgTx(org, ({ db }) =>
      logActivity(db, {
        organizationId: org,
        kind: "TASK",
        subject: "Task created",
        targets: [{ kind: "person", id: eve.id }],
        actorId: member.id,
        createdById: member.id,
        sourceKind: "link",
        sourceId: `link-${tag}`,
        meta: { linkedKind: "task", linkedId: "task_made_here" },
      }),
    );
    await expect(as(member, (ctx) => undoNoteTask(ctx, { taskId: "someone_elses_task", activityId: row }))).rejects.toThrow(
      /wasn't made from this note/,
    );

    const acme = await ownerDb.crmCompany.create({ data: { organizationId: org, name: `Acme ${tag}`, createdById: member.id } });
    const outsider = await withSystemOrgTx(org, ({ db }) =>
      logActivity(db, { organizationId: org, kind: "NOTE", body: "Not about Acme", targets: [{ kind: "person", id: eve.id }], actorId: member.id, createdById: member.id }),
    );
    await expect(draftNoteTask(jobWho(org, member.id), { target: { kind: "company", id: acme.id }, noteId: outsider })).rejects.toThrow(
      /isn't here any more/,
    );
  });
});

describe("input checks", () => {
  it("refuses malformed action input in words", async () => {
    if (!reachable) return;
    requireUserMock.mockResolvedValue(member);
    expect(await pushDealStepAction(org, "not an id!", 5)).toMatchObject({ ok: false, error: "That didn't look right. Reload and try again." });
    expect(await createPlanAction(org, "x".repeat(500))).toMatchObject({ ok: false, error: "Keep the name under 120 characters." });
  });
});
