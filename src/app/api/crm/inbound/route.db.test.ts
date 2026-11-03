// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * /api/crm/inbound driven the way the Cloudflare Email Worker
 * (workers/crm-inbound) calls it: a parsed message as JSON with the shared
 * secret as a bearer token. A reply to a sequence email stops the
 * sequence; a bounce stops it and flags the address; a request without
 * the right secret is refused before anything is read. Skipped when the
 * database is not reachable.
 */

const SECRET = `inbound-test-${randomBytes(12).toString("hex")}`;
const DOMAIN = "in.example.org";
process.env.EMAIL_DELIVERY = "sink";
process.env.CRM_INBOUND_SECRET = SECRET;
process.env.CRM_INBOUND_DOMAIN = DOMAIN;

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock, getSession: vi.fn() }));
vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));
vi.mock("@/server/org-chart/queries", () => ({ getPublishedOrgChart: vi.fn(async () => null) }));
vi.mock("@/server/jobs/kick", () => ({ scheduleKick: vi.fn() }));

import { createPerson } from "@/server/crm/people";
import { crmSendJob } from "@/server/crm/outreach/send";
import { createSequence, crmSequenceJob, enroll, saveSequence, setSequenceStatus } from "@/server/crm/outreach/sequences";
import { runSetup } from "@/server/crm/setup";
import { authDb, disconnectAll } from "@/server/db/clients";
import { withOrgTx, type OrgContext } from "@/server/db/context";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";

import { POST } from "./route";

const tag = randomBytes(4).toString("hex");
const org = `c_inbound_${tag}`;

type U = { id: string; email: string; name: string };
let owner: U;
let reachable = true;

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

/** What the Worker POSTs (workers/crm-inbound/src/index.js). */
function workerRequest(body: unknown, secret: string | null = SECRET): Request {
  const json = JSON.stringify(body);
  return new Request("http://localhost/api/crm/inbound", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(json)),
      ...(secret === null ? {} : { authorization: `Bearer ${secret}` }),
    },
    body: json,
  });
}

/** A person in a two-step sequence whose first email has gone out. */
async function sentSequenceEmail(name: string, email: string) {
  const person = await as(owner, (ctx) => createPerson(ctx, { name, primaryEmail: email }));
  const seq = await as(owner, (ctx) => createSequence(ctx, `Welcome ${name}`));
  await as(owner, (ctx) =>
    saveSequence(ctx, seq.id, {
      sendWindow: { days: [1, 2, 3, 4, 5, 6, 7], startHour: 0, endHour: 24 },
      steps: [
        { kind: "EMAIL", delayDays: 0, subject: "Welcome {{first_name}}", body: "Hi {{first_name}}" },
        { kind: "EMAIL", delayDays: 3, subject: "Checking in", body: "Hi again {{first_name}}" },
      ],
    }),
  );
  await as(owner, (ctx) => setSequenceStatus(ctx, seq.id, "ON"));
  await as(owner, (ctx) => enroll(ctx, seq.id, [person.id]));
  const e = await ownerDb.crmEnrollment.findFirstOrThrow({ where: { sequenceId: seq.id } });
  await crmSequenceJob(run({ enrollmentId: e.id, step: 0 }));
  const queued = await ownerDb.crmEmailMessage.findFirstOrThrow({ where: { enrollmentId: e.id } });
  await crmSendJob(run({ messageId: queued.id }));
  const sent = await ownerDb.crmEmailMessage.findUniqueOrThrow({ where: { id: queued.id } });
  expect(sent.status).toBe("SENT");
  return { person, enrollmentId: e.id, sent };
}

