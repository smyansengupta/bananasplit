// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The CRM's core against the real roles and policies on the local database:
 * setup, people (addresses, job history, field history), stage moves with
 * required fields, bulk edits with Undo, duplicates and merging, the
 * timeline (idempotent mirroring), imports, Finance deals moved in and kept in
 * step with Finance, and who sees what (another organization, OWN access).
 * Two throwaway organizations are made as the table owner and removed in
 * afterAll. Skipped when the database is not reachable.
 */

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock, getSession: vi.fn() }));
vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));
vi.mock("@/server/org-chart/queries", () => ({ getPublishedOrgChart: vi.fn(async () => null) }));

import { authDb, disconnectAll } from "@/server/db/clients";
import { withOrgTx, withSystemOrgTx, type OrgContext } from "@/server/db/context";
import { setSponsorshipStatus } from "@/server/finance/sponsorship-status";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";

import { CrmError } from "./access";
import { logActivity, timeline } from "./activity";
import { bulkUpdate, undoBatch, restoreToPoint } from "./bulk";
import { addCrmField } from "./databases";
import { createDeal, moveDeal } from "./deals";
import { pendingDuplicates, resolveDuplicate, scanDuplicates } from "./dedupe";
import { createImportLog, readImportLog, startImport } from "./import";
import { mirrorWorkspace } from "./mirror";
import { createPerson, updatePerson } from "./people";
import { listPipelines } from "./pipelines";
import { runSetup } from "./setup";

const tag = randomBytes(4).toString("hex");
const orgA = `c_crmtest_a_${tag}`;
const orgB = `c_crmtest_b_${tag}`;

type U = { id: string; email: string; name: string };
let ownerA: U;
let memberA: U;
let ownerB: U;
let reachable = true;

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
  try {
    ownerA = await makeUser("crm-owner-a");
    memberA = await makeUser("crm-member-a");
    ownerB = await makeUser("crm-owner-b");
    await ownerDb.organization.createMany({
      data: [
        { id: orgA, name: "CRM Test A", slug: `crm-test-a-${tag}`, timezone: "UTC", plan: "SOCIETY" },
        { id: orgB, name: "CRM Test B", slug: `crm-test-b-${tag}`, timezone: "UTC", plan: "SOCIETY" },
      ],
    });
    await ownerDb.membership.createMany({
      data: [
        { organizationId: orgA, userId: ownerA.id, role: "OWNER" },
        { organizationId: orgA, userId: memberA.id, role: "MEMBER" },
        { organizationId: orgB, userId: ownerB.id, role: "OWNER" },
      ],
    });
    for (const id of [orgA, orgB]) {
      await ownerDb.orgSettings.upsert({
        where: { organizationId: id },
        create: { organizationId: id, addOns: ["crm", "finance"] },
        update: { addOns: ["crm", "finance"] },
      });
    }
    // A Finance partner with a deal, to move in at setup.
    const period = await ownerDb.budgetPeriod.create({
      data: {
        organizationId: orgA,
        label: "2026",
        startsOn: new Date("2026-01-01"),
        endsOn: new Date("2026-12-31"),
        isActive: true,
      },
    });
    const sponsor = await ownerDb.sponsor.create({
      data: { organizationId: orgA, name: "Harbor Light Coffee", contactName: "Mara Quinn", contactEmail: "Mara@HarborLight.coffee" },
    });
    await ownerDb.sponsorship.create({
      data: {
        organizationId: orgA,
        sponsorId: sponsor.id,
        budgetPeriodId: period.id,
        amountCents: 150_000,
        ownerId: ownerA.id,
      },
    });
  } catch (error) {
    console.warn("[crm.db.test] skipped:", error instanceof Error ? error.message : error);
    reachable = false;
  }
});

afterAll(async () => {
  if (reachable) {
    await ownerDb.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await ownerDb.user.deleteMany({
      where: { id: { in: [ownerA, memberA, ownerB].filter(Boolean).map((u) => u.id) } },
    });
  }
  await disconnectAll();
  await disconnectOwnerDb();
});

