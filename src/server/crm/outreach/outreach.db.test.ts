// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Reaching out against the real roles and policies on the local database:
 * a 1:1 email queued and sent (to the mail sink), asked first when another
 * member is talking to them; a reply coming in through ingestEmail that
 * stops the sequence and lands on the timeline and in the queue; a bounce;
 * one-click unsubscribe applying everywhere; a sequence step run by its
 * job; a booking; keep-in-touch lapsing; a handover with its brief; the
 * guest and self-update links. Skipped when the database is not reachable.
 */

process.env.EMAIL_DELIVERY = "sink";

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock, getSession: vi.fn() }));
vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));
vi.mock("@/server/org-chart/queries", () => ({ getPublishedOrgChart: vi.fn(async () => null) }));
vi.mock("@/server/jobs/kick", () => ({ scheduleKick: vi.fn() }));

import { authDb, disconnectAll } from "@/server/db/clients";
import { withOrgTx, type OrgContext } from "@/server/db/context";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";

import { createPerson } from "../people";
import { runSetup } from "../setup";
import { book, createBookingPage, loadBooking, updateBookingPage } from "./booking";
import { lapseCadences } from "./daily";
import { briefs, handOver } from "./handover";
import { ingestEmail } from "./inbound";
import { createGuestLink, loadGuestPage, addDeliverable } from "./partners";
import { applyUnsubscribe } from "./public";
import { followUpQueue } from "./queue";
import { ensureSelfUpdateLink, loadSelfUpdate, saveSelfUpdate } from "./self-update";
import { composeEmail, crmSendJob, deliver } from "./send";
import { createSequence, crmSequenceJob, enroll, saveSequence, setSequenceStatus } from "./sequences";
import { selfUpdateToken, unsubscribeToken } from "./tokens";

const tag = randomBytes(4).toString("hex");
const org = `c_outreach_${tag}`;

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

beforeAll(async () => {
  try {
    owner = await makeUser("out-owner");
    member = await makeUser("out-member");
    await ownerDb.organization.create({ data: { id: org, name: "Outreach Test", slug: `outreach-${tag}`, timezone: "UTC", plan: "SOCIETY" } });
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
    console.warn("[outreach.db.test] skipped:", error instanceof Error ? error.message : error);
    reachable = false;
  }
});

afterAll(async () => {
  if (reachable) {
    await ownerDb.organization.deleteMany({ where: { id: org } });
    await ownerDb.user.deleteMany({ where: { id: { in: [owner, member].filter(Boolean).map((u) => u.id) } } });
  }
  await disconnectAll();
  await disconnectOwnerDb();
});