beforeAll(async () => {
  try {
    const row = await authDb.user.create({
      data: { email: `inbound-owner-${tag}@example.edu`, name: "Inbound Owner", emailVerified: new Date(), onboardedAt: new Date() },
      select: { id: true, email: true, name: true },
    });
    owner = { id: row.id, email: row.email, name: row.name ?? "Inbound Owner" };
    await ownerDb.organization.create({ data: { id: org, name: "Inbound Test", slug: `inbound-${tag}`, timezone: "UTC", plan: "SOCIETY" } });
    await ownerDb.membership.create({ data: { organizationId: org, userId: owner.id, role: "OWNER" } });
    await ownerDb.orgSettings.upsert({
      where: { organizationId: org },
      create: { organizationId: org, addOns: ["crm"] },
      update: { addOns: ["crm"] },
    });
    await as(owner, (ctx) => runSetup(ctx, ["sponsors"]));
  } catch (error) {
    console.warn("[inbound route.db.test] skipped:", error instanceof Error ? error.message : error);
    reachable = false;
  }
});

afterAll(async () => {
  if (reachable) {
    await ownerDb.organization.deleteMany({ where: { id: org } });
    await ownerDb.user.deleteMany({ where: { id: owner?.id ?? "" } });
  }
  await disconnectAll();
  await disconnectOwnerDb();
});

describe("/api/crm/inbound from the Cloudflare Email Worker", () => {
  it("refuses a request without the shared secret, before reading it", async () => {
    const message = { from: "someone@example.com", to: [`reply+${"a".repeat(24)}@${DOMAIN}`], headers: {}, text: "hi", html: null };
    const none = await POST(workerRequest(message, null));
    expect(none.status).toBe(401);
    const wrong = await POST(workerRequest(message, `${SECRET}x`));
    expect(wrong.status).toBe(401);
    const short = await POST(workerRequest(message, "short"));
    expect(short.status).toBe(401);
  });

  it("refuses a body that isn't a parsed message", async () => {
    if (!reachable) return;
    const r = await POST(workerRequest({ nope: true }));
    expect(r.status).toBe(400);
  });

  it("takes a reply in and stops the sequence", async () => {
    if (!reachable) return;
    const { enrollmentId, sent } = await sentSequenceEmail("Ada Lovelace", `ada-${tag}@harbor.org`);
    const res = await POST(
      workerRequest({
        from: `ada-${tag}@harbor.org`,
        to: [`reply+${sent.trackingToken}@${DOMAIN}`],
        headers: {
          from: `Ada Lovelace <ada-${tag}@harbor.org>`,
          to: `reply+${sent.trackingToken}@${DOMAIN}`,
          subject: "Re: Welcome Ada",
          "message-id": `<reply-${tag}@harbor.org>`,
          "in-reply-to": `<${sent.messageIdHeader}>`,
          date: new Date().toUTCString(),
        },
        text: "Thanks, Thursday works for me.\n\nOn Tue someone wrote:\n> Hi Ada",
        html: null,
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, results: ["logged"] });
    const e = await ownerDb.crmEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } });
    expect(e.status).toBe("REPLIED");
    expect((await ownerDb.crmEmailMessage.findUniqueOrThrow({ where: { id: sent.id } })).repliedAt).not.toBeNull();
  });

  it("reads a bounce: the sequence stops and the address is flagged", async () => {
    if (!reachable) return;
    const { person, enrollmentId, sent } = await sentSequenceEmail("Grace Hopper", `grace-${tag}@navy.example`);
    const res = await POST(
      workerRequest({
        from: "MAILER-DAEMON@mx.example",
        to: [`reply+${sent.trackingToken}@${DOMAIN}`],
        headers: {
          from: "Mail Delivery System <MAILER-DAEMON@mx.example>",
          to: `reply+${sent.trackingToken}@${DOMAIN}`,
          subject: "Undelivered Mail Returned to Sender",
          "message-id": `<bounce-${tag}@mx.example>`,
          "in-reply-to": `<${sent.messageIdHeader}>`,
        },
        text: `Final-Recipient: rfc822; grace-${tag}@navy.example\nAction: failed\nStatus: 5.1.1`,
        html: null,
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, results: ["bounce"] });
    expect((await ownerDb.crmEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } })).status).toBe("BOUNCED");
    const p = await ownerDb.crmPerson.findUniqueOrThrow({ where: { id: person.id }, select: { consent: true } });
    expect(JSON.stringify(p.consent)).toMatch(/bounced/);
  });
});
