// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The CRM's phases wired together, against the real roles and policies on
 * the local database (docs/features/crm.md, "Integration as built"):
 *
 * - a workflow's "send a template" goes through outreach's send path (merge
 *   fields rendered, the automation's mail counted, sent to the sink), and
 *   set to review leaves an unsent draft and a Review suggestion that
 *   sending from compose closes;
 * - an AI draft lands in compose (the member's own) or in Review (an
 *   agent's), never sent;
 * - sequence to-dos become Tasks, a text that can't go waits in the queue,
 *   a call step is on the dialer and logging the call closes it;
 * - someone new in a reply waits in Review as a new person; signals don't;
 * - the sidebar's Inbox count takes the CRM's rows;
 * - forecasts read a close on its day in the organization's timezone.
 *
 * Skipped when the database is not reachable.
 */

process.env.EMAIL_DELIVERY = "sink";

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock, getSession: vi.fn() }));
vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));
vi.mock("@/server/org-chart/queries", () => ({ getPublishedOrgChart: vi.fn(async () => null) }));
vi.mock("@/server/jobs/kick", () => ({ scheduleKick: vi.fn() }));

import { authDb, disconnectAll } from "@/server/db/clients";
import { withOrgTx, withSystemOrgTx, type OrgContext } from "@/server/db/context";
import { sidebarCounts } from "@/server/inbox/counts";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";

import { deliverDraft } from "./drafts";
import type { CrmEventPayload } from "./events";
import { forecastItems } from "./forecast";
import { ingestEmail } from "./outreach/inbound";
import { composeEmail, deliver } from "./outreach/send";
import { createSequence, crmSequenceJob, enroll, saveSequence, setSequenceStatus } from "./outreach/sequences";
import { createTemplate } from "./outreach/templates";
import { createPerson } from "./people";
import { logCall } from "./phone/calls";
import { addTextSender } from "./phone/texts";
import { openCallSteps } from "./phone/queue";
import { listQueue } from "./review";
import { runSetup } from "./setup";
import { handleCrmEvent } from "./workflow-engine";
import { saveWorkflow, setWorkflowStatus } from "./workflows";

const tag = randomBytes(4).toString("hex");
const org = `c_crmint_${tag}`;

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

/** Runs the pending crm-event jobs, as the job runner would. */
async function drainEvents(): Promise<void> {
  for (let round = 0; round < 5; round++) {
    const jobs = await ownerDb.job.findMany({ where: { organizationId: org, kind: "crm-event", status: "PENDING" }, orderBy: { runAt: "asc" } });
    if (jobs.length === 0) return;
    for (const j of jobs) {
      await ownerDb.job.update({ where: { id: j.id }, data: { status: "DONE" } });
      await handleCrmEvent(org, j.payload as unknown as CrmEventPayload, { jobKey: j.dedupeKey });
    }
  }
}

