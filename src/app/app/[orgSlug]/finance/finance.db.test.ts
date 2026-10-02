// @vitest-environment node
// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Finance on the RLS path (0C), against the real roles, policies and
 * triggers of the local database. A throwaway org (OWNER, TREASURER and two
 * MEMBERs, created on the service and auth paths) keeps the seed untouched;
 * it is deleted in afterAll. Skipped without the database or the seed.
 *
 * Pins: finance configuration is OWNER/TREASURER only (app and database),
 * separation of duties holds in the database against the acting user,
 * audit rows arrive only through app.write_finance_audit with the actor
 * fixed by the database, the reimbursement email is an outbox job in the
 * same transaction, Receipt visibility, and no cross-org reach.
 */

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock }));

import { ForbiddenError, NotFoundError } from "@/lib/auth/errors";
import { authDb, disconnectAll, serviceDb } from "@/server/db/clients";
import { withOrgTx, withSystemOrgTx } from "@/server/db/context";
import { getBlob, putBlob } from "@/server/storage";

import { createBudgetPeriod, createCategory, deleteCategory } from "./periods-actions";
import { deleteReceiptAction, getSignedReceiptUrl } from "./receipts-actions";
import { createSponsor, createSponsorship, updateSponsorshipStatus } from "./sponsorships-actions";
import {
  approveExpense,
  createTransaction,
  reimburseExpense,
  submitExpense,
} from "./transactions-actions";

interface Person {
  id: string;
  email: string;
  name: string | null;
}

let cbc: { id: string; kristine: Person; periodId: string } | null = null;
try {
  const rows = await serviceDb.$queryRaw<{ organizationId: string }[]>`
    SELECT "organizationId" FROM app.resolve_org_slug(${"claude-builders-club"})`;
  const cbcId = rows[0]?.organizationId;
  const kristine = await authDb.user.findUnique({
    where: { email: "kristine@example.edu" },
    select: { id: true, email: true, name: true },
  });
  const period = cbcId
    ? await withSystemOrgTx(cbcId, ({ db }) =>
        db.budgetPeriod.findFirst({ where: { organizationId: cbcId, isActive: true } }),
      )
    : null;
  if (cbcId && kristine && period) cbc = { id: cbcId, kristine, periodId: period.id };
} catch {
  cbc = null;
}

const stamp = Date.now();