describe("the CRM against the local database", () => {
  it("sets up in one step, idempotently, with Finance deals moved in", async () => {
    if (!reachable) return;
    const first = await as(ownerA, orgA, (ctx) => runSetup(ctx, ["members", "donors"]));
    // Deals exist in Finance, so the Deals pipeline comes too.
    expect(first.pipelines).toBe(3);
    expect(first.sponsors).toEqual({ companies: 1, items: 1 });
    const again = await as(ownerA, orgA, (ctx) => runSetup(ctx, ["members"]));
    expect(again.pipelines).toBe(0);
    expect(again.sponsors).toEqual({ companies: 0, items: 0 });
    const pipelines = await as(ownerA, orgA, (ctx) => listPipelines(ctx.db, orgA));
    expect(pipelines.map((p) => p.template)).toEqual(["members", "donors", "sponsors"]);
    expect(pipelines.every((p) => p.databaseId)).toBe(true);
    const kinds = await ownerDb.databaseDefinition.findMany({
      where: { organizationId: orgA, kind: { in: ["CRM_PEOPLE", "CRM_COMPANIES", "CRM_PIPELINE"] } },
      select: { kind: true },
    });
    expect(kinds.filter((k) => k.kind === "CRM_PIPELINE")).toHaveLength(3);
    const mara = await ownerDb.crmPersonEmail.findFirst({ where: { organizationId: orgA, email: "mara@harborlight.coffee" } });
    expect(mara).not.toBeNull();
    // Members can't set it up.
    await expect(as(memberA, orgA, (ctx) => runSetup(ctx, ["clients"]))).rejects.toThrow(CrmError);
  });

  it("keeps one person per address, lowercased, with job and field history", async () => {
    if (!reachable) return;
    const { id } = await as(memberA, orgA, (ctx) =>
      createPerson(ctx, { name: "Ada Lovelace", primaryEmail: "ADA@Analytical.org", companyName: "Analytical Engines", title: "Programmer" }),
    );
    const person = await ownerDb.crmPerson.findUniqueOrThrow({ where: { id }, include: { emails: true, jobs: true } });
    expect(person.primaryEmail).toBe("ada@analytical.org");
    expect(person.emails.map((e) => e.email)).toEqual(["ada@analytical.org"]);
    expect(person.createdById).toBe(memberA.id);
    expect(person.ownerId).toBe(memberA.id);
    expect(person.jobs).toHaveLength(1);
    await expect(
      as(memberA, orgA, (ctx) => createPerson(ctx, { name: "Someone else", primaryEmail: "ada@analytical.org" })),
    ).rejects.toThrow(/already Ada Lovelace's address/);

    await as(memberA, orgA, (ctx) => updatePerson(ctx, id, { companyName: "Babbage and Co", title: "Lead" }));
    const jobs = await ownerDb.crmJob.findMany({ where: { personId: id }, orderBy: { createdAt: "asc" } });
    expect(jobs.map((j) => [j.companyName, j.current])).toEqual([
      ["Analytical Engines", false],
      ["Babbage and Co", true],
    ]);
    const history = await ownerDb.crmFieldHistory.findMany({ where: { targetId: id }, select: { field: true } });
    expect(history.map((h) => h.field)).toEqual(expect.arrayContaining(["created", "companyId", "title"]));
    // Another organization sees nothing of it.
    const other = await as(ownerB, orgB, (ctx) => ctx.db.crmPerson.count({ where: { id } }));
    expect(other).toBe(0);
  });

  it("asks a stage for its required fields, then moves and logs it", async () => {
    if (!reachable) return;
    const members = (await as(ownerA, orgA, (ctx) => listPipelines(ctx.db, orgA))).find((p) => p.template === "members")!;
    const lost = members.stages.find((s) => s.kind === "LOST")!;
    const { id } = await as(memberA, orgA, (ctx) => createDeal(ctx, { pipelineId: members.id, title: "Priya Raman" }));
    const needs = await as(memberA, orgA, (ctx) => moveDeal(ctx, id, { stageId: lost.id }));
    expect(needs.needs?.keys).toEqual(["closeReason"]);
    const deal1 = await ownerDb.crmDeal.findUniqueOrThrow({ where: { id } });
    expect(deal1.stageId).toBe(members.stages[0]!.id);
    await as(memberA, orgA, (ctx) => moveDeal(ctx, id, { stageId: lost.id, closeReason: "Joined another group" }));
    const deal2 = await ownerDb.crmDeal.findUniqueOrThrow({ where: { id } });
    expect(deal2.stageId).toBe(lost.id);
    expect(deal2.closedAt).not.toBeNull();
    const entries = await as(memberA, orgA, (ctx) => timeline(ctx.db, orgA, { kind: "deal", id }));
    expect(entries[0]?.kind).toBe("STAGE_CHANGE");
  });

  it("undoes a bulk edit and restores a record to an earlier point", async () => {
    if (!reachable) return;
    const a = await as(ownerA, orgA, (ctx) => createPerson(ctx, { name: "Grace Hopper", title: "Admiral" }));
    const b = await as(ownerA, orgA, (ctx) => createPerson(ctx, { name: "Alan Turing" }));
    const { batchId, changed } = await as(ownerA, orgA, (ctx) => bulkUpdate(ctx, "person", [a.id, b.id], { status: "ALUMNI" }));
    expect(changed).toBe(2);
    expect((await ownerDb.crmPerson.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("ALUMNI");
    await as(ownerA, orgA, (ctx) => undoBatch(ctx, batchId));
    expect((await ownerDb.crmPerson.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("ACTIVE");
    // Someone else can't undo it.
    await expect(as(memberA, orgA, (ctx) => undoBatch(ctx, batchId))).rejects.toThrow(/Only the person/);

    const before = new Date();
    await new Promise((r) => setTimeout(r, 20));
    await as(ownerA, orgA, (ctx) => updatePerson(ctx, a.id, { title: "Rear Admiral" }));
    await as(ownerA, orgA, (ctx) => restoreToPoint(ctx, "person", a.id, before));
    expect((await ownerDb.crmPerson.findUniqueOrThrow({ where: { id: a.id } })).title).toBe("Admiral");
  });

  it("finds duplicates and merges them, keeping every address, item and timeline entry", async () => {
    if (!reachable) return;
    const keep = await as(ownerA, orgA, (ctx) => createPerson(ctx, { name: "Charles Babbage", primaryEmail: "charles@engines.org" }));
    const drop = await as(ownerA, orgA, (ctx) =>
      createPerson(ctx, { name: "Charles Babbage", primaryEmail: "cb@gmail.com", phone: "617 555 0101" }),
    );
    const donors = (await as(ownerA, orgA, (ctx) => listPipelines(ctx.db, orgA))).find((p) => p.template === "donors")!;
    const deal = await as(ownerA, orgA, (ctx) => createDeal(ctx, { pipelineId: donors.id, title: "Gift", primaryPersonId: drop.id }));
    await as(ownerA, orgA, (ctx) =>
      logActivity(ctx.db, {
        organizationId: orgA,
        kind: "CALL",
        subject: "Talked about the gift",
        targets: [{ kind: "person", id: drop.id }],
        actorId: ownerA.id,
        createdById: ownerA.id,
      }),
    );
    const found = await as(ownerA, orgA, (ctx) => scanDuplicates(ctx.db, orgA, ownerA.id));
    expect(found.people).toBeGreaterThanOrEqual(1);
    const list = await as(ownerA, orgA, (ctx) => pendingDuplicates(ctx.db, orgA));
    const pair = list.find((d) => d.records.some((r) => r.id === drop.id) && d.records.some((r) => r.id === keep.id))!;
    expect(pair).toBeDefined();
    // Scanning again suggests nothing new.
    expect((await as(ownerA, orgA, (ctx) => scanDuplicates(ctx.db, orgA, ownerA.id))).people).toBe(0);
    await as(ownerA, orgA, (ctx) => resolveDuplicate(ctx, pair.id, { accept: true, keepId: keep.id }));
    const kept = await ownerDb.crmPerson.findUniqueOrThrow({ where: { id: keep.id }, include: { emails: true, deals: true } });
    expect(kept.emails.map((e) => e.email).sort()).toEqual(["cb@gmail.com", "charles@engines.org"]);
    expect(kept.phone).toBe("+16175550101");
    expect(kept.deals.map((d) => d.dealId)).toEqual([deal.id]);
    expect((await ownerDb.crmDeal.findUniqueOrThrow({ where: { id: deal.id } })).primaryPersonId).toBe(keep.id);
    const tl = await as(ownerA, orgA, (ctx) => timeline(ctx.db, orgA, { kind: "person", id: keep.id }));
    expect(tl.some((e) => e.subject === "Talked about the gift")).toBe(true);
    expect((await ownerDb.crmPerson.findUniqueOrThrow({ where: { id: drop.id } })).deletedAt).not.toBeNull();
  });

  it("mirrors the workspace onto timelines once, and moves last contacted", async () => {
    if (!reachable) return;
    const p = await as(ownerA, orgA, (ctx) => createPerson(ctx, { name: "Member Person", primaryEmail: memberA.email }));
    expect((await ownerDb.crmPerson.findUniqueOrThrow({ where: { id: p.id } })).userId).toBe(memberA.id);
    const event = await ownerDb.event.create({
      data: {
        organizationId: orgA,
        title: "Demo night",
        startsAt: new Date(Date.now() - 86_400_000),
        endsAt: new Date(Date.now() - 82_800_000),
        createdById: ownerA.id,
      },
    });
    await ownerDb.eventAttendee.create({ data: { organizationId: orgA, eventId: event.id, userId: memberA.id, rsvp: "YES" } });
    const run = () => withSystemOrgTx(orgA, ({ db }) => mirrorWorkspace(db, orgA));
    await run();
    await run();
    const acts = await ownerDb.crmActivity.findMany({ where: { organizationId: orgA, sourceKind: "event", sourceId: event.id } });
    expect(acts).toHaveLength(1);
    expect(acts[0]!.kind).toBe("MEETING");
    expect((await ownerDb.crmPerson.findUniqueOrThrow({ where: { id: p.id } })).lastContactedAt).not.toBeNull();
  });

  it("imports a file, deduping on email and keeping its notes", async () => {
    if (!reachable) return;
    const log = await as(ownerA, orgA, (ctx) =>
      createImportLog(ctx, {
        fileName: "hubspot.csv",
        source: "hubspot",
        object: "person",
        headers: ["First Name", "Last Name", "Email", "Company Name", "Notes"],
        rows: [
          { "First Name": "Ada", "Last Name": "Lovelace", Email: "ada@analytical.org", "Company Name": "", Notes: "Old friend" },
          { "First Name": "Hedy", "Last Name": "Lamarr", Email: "hedy@films.example", "Company Name": "MGM", Notes: "" },
          { "First Name": "", "Last Name": "", Email: "", "Company Name": "", Notes: "" },
        ],
      }),
    );
    expect(log.mapping.Notes).toBe("activity.body");
    const done = await as(ownerA, orgA, (ctx) => startImport(ctx, log.id, { object: "person", mapping: log.mapping }));
    expect(done.status).toBe("done");
    expect([done.created, done.updated, done.skipped]).toEqual([1, 1, 1]);
    const ada = await ownerDb.crmPersonEmail.findFirstOrThrow({ where: { organizationId: orgA, email: "ada@analytical.org" } });
    const notes = await as(ownerA, orgA, (ctx) => timeline(ctx.db, orgA, { kind: "person", id: ada.personId }));
    expect(notes.some((n) => n.body === "Old friend" && n.kind === "NOTE")).toBe(true);
    const again = await as(ownerA, orgA, (ctx) => readImportLog(ctx.db, orgA, log.id));
    expect(again?.status).toBe("done");
  });

  it("checks custom values, links included", async () => {
    if (!reachable) return;
    const size = await as(ownerA, orgA, (ctx) => addCrmField(ctx, { object: "person" }, { name: "Shirt size", type: "SELECT", options: { choices: [{ id: "m", label: "M", color: "blue" }] } }));
    const buddy = await as(ownerA, orgA, (ctx) => addCrmField(ctx, { object: "person" }, { name: "Buddy", type: "RELATION", options: { target: { kind: "person" } } }));
    const x = await as(memberA, orgA, (ctx) => createPerson(ctx, { name: "Custom Person", custom: { [size.id]: "M" } }));
    expect((await ownerDb.crmPerson.findUniqueOrThrow({ where: { id: x.id } })).custom).toEqual({ [size.id]: "m" });
    await expect(as(memberA, orgA, (ctx) => updatePerson(ctx, x.id, { custom: { [size.id]: "XXL" } }))).rejects.toThrow(/Shirt size/);
    const otherOrg = await as(ownerB, orgB, async (ctx) => {
      await runSetup(ctx, ["clients"]);
      return createPerson(ctx, { name: "Elsewhere" });
    });
    await expect(
      as(memberA, orgA, (ctx) => updatePerson(ctx, x.id, { custom: { [buddy.id]: [{ kind: "person", id: otherOrg.id }] } })),
    ).rejects.toThrow(/Buddy/);
    await as(memberA, orgA, (ctx) => updatePerson(ctx, x.id, { custom: { [buddy.id]: [{ kind: "person", id: x.id }] } }));
    // Members don't shape the CRM.
    await expect(as(memberA, orgA, (ctx) => addCrmField(ctx, { object: "person" }, { name: "Nope", type: "TEXT" }))).rejects.toThrow(CrmError);
  });

  it("moves a Finance deal through Finance: Received books the money, and Finance moves the item back", async () => {
    if (!reachable) return;
    const deal = await ownerDb.crmDeal.findFirstOrThrow({ where: { organizationId: orgA, sponsorshipId: { not: null } } });
    const pipeline = (await as(ownerA, orgA, (ctx) => listPipelines(ctx.db, orgA))).find((p) => p.template === "sponsors")!;
    const received = pipeline.stages.find((s) => s.key === "RECEIVED")!;
    // A member can't move it: it changes the books.
    await expect(as(memberA, orgA, (ctx) => moveDeal(ctx, deal.id, { stageId: received.id }))).rejects.toThrow(/books/);
    await as(ownerA, orgA, (ctx) => moveDeal(ctx, deal.id, { stageId: received.id }));
    const s = await ownerDb.sponsorship.findUniqueOrThrow({ where: { id: deal.sponsorshipId! } });
    expect(s.status).toBe("RECEIVED");
    const txn = await ownerDb.transaction.findUniqueOrThrow({ where: { id: s.transactionId! } });
    expect([txn.amountCents, txn.direction, txn.kind]).toEqual([150_000, "IN", "SPONSORSHIP"]);
    // Finance moves it back: the item follows, the money is voided.
    await as(ownerA, orgA, (ctx) => setSponsorshipStatus(ctx, s.id, "COMMITTED"));
    const after = await ownerDb.crmDeal.findUniqueOrThrow({ where: { id: deal.id }, include: { stage: true } });
    expect(after.stage.key).toBe("COMMITTED");
    expect((await ownerDb.transaction.findUniqueOrThrow({ where: { id: txn.id } })).voidedAt).not.toBeNull();
  });

  it("hides others' records from members when access is OWN", async () => {
    if (!reachable) return;
    const mine = await as(ownerA, orgA, (ctx) => createPerson(ctx, { name: "Owner's contact" }));
    await ownerDb.crmSettings.update({ where: { organizationId: orgA }, data: { memberAccess: "OWN" } });
    try {
      const seen = await as(memberA, orgA, (ctx) => ctx.db.crmPerson.count({ where: { id: mine.id } }));
      expect(seen).toBe(0);
      const own = await as(memberA, orgA, (ctx) => ctx.db.crmPerson.count({ where: { organizationId: orgA, createdById: memberA.id } }));
      expect(own).toBeGreaterThan(0);
    } finally {
      await ownerDb.crmSettings.update({ where: { organizationId: orgA }, data: { memberAccess: "ALL" } });
    }
  });
});