describe("reaching out against the local database", () => {
  it("sends a 1:1 email, asks first when someone else is talking to them, and takes the reply in", async () => {
    if (!reachable) return;
    const ada = await as(owner, (ctx) => createPerson(ctx, { name: "Ada Lovelace", primaryEmail: `ada-${tag}@harbor.org` }));
    const sent = await as(owner, (ctx) => composeEmail(ctx, { personId: ada.id, subject: "Hello {{first_name}}", body: "Hi {{first_name}}, see https://example.org/x" }));
    expect("messageId" in sent).toBe(true);
    const messageId = (sent as { messageId: string }).messageId;
    expect(await deliver(org, messageId)).toBe("sent");
    const m = await ownerDb.crmEmailMessage.findUniqueOrThrow({ where: { id: messageId } });
    expect([m.status, m.subject, m.mailboxUserId]).toEqual(["SENT", "Hello Ada", owner.id]);
    const person = await ownerDb.crmPerson.findUniqueOrThrow({ where: { id: ada.id } });
    expect(person.lastContactedAt).not.toBeNull();

    // The member writing next is asked first: the owner emailed them just now.
    const second = await as(member, (ctx) => composeEmail(ctx, { personId: ada.id, subject: "Hi", body: "Hi" }));
    expect("conflict" in second && second.conflict.userId).toBe(owner.id);

    // Their reply comes back through our Reply-To.
    const r = await ingestEmail(
      { kind: "reply", organizationId: org, messageId },
      {
        messageId: `reply-${tag}@harbor.org`,
        inReplyTo: m.messageIdHeader,
        references: [],
        from: `Ada Lovelace <ada-${tag}@harbor.org>`,
        to: [`reply+${m.trackingToken}@in.example.org`],
        cc: [],
        subject: "Re: Hello Ada",
        text: "Yes please, Thursday works.\n\nOn Tue someone wrote:\n> Hi",
        date: new Date(),
        headers: {},
        senderVerified: true,
      },
    );
    expect(r.status).toBe("logged");
    expect((await ownerDb.crmEmailMessage.findUniqueOrThrow({ where: { id: messageId } })).repliedAt).not.toBeNull();
    const queue = await as(owner, (ctx) => followUpQueue(ctx.db, org, owner.id, new Map(), { mine: true }));
    expect(queue.find((q) => q.id === ada.id)?.reasons[0]?.kind).toBe("reply");
    // The same message twice logs once.
    const again = await ingestEmail(
      { kind: "reply", organizationId: org, messageId },
      { messageId: `reply-${tag}@harbor.org`, inReplyTo: null, references: [], from: `ada-${tag}@harbor.org`, to: [], cc: [], subject: "x", text: "x", date: null, headers: {} },
    );
    expect(again.status).toBe("duplicate");
  });

  it("runs a sequence step at its time and stops it when they reply out of office or bounce", async () => {
    if (!reachable) return;
    const grace = await as(member, (ctx) => createPerson(ctx, { name: "Grace Hopper", primaryEmail: `grace-${tag}@navy.example` }));
    const seq = await as(member, (ctx) => createSequence(ctx, "Welcome"));
    await as(member, (ctx) =>
      saveSequence(ctx, seq.id, {
        sendWindow: { days: [1, 2, 3, 4, 5, 6, 7], startHour: 0, endHour: 24 },
        steps: [
          { kind: "EMAIL", delayDays: 0, subject: "Welcome {{first_name}}", body: "Hi {{first_name}}" },
          { kind: "CALL", delayDays: 2, taskTitle: "Call Grace" },
        ],
      }),
    );
    await as(member, (ctx) => setSequenceStatus(ctx, seq.id, "ON"));
    const r = await as(member, (ctx) => enroll(ctx, seq.id, [grace.id]));
    expect(r.enrolled).toBe(1);
    const e = await ownerDb.crmEnrollment.findFirstOrThrow({ where: { sequenceId: seq.id } });
    await crmSequenceJob(run({ enrollmentId: e.id, step: 0 }));
    const queued = await ownerDb.crmEmailMessage.findFirstOrThrow({ where: { enrollmentId: e.id } });
    expect(queued.subject).toBe("Welcome Grace");
    await crmSendJob(run({ messageId: queued.id }));
    const sent = await ownerDb.crmEmailMessage.findUniqueOrThrow({ where: { id: queued.id } });
    expect(sent.status).toBe("SENT");
    expect((await ownerDb.crmEnrollment.findUniqueOrThrow({ where: { id: e.id } })).nextStep).toBe(1);

    // Out of office: paused until they're back.
    await ingestEmail(
      { kind: "reply", organizationId: org, messageId: sent.id },
      {
        messageId: `ooo-${tag}@navy.example`,
        inReplyTo: sent.messageIdHeader,
        references: [],
        from: `grace-${tag}@navy.example`,
        to: [],
        cc: [],
        subject: "Automatic reply: Welcome Grace",
        text: "I'm out of the office until December 1.",
        date: new Date(),
        headers: { "auto-submitted": "auto-replied" },
        senderVerified: true,
      },
    );
    expect((await ownerDb.crmEnrollment.findUniqueOrThrow({ where: { id: e.id } })).status).toBe("PAUSED");

    // A bounce: stopped, and the address flagged so nobody sends to it again.
    await ingestEmail(
      { kind: "reply", organizationId: org, messageId: sent.id },
      {
        messageId: `bounce-${tag}@mx.example`,
        inReplyTo: sent.messageIdHeader,
        references: [],
        from: "MAILER-DAEMON@mx.example",
        to: [],
        cc: [],
        subject: "Undelivered Mail Returned to Sender",
        text: `Final-Recipient: rfc822; grace-${tag}@navy.example\nStatus: 5.1.1`,
        date: new Date(),
        headers: {},
      },
    );
    expect((await ownerDb.crmEnrollment.findUniqueOrThrow({ where: { id: e.id } })).status).toBe("BOUNCED");
    const flagged = await as(member, (ctx) => composeEmail(ctx, { personId: grace.id, subject: "x", body: "x", confirmConflict: true }).catch((err: Error) => err.message));
    expect(flagged).toMatch(/bounced/);
  });

  it("unsubscribes everywhere from one signed link", async () => {
    if (!reachable) return;
    const p = await as(owner, (ctx) => createPerson(ctx, { name: "Lin", primaryEmail: `lin-${tag}@example.org` }));
    expect(await applyUnsubscribe(unsubscribeToken(org, p.id))).toBe(true);
    expect(await applyUnsubscribe(`${org}.${p.id}.forged`)).toBe(false);
    const row = await ownerDb.crmPerson.findUniqueOrThrow({ where: { id: p.id } });
    expect(row.unsubscribedAt).not.toBeNull();
    const refused = await as(member, (ctx) => composeEmail(ctx, { personId: p.id, subject: "x", body: "x", confirmConflict: true }).catch((err: Error) => err.message));
    expect(refused).toMatch(/unsubscribed/);
  });

  it("books a time on a booking page: a meeting, a person and a timeline row", async () => {
    if (!reachable) return;
    const page = await as(owner, (ctx) => createBookingPage(ctx, "Coffee"));
    await as(owner, (ctx) => updateBookingPage(ctx, page.id, { minNoticeHours: 0, maxDaysAhead: 14 }));
    const loaded = await loadBooking(page.slug);
    expect(loaded?.slots[30]?.length).toBeGreaterThan(0);
    const slot = { start: new Date(loaded!.slots[30]![0]!) };
    const r = await book(page.slug, { start: slot.start.toISOString(), name: "Kai Booker", email: `kai-${tag}@example.org`, answers: {} });
    expect(r.ok).toBe(true);
    // Nothing goes into the CRM until the guest says the address is theirs.
    expect(await ownerDb.crmPersonEmail.findFirst({ where: { organizationId: org, email: `kai-${tag}@example.org` } })).toBeNull();
    const booked = await ownerDb.booking.findFirstOrThrow({ where: { organizationId: org, guestEmail: `kai-${tag}@example.org` } });
    const { verifyBooking } = await import("@/server/booking/book");
    const { bookingToken } = await import("@/server/booking/token");
    expect(await verifyBooking(bookingToken(booked.id))).toBe(true);
    const person = await ownerDb.crmPersonEmail.findFirstOrThrow({ where: { organizationId: org, email: `kai-${tag}@example.org` } });
    const meeting = await ownerDb.crmActivity.findFirstOrThrow({
      where: { organizationId: org, kind: "MEETING", targets: { some: { targetId: person.personId } } },
    });
    const event = await ownerDb.event.findUniqueOrThrow({ where: { id: meeting.sourceId! } });
    expect(event.hostUserId).toBe(owner.id);
    // That time is gone now.
    const again = await book(page.slug, { start: slot.start.toISOString(), name: "Second", email: `two-${tag}@example.org`, answers: {} });
    expect(again.ok).toBe(false);
  });

  it("brings lapsed keep-in-touch people back to the queue", async () => {
    if (!reachable) return;
    const p = await as(owner, (ctx) => createPerson(ctx, { name: "Old Friend", keepInTouchDays: 30 }));
    await ownerDb.crmPerson.update({ where: { id: p.id }, data: { lastContactedAt: new Date(Date.now() - 40 * 86_400_000), nextFollowUpAt: null } });
    const { withSystemOrgTx } = await import("@/server/db/context");
    const r = await withSystemOrgTx(org, ({ db }) => lapseCadences(db, org));
    expect(r.moved).toBeGreaterThan(0);
    expect((await ownerDb.crmPerson.findUniqueOrThrow({ where: { id: p.id } })).nextFollowUpAt).not.toBeNull();
  });

  it("hands one member's relationships to another, with a brief, and gives partners and contacts their own links", async () => {
    if (!reachable) return;
    const p = await as(member, (ctx) => createPerson(ctx, { name: "Handed Over" }));
    const access = await as(owner, async (ctx) => (await import("../access")).requireCrm(ctx));
    const moved = await as(owner, (ctx) => handOver(ctx, access, { fromUserId: member.id, toUserId: owner.id }, new Map()));
    expect(moved.people).toBeGreaterThan(0);
    const b = await as(owner, (ctx) => briefs(ctx.db, org, { id: p.id }));
    expect(b[0]?.lines[0]).toContain("member looked after them");

    // Guest link: the partner sees their item and what we owe them.
    const pipeline = await ownerDb.crmPipeline.findFirstOrThrow({ where: { organizationId: org } });
    // A Deals item is a Finance deal too: it needs its company and an amount.
    const harbor = await as(owner, async (ctx) => (await import("../companies")).createCompany(ctx, { name: "Harbor Light" }));
    const deal = await as(owner, async (ctx) =>
      (await import("../deals")).createDeal(ctx, { pipelineId: pipeline.id, title: "Harbor sponsorship", companyId: harbor.id, amount: 500 }),
    );
    const made = await ownerDb.crmDeal.findUniqueOrThrow({ where: { id: deal.id } });
    expect(made.sponsorshipId).not.toBeNull();
    expect(await ownerDb.sponsorship.findUniqueOrThrow({ where: { id: made.sponsorshipId! } })).toMatchObject({ amountCents: 50000, status: "PROSPECT" });
    await as(owner, (ctx) => addDeliverable(ctx, deal.id, { title: "Logo on shirts" }));
    const link = await as(owner, (ctx) => createGuestLink(ctx, deal.id, null));
    const token = link.url.split("/g/")[1]!;
    const guest = await loadGuestPage(token);
    expect(guest?.title).toBe("Harbor sponsorship");
    expect(guest?.deliverables.map((d) => d.title)).toEqual(["Logo on shirts"]);
    expect(await loadGuestPage("x".repeat(40))).toBeNull();

    // Self-update: they fix their own title.
    await as(owner, (ctx) => ensureSelfUpdateLink(ctx.db, org, p.id));
    const t = selfUpdateToken(org, p.id);
    expect((await loadSelfUpdate(t))?.name).toBe("Handed Over");
    expect(await saveSelfUpdate(t, { name: "Handed Over", email: "", title: "Director", phone: "", company: "" })).toEqual({ ok: true });
    expect((await ownerDb.crmPerson.findUniqueOrThrow({ where: { id: p.id } })).title).toBe("Director");
  });
});