describe.skipIf(!cbc)("finance on the RLS path (throwaway org)", () => {
  const seed = cbc!;
  const orgId = `fin${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const people: Record<"owner" | "treasurer" | "member" | "member2", Person> = {} as never;
  let periodId: string;
  const as = (p: Person) => requireUserMock.mockResolvedValue(p);

  beforeAll(async () => {
    for (const [key, role] of [
      ["owner", "OWNER"],
      ["treasurer", "TREASURER"],
      ["member", "MEMBER"],
      ["member2", "MEMBER"],
    ] as const) {
      people[key] = await authDb.user.create({
        data: { email: `fin-${key}-${stamp}@example.edu`, name: `Fin ${key}`, emailVerified: new Date() },
        select: { id: true, email: true, name: true },
      });
      // Memberships are created on the service path by the joining user (D6).
      await withSystemOrgTx(orgId, { userId: people[key].id }, async ({ db }) => {
        if (key === "owner") {
          await db.organization.create({
            data: { id: orgId, name: "Finance itest", slug: `fin-itest-${stamp}` },
          });
        }
        await db.membership.create({
          data: { organizationId: orgId, userId: people[key].id, role },
        });
      });
    }
  }, 30_000);

  beforeEach(() => as(people.member));

  afterAll(async () => {
    await withSystemOrgTx(orgId, ({ db }) => db.organization.deleteMany({ where: { id: orgId } }));
    await authDb.user.deleteMany({ where: { id: { in: Object.values(people).map((p) => p.id) } } });
    await disconnectAll();
  });

  it("budget periods and categories: OWNER/TREASURER only, in the app and in the database", async () => {
    as(people.member);
    await expect(
      createBudgetPeriod(orgId, { label: "FY", startsOn: "2026-07-01", endsOn: "2027-06-30" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      withOrgTx(orgId, ({ db }) =>
        db.budgetPeriod.create({
          data: {
            organizationId: orgId,
            label: "sneaky",
            startsOn: new Date("2026-07-01"),
            endsOn: new Date("2027-06-30"),
          },
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);

    as(people.treasurer);
    const created = await createBudgetPeriod(orgId, {
      label: "FY 2026-27",
      startsOn: "2026-07-01",
      endsOn: "2027-06-30",
    });
    expect(created.error).toBeUndefined();
    periodId = created.periodId!;
    const categories = await withOrgTx(orgId, ({ db }) =>
      db.budgetCategory.findMany({ where: { budgetPeriodId: periodId }, orderBy: { sortOrder: "asc" } }),
    );
    expect(categories.map((c) => c.name)).toEqual(["Food", "Supplies", "Events", "Travel", "Marketing"]);

    expect(await createCategory(orgId, periodId, { name: "Swag", allocatedCents: 5000 })).toEqual({});
    const swag = await withOrgTx(orgId, ({ db }) =>
      db.budgetCategory.findFirstOrThrow({ where: { budgetPeriodId: periodId, name: "Swag" } }),
    );
    expect(await deleteCategory(orgId, swag.id)).toEqual({ moved: 0 });
  });

  it("an expense: submitter submits, a treasurer approves (outbox email), nobody self-approves", async () => {
    as(people.member);
    const { transactionId, error } = await createTransaction(orgId, {
      budgetPeriodId: periodId,
      direction: "OUT",
      kind: "EXPENSE",
      amountCents: 4250,
      description: "Pizza",
      occurredAt: "2026-09-01T00:00:00.000Z",
    });
    expect(error).toBeUndefined();
    expect(await submitExpense(orgId, transactionId!)).toEqual({ transactionId });
    // A member cannot approve (app message), even their own.
    expect((await approveExpense(orgId, transactionId!)).error).toMatch(/treasurer or owner/);

    as(people.treasurer);
    expect(await approveExpense(orgId, transactionId!)).toEqual({ transactionId });
    expect(await reimburseExpense(orgId, transactionId!, "Venmo")).toEqual({ transactionId });

    const state = await withSystemOrgTx(orgId, async ({ db }) => ({
      tx: await db.transaction.findUniqueOrThrow({ where: { id: transactionId! } }),
      audit: await db.financeAuditLog.findMany({
        where: { transactionId: transactionId! },
        orderBy: { createdAt: "asc" },
        select: { action: true, actorId: true },
      }),
      jobs: await db.job.findMany({
        where: { dedupeKey: { startsWith: `reimbursement-email:${transactionId}:` } },
        select: { dedupeKey: true },
      }),
    }));
    expect(state.tx.status).toBe("REIMBURSED");
    expect(state.tx.approvedById).toBe(people.treasurer.id);
    expect(state.audit).toEqual([
      { action: "CREATE", actorId: people.member.id },
      { action: "EXPENSE_SUBMIT", actorId: people.member.id },
      { action: "EXPENSE_APPROVE", actorId: people.treasurer.id },
      { action: "EXPENSE_REIMBURSE", actorId: people.treasurer.id },
    ]);
    expect(state.jobs.map((j) => j.dedupeKey).sort()).toEqual([
      `reimbursement-email:${transactionId}:APPROVED`,
      `reimbursement-email:${transactionId}:REIMBURSED`,
    ]);
  });

  it("separation of duties holds in the database, not only in the app", async () => {
    as(people.treasurer);
    const { transactionId } = await createTransaction(orgId, {
      budgetPeriodId: periodId,
      direction: "OUT",
      kind: "EXPENSE",
      amountCents: 1000,
      description: "Own expense",
      occurredAt: "2026-09-02T00:00:00.000Z",
    });
    await submitExpense(orgId, transactionId!);
    expect((await approveExpense(orgId, transactionId!)).error).toMatch(/your own expense/);

    // Straight to the database as the submitter: transaction_guard refuses.
    await expect(
      withOrgTx(orgId, ({ db }) =>
        db.transaction.update({
          where: { id: transactionId! },
          data: { status: "APPROVED", approvedById: people.treasurer.id, approvedAt: new Date() },
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    // Nor can anyone write an audit row directly (no INSERT grant).
    await expect(
      withOrgTx(orgId, ({ db }) =>
        db.financeAuditLog.create({
          data: { organizationId: orgId, actorId: people.owner.id, action: "FORGED", diffJson: {} },
        }),
      ),
    ).rejects.toBeTruthy();

    as(people.owner);
    expect(await approveExpense(orgId, transactionId!)).toEqual({ transactionId });
  });

  it("sponsorships: RECEIVED books an IN transaction, leaving RECEIVED voids it", async () => {
    as(people.member);
    await expect(createSponsor(orgId, { name: "Acme" })).rejects.toBeInstanceOf(ForbiddenError);

    as(people.treasurer);
    const { sponsorId } = await createSponsor(orgId, { name: "Acme", contactEmail: "" });
    const { sponsorshipId, error } = await createSponsorship(orgId, {
      sponsorId,
      budgetPeriodId: periodId,
      amountCents: 100_000,
      ownerId: people.owner.id,
    });
    expect(error).toBeUndefined();
    await updateSponsorshipStatus(orgId, sponsorshipId!, "RECEIVED");
    await updateSponsorshipStatus(orgId, sponsorshipId!, "COMMITTED");

    const booked = await withOrgTx(orgId, async ({ db }) => {
      const s = await db.sponsorship.findUniqueOrThrow({ where: { id: sponsorshipId! } });
      return db.transaction.findUniqueOrThrow({ where: { id: s.transactionId! } });
    });
    expect(booked).toMatchObject({ direction: "IN", kind: "SPONSORSHIP", amountCents: 100_000 });
    expect(booked.voidedAt).not.toBeNull();

    // A foreign owner id is refused before any write.
    expect(
      (
        await createSponsorship(orgId, {
          sponsorId,
          budgetPeriodId: periodId,
          amountCents: 1,
          ownerId: seed.kristine.id,
        })
      ).error,
    ).toMatch(/member of this organization/);
  });

  it("sponsorships: credits never touch the ledger, even when received", async () => {
    as(people.treasurer);
    const { sponsorId } = await createSponsor(orgId, { name: "Cloud Co" });
    const { sponsorshipId, error } = await createSponsorship(orgId, {
      sponsorId,
      budgetPeriodId: periodId,
      type: "CREDITS",
      amountCents: 500_000,
      ownerId: people.owner.id,
    });
    expect(error).toBeUndefined();
    expect(await updateSponsorshipStatus(orgId, sponsorshipId!, "RECEIVED")).toEqual({ sponsorshipId });
    await updateSponsorshipStatus(orgId, sponsorshipId!, "COMMITTED");
    await updateSponsorshipStatus(orgId, sponsorshipId!, "RECEIVED");

    const after = await withOrgTx(orgId, async ({ db }) => ({
      sponsorship: await db.sponsorship.findUniqueOrThrow({ where: { id: sponsorshipId! } }),
      booked: await db.transaction.count({ where: { organizationId: orgId, amountCents: 500_000 } }),
    }));
    expect(after.sponsorship).toMatchObject({ type: "CREDITS", status: "RECEIVED", transactionId: null });
    expect(after.booked).toBe(0);

    // Anything else is refused before any write.
    expect(
      (
        await createSponsorship(orgId, {
          sponsorId,
          budgetPeriodId: periodId,
          type: "GIFT_CARDS",
          amountCents: 1,
          ownerId: people.owner.id,
        })
      ).error,
    ).toBeTruthy();
  });

  it("receipts are visible to the submitter and finance only", async () => {
    as(people.member);
    const { transactionId } = await createTransaction(orgId, {
      budgetPeriodId: periodId,
      direction: "OUT",
      kind: "EXPENSE",
      amountCents: 500,
      description: "Receipt test",
      occurredAt: "2026-09-03T00:00:00.000Z",
    });
    const receipt = await withOrgTx(orgId, ({ db, userId }) =>
      db.receipt.create({
        data: {
          organizationId: orgId,
          transactionId: transactionId!,
          blobKey: `receipts/${orgId}/${transactionId}/itest.pdf`,
          filename: "r.pdf",
          mimeType: "application/pdf",
          sizeBytes: 4,
          uploadedById: userId,
        },
        select: { id: true },
      }),
    );

    const { url } = await getSignedReceiptUrl(orgId, receipt.id);
    expect(url).toMatch(new RegExp(`^/api/finance/receipts/${receipt.id}\\?org=${orgId}&token=`));

    as(people.member2);
    expect(await getSignedReceiptUrl(orgId, receipt.id)).toEqual({ error: "Receipt not found." });
    expect(await deleteReceiptAction(orgId, receipt.id)).toEqual({ error: "Receipt not found." });

    as(people.treasurer);
    expect((await getSignedReceiptUrl(orgId, receipt.id)).url).toBeTruthy();
  });

  it("deleting a receipt removes the row, then the stored file after commit", async () => {
    as(people.member);
    const { transactionId } = await createTransaction(orgId, {
      budgetPeriodId: periodId,
      direction: "OUT",
      kind: "EXPENSE",
      amountCents: 700,
      description: "Receipt delete test",
      occurredAt: "2026-09-04T00:00:00.000Z",
    });
    const stored = await putBlob("receipts", orgId, [transactionId!, "itest.pdf"], Buffer.from("%PDF-1.4"), {
      contentType: "application/pdf",
    });
    const receipt = await withOrgTx(orgId, ({ db, userId }) =>
      db.receipt.create({
        data: {
          organizationId: orgId,
          transactionId: transactionId!,
          blobKey: stored.key,
          filename: "r.pdf",
          mimeType: "application/pdf",
          sizeBytes: 8,
          uploadedById: userId,
        },
        select: { id: true },
      }),
    );
    expect(await getBlob(stored.key)).not.toBeNull();

    expect(await deleteReceiptAction(orgId, receipt.id)).toEqual({});
    expect(await withOrgTx(orgId, ({ db }) => db.receipt.count({ where: { id: receipt.id } }))).toBe(0);
    expect(await getBlob(stored.key)).toBeNull();
  });

  it("nothing crosses into another org", async () => {
    // A member of CBC only: every action refuses the throwaway org outright.
    as(seed.kristine);
    await expect(
      createTransaction(orgId, {
        budgetPeriodId: periodId,
        direction: "OUT",
        kind: "EXPENSE",
        amountCents: 1,
        description: "x",
        occurredAt: "2026-09-01T00:00:00.000Z",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    // The treasurer here cannot book against CBC's period or read its rows.
    as(people.treasurer);
    expect(
      (
        await createTransaction(orgId, {
          budgetPeriodId: seed.periodId,
          direction: "OUT",
          kind: "EXPENSE",
          amountCents: 1,
          description: "x",
          occurredAt: "2026-09-01T00:00:00.000Z",
        })
      ).error,
    ).toMatch(/Budget period not found/);
    const foreign = await withOrgTx(orgId, ({ db }) =>
      db.transaction.count({ where: { organizationId: seed.id } }),
    );
    expect(foreign).toBe(0);
    await expect(createCategory(seed.id, seed.periodId, { name: "x", allocatedCents: 0 })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