beforeAll(async () => {
  try {
    owner = await makeUser("int-owner", "Olive Owner");
    member = await makeUser("int-member", "Max Member");
    await ownerDb.organization.create({
      data: { id: org, name: "CRM Integration", slug: `crm-int-${tag}`, timezone: "America/New_York", plan: "SOCIETY" },
    });
    await ownerDb.membership.createMany({
      data: [
        { organizationId: org, userId: owner.id, role: "OWNER" },
        { organizationId: org, userId: member.id, role: "MEMBER" },
      ],
    });
    await ownerDb.orgSettings.upsert({
      where: { organizationId: org },
      create: { organizationId: org, addOns: ["crm", "finance"] },
      update: { addOns: ["crm", "finance"] },
    });
    await as(owner, (ctx) => runSetup(ctx, ["sponsors"]));
  } catch (error) {
    console.warn("[integration.db.test] skipped:", error instanceof Error ? error.message : error);
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

describe("the CRM's phases together", () => {
  it("sends a workflow's template through outreach, and drafts it for review when set to", async () => {
    if (!reachable) return;
    const welcome = await as(owner, (ctx) =>
      createTemplate(ctx, { name: "Welcome", category: "welcome", subject: "Welcome, {{first_name|friend}}", body: "Hi {{first_name|there}},\n\n{{my_first_name}}" }),
    );
    const wf = await as(owner, (ctx) =>
      saveWorkflow(ctx, {
        workflow: {
          name: "Welcome new people",
          trigger: { type: "record.created", params: { object: "person" } },
          conditions: [],
          actions: [{ type: "template.send", params: { templateId: welcome.id } }],
        },
        status: "ON",
      }),
    );
    // Members can't read workflows any more, but their changes still set them off.
    expect((await ownerDb.crmSettings.findUniqueOrThrow({ where: { organizationId: org } })).workflowTriggers).toEqual(["record.created"]);
    expect(await as(member, (ctx) => ctx.db.crmWorkflow.count({ where: { organizationId: org } }))).toBe(0);

    const ada = await as(member, (ctx) => createPerson(ctx, { name: "Ada Lovelace", primaryEmail: `ada-${tag}@harbor.org` }));
    await drainEvents();
    const queued = await ownerDb.crmEmailMessage.findFirstOrThrow({ where: { organizationId: org, workflowId: wf.id } });
    // From the record's owner (the member who added her), merged by outreach's renderer.
    expect(queued).toMatchObject({ status: "QUEUED", personId: ada.id, mailboxUserId: member.id, subject: "Welcome, Ada", bodyText: "Hi Ada,\n\nMax" });
    expect(await deliver(org, queued.id, undefined, queued.scheduledFor ?? new Date())).toBe("sent");
    expect((await ownerDb.crmEmailMessage.findUniqueOrThrow({ where: { id: queued.id } })).status).toBe("SENT");

    // Set to "owner reviews first": an unsent draft and a Review suggestion; sending it from compose closes both.
    await as(owner, (ctx) => setWorkflowStatus(ctx, wf.id, "OFF"));
    const review = await as(owner, (ctx) =>
      saveWorkflow(ctx, {
        workflow: {
          name: "Welcome, reviewed",
          trigger: { type: "record.created", params: { object: "person" } },
          conditions: [],
          actions: [{ type: "template.send", params: { templateId: welcome.id, review: true } }],
        },
        status: "ON",
      }),
    );
    const grace = await as(owner, (ctx) => createPerson(ctx, { name: "Grace Hopper", primaryEmail: `grace-${tag}@navy.example` }));
    await drainEvents();
    const draft = await ownerDb.crmEmailMessage.findFirstOrThrow({ where: { organizationId: org, status: "DRAFT", personId: grace.id } });
    const suggestion = await ownerDb.crmSuggestion.findFirstOrThrow({ where: { organizationId: org, kind: "DRAFT_EMAIL", targetId: grace.id } });
    expect(suggestion).toMatchObject({ source: "AUTOMATION", status: "PENDING", assigneeId: owner.id });
    expect((suggestion.payload as { draftId?: string }).draftId).toBe(draft.id);
    const sent = await as(owner, (ctx) =>
      composeEmail(ctx, { personId: grace.id, subject: draft.subject!, body: draft.bodyText!, draftId: draft.id, confirmConflict: true }),
    );
    expect("messageId" in sent).toBe(true);
    expect(await ownerDb.crmEmailMessage.count({ where: { id: draft.id } })).toBe(0);
    expect((await ownerDb.crmSuggestion.findUniqueOrThrow({ where: { id: suggestion.id } })).status).toBe("ACCEPTED");
    await as(owner, (ctx) => setWorkflowStatus(ctx, review.id, "OFF"));
  });

  it("puts an AI draft in compose for the member who asked, and in Review for an agent's", async () => {
    if (!reachable) return;
    const p = await as(member, (ctx) => createPerson(ctx, { name: "Mara Quinn", primaryEmail: `mara-${tag}@quinn.example` }));
    const mine = await as(member, (ctx) =>
      deliverDraft(ctx.db, {
        organizationId: org,
        target: { kind: "person", id: p.id },
        to: [`mara-${tag}@quinn.example`],
        subject: "Following up",
        body: "Hi Mara",
        title: "Email draft to Mara",
        source: "AI",
        proposedById: member.id,
        assigneeId: member.id,
        inCompose: true,
      }),
    );
    expect(mine.draftId).toBeTruthy();
    expect(mine.suggestionId).toBeNull();
    const agent = await as(member, (ctx) =>
      deliverDraft(ctx.db, {
        organizationId: org,
        target: { kind: "person", id: p.id },
        to: [`mara-${tag}@quinn.example`],
        subject: "Checking in",
        body: "Hi Mara, it's been a while",
        title: "Follow up with Mara",
        source: "AI",
        proposedById: member.id,
        assigneeId: member.id,
      }),
    );
    expect(agent.suggestionId).toBeTruthy();
    expect(await ownerDb.crmEmailMessage.count({ where: { organizationId: org, personId: p.id, status: "DRAFT" } })).toBe(2);
    expect(await ownerDb.crmEmailMessage.count({ where: { organizationId: org, personId: p.id, status: { not: "DRAFT" } } })).toBe(0);
  });

  it("makes sequence to-dos real Tasks, queues a text that can't go, and puts call steps on the dialer", async () => {
    if (!reachable) return;
    const lin = await as(member, (ctx) => createPerson(ctx, { name: "Lin Park", primaryEmail: `lin-${tag}@park.example`, phone: "+15555550123" }));
    const seq = await as(member, (ctx) => createSequence(ctx, "Touches"));
    await as(member, (ctx) =>
      saveSequence(ctx, seq.id, {
        sendWindow: { days: [1, 2, 3, 4, 5, 6, 7], startHour: 0, endHour: 24 },
        steps: [
          { kind: "TASK", delayDays: 0, taskTitle: "Send {{first_name}} the deck" },
          { kind: "TEXT", delayDays: 0, body: "Hi {{first_name}}, it's {{my_first_name}}" },
          { kind: "CALL", delayDays: 0, taskTitle: "Call {{first_name}}" },
        ],
      }),
    );
    await as(member, (ctx) => setSequenceStatus(ctx, seq.id, "ON"));
    expect((await as(member, (ctx) => enroll(ctx, seq.id, [lin.id]))).enrolled).toBe(1);
    const e = await ownerDb.crmEnrollment.findFirstOrThrow({ where: { sequenceId: seq.id } });
    await crmSequenceJob(run({ enrollmentId: e.id, step: 0 }));
    const link = await ownerDb.itemLink.findFirstOrThrow({ where: { organizationId: org, fromKind: "task", toKind: "crm-person", toId: lin.id } });
    const task = await ownerDb.task.findUniqueOrThrow({ where: { id: link.fromId } });
    expect(task).toMatchObject({ title: "Send Lin the deck", ownerId: member.id, createdById: member.id });

    // No phone provider here: the text waits in the member's queue, saying why.
    await crmSequenceJob(run({ enrollmentId: e.id, step: 1 }));
    const textStep = await ownerDb.crmActivity.findFirstOrThrow({ where: { organizationId: org, kind: "SEQUENCE_STEP", sourceId: `${e.id}-1` } });
    expect(textStep.subject).toBe("Text Lin Park");
    expect(textStep.body).toMatch(/Telnyx or Twilio/);

    await crmSequenceJob(run({ enrollmentId: e.id, step: 2 }));
    const steps = await withSystemOrgTx(org, ({ db }) => openCallSteps(db, org, member.id));
    const callStep = steps.get(lin.id);
    expect(callStep).toBeTruthy();
    await as(member, (ctx) => logCall(ctx, { personId: lin.id, outcome: "connected", stepId: callStep }));
    const closed = await ownerDb.crmActivity.findUniqueOrThrow({ where: { id: callStep! } });
    expect((closed.meta as { open?: boolean }).open).toBe(false);
    expect(await ownerDb.crmCall.count({ where: { organizationId: org, personId: lin.id } })).toBe(1);
  });

  it("suggests someone new in a reply as a person in Review, keeps signals out, and counts it in the Inbox", async () => {
    if (!reachable) return;
    const kai = await as(owner, (ctx) => createPerson(ctx, { name: "Kai Moss", primaryEmail: `kai-${tag}@moss.example` }));
    const sent = await as(owner, (ctx) => composeEmail(ctx, { personId: kai.id, subject: "Hello", body: "Hi Kai", confirmConflict: true }));
    const messageId = (sent as { messageId: string }).messageId;
    await deliver(org, messageId);
    const m = await ownerDb.crmEmailMessage.findUniqueOrThrow({ where: { id: messageId } });
    const r = await ingestEmail(
      { kind: "reply", organizationId: org, messageId },
      {
        messageId: `kai-reply-${tag}@moss.example`,
        inReplyTo: m.messageIdHeader,
        references: [],
        from: `Kai Moss <kai-${tag}@moss.example>`,
        to: [`reply+${m.trackingToken}@in.example.org`],
        cc: [`Bo Reyes <bo-${tag}@moss.example>`],
        subject: "Re: Hello",
        text: "Looping in Bo.",
        date: new Date(),
        headers: {},
      },
    );
    expect(r.status).toBe("logged");
    const suggestion = await ownerDb.crmSuggestion.findFirstOrThrow({ where: { organizationId: org, kind: "CREATE_PERSON", source: "EMAIL" } });
    expect((suggestion.payload as { person: { primaryEmail: string } }).person.primaryEmail).toBe(`bo-${tag}@moss.example`);
    expect(suggestion.assigneeId).toBe(owner.id);

    // A signal for the owner too: it's an Inbox row, never in Review.
    await ownerDb.crmSuggestion.create({
      data: { organizationId: org, kind: "CREATE_TASK", source: "SIGNAL", title: "Kai went quiet", payload: { title: "x", key: `quiet:${tag}` }, assigneeId: owner.id },
    });
    const queue = await as(owner, (ctx) => listQueue(ctx.db, org, owner.id, {}));
    expect(queue.some((q) => q.source === "SIGNAL")).toBe(false);
    expect(queue.some((q) => q.id === suggestion.id)).toBe(true);
    const mail = await as(owner, (ctx) => listQueue(ctx.db, org, owner.id, { source: "EMAIL" }));
    expect(mail.map((q) => q.id)).toEqual([suggestion.id]);

    const counts = await as(owner, (ctx) =>
      sidebarCounts(ctx.db, {
        orgId: org,
        userId: owner.id,
        org: { timezone: "America/New_York" },
        canReviewFinance: false,
        canReviewForms: false,
        crm: { orgSlug: `crm-int-${tag}`, roles: new Map() },
      }),
    );
    // Kai's reply waits on the owner, the Review row, and the signal.
    expect(counts.needsYou.crm).toBeGreaterThanOrEqual(2);
    expect(counts.needsYou.signals).toBe(1);
  });

  it("adds someone who texted from an unknown number as a person, their texts on their timeline", async () => {
    if (!reachable) return;
    await ownerDb.crmTextMessage.createMany({
      data: [
        { id: `tx1_${tag}`, organizationId: org, direction: "INBOUND", fromNumber: "+15555550188", toNumber: "+15555550100", body: "Is build night on?", provider: "twilio", status: "received", sentAt: new Date(Date.now() - 60_000) },
        { id: `tx2_${tag}`, organizationId: org, direction: "INBOUND", fromNumber: "+15555550188", toNumber: "+15555550100", body: "STOP", provider: "twilio", status: "received", sentAt: new Date() },
      ],
    });
    const { personId } = await as(member, (ctx) => addTextSender(ctx, `tx1_${tag}`, "Sam Ortiz"));
    const sam = await ownerDb.crmPerson.findUniqueOrThrow({ where: { id: personId } });
    expect(sam).toMatchObject({ name: "Sam Ortiz", phone: "+15555550188", doNotContact: true });
    expect(await ownerDb.crmTextMessage.count({ where: { organizationId: org, personId } })).toBe(2);
    expect(await ownerDb.crmActivity.count({ where: { organizationId: org, kind: "TEXT", sourceKind: "text", targets: { some: { targetId: personId } } } })).toBe(2);
  });

  it("reads a close on its day in the organization's timezone", async () => {
    if (!reachable) return;
    const pipeline = await ownerDb.crmPipeline.findFirstOrThrow({ where: { organizationId: org } });
    const won = await ownerDb.crmStage.findFirstOrThrow({ where: { pipelineId: pipeline.id, kind: "WON" } });
    // 10 PM on March 31 in New York is already April 1 in UTC.
    await ownerDb.crmDeal.create({
      data: { organizationId: org, pipelineId: pipeline.id, stageId: won.id, title: "Late Q1 close", closedAt: new Date("2026-04-01T02:00:00Z") },
    });
    const items = await withSystemOrgTx(org, ({ db }) => forecastItems(db, org, pipeline.id));
    expect(items.find((i) => i.closedOn)?.closedOn).toBe("2026-03-31");
  });
});
