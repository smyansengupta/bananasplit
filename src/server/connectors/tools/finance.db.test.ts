// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * list_my_reimbursements and an expense through fetch, against the real
 * roles and policies (src/test/connector-fixture.ts): only the member's
 * own expense requests (never the ledger, which RLS lets every member
 * read), and the denials every tool has.
 */

vi.mock("@/lib/auth/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));

import { NotFoundError } from "@/lib/auth/errors";
import { DELETED_TRANSACTION_REASON } from "@/lib/finance/deleted";
import { disconnectAll } from "@/server/db/clients";
import { ConnectorRefusedError, SpaceRefusedError } from "@/server/db/context";
import { asJson, setUpConnectorFixture, type ConnectorFixture } from "@/test/connector-fixture";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";

import { fetchItem } from "./fetch";
import { listMyReimbursements } from "./finance";
import { itemId } from "./ids";
import { SectionHiddenError } from "./space";

let fx: ConnectorFixture | null = null;
const ids = { flyers: "", pizza: "", clubCard: "", deleted: "", bobs: "" };

beforeAll(async () => {
  fx = await setUpConnectorFixture("tool-finance");
  if (!fx) return;
  const { alice, bob, club, tag } = fx;
  const period = await ownerDb.budgetPeriod.create({
    data: {
      organizationId: club.id,
      label: `FY ${tag}`,
      startsOn: new Date("2026-07-01"),
      endsOn: new Date("2027-06-30"),
    },
    select: { id: true },
  });
  const expense = async (
    submittedById: string,
    description: string,
    data: Record<string, unknown> = {},
  ) =>
    (
      await ownerDb.transaction.create({
        data: {
          organizationId: club.id,
          budgetPeriodId: period.id,
          direction: "OUT",
          kind: "EXPENSE",
          status: "SUBMITTED",
          amountCents: 2_500,
          description,
          occurredAt: new Date("2026-09-15T00:00:00Z"),
          submittedById,
          ...data,
        },
        select: { id: true },
      })
    ).id;
  ids.flyers = await expense(alice.id, `Flyers ${tag}`, { amountCents: 4_517 });
  ids.pizza = await expense(alice.id, `Pizza ${tag}`, {
    status: "REJECTED",
    rejectionReason: "No receipt",
    occurredAt: new Date("2026-09-20T00:00:00Z"),
  });
  ids.clubCard = await expense(alice.id, `Paid with the organization card ${tag}`, {
    status: "NOT_APPLICABLE",
  });
  ids.deleted = await expense(alice.id, `Entered twice ${tag}`, {
    voidedAt: new Date(),
    voidReason: DELETED_TRANSACTION_REASON,
  });
  ids.bobs = await expense(bob.id, `Bob's deposit ${tag}`);
});

afterAll(async () => {
  await fx?.cleanup();
  await disconnectAll();
  await disconnectOwnerDb();
});

describe("list_my_reimbursements", () => {
  it("lists only the member's own expense requests, newest first", async () => {
    if (!fx) return;
    const { alice, club } = fx;
    const res = await listMyReimbursements(await fx.session(alice), { space: club.id });
    expect(res.total).toBe(2);
    expect(res.reimbursements.map((r) => r.id)).toEqual([
      itemId("expense", club.id, ids.pizza),
      itemId("expense", club.id, ids.flyers),
    ]);
    expect(res.reimbursements[1]).toMatchObject({
      description: `Flyers ${fx.tag}`,
      amount: "$45.17",
      amountCents: 4_517,
      status: "submitted",
      day: "2026-09-15",
      receipts: 0,
      voided: false,
      url: `http://localhost:3000/app/${club.slug}/finance/my-reimbursements`,
    });
    expect(res.reimbursements[0]).toMatchObject({
      status: "rejected",
      rejectionReason: "No receipt",
    });

    const first = await listMyReimbursements(await fx.session(alice), { space: club.id, limit: 1 });
    expect(first.nextCursor).not.toBeNull();
  });

  it("opens the member's own expense through fetch, and not anyone else's", async () => {
    if (!fx) return;
    const { alice, club } = fx;
    const session = await fx.session(alice);
    const mine = await fetchItem(session, { id: itemId("expense", club.id, ids.flyers) });
    expect(mine).toMatchObject({
      title: `Flyers ${fx.tag}`,
      metadata: { kind: "expense", status: "submitted", amountCents: 4_517 },
    });
    expect(mine.text).toContain("$45.17");
    await expect(
      fetchItem(session, { id: itemId("expense", club.id, ids.bobs) }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuses Personal, another org, the switch, another scope and hidden Finance", async () => {
    if (!fx) return;
    const { alice, bob, club, other, pausedId, personalId } = fx;
    const session = await fx.session(alice);
    await expect(listMyReimbursements(session, { space: personalId })).rejects.toBeInstanceOf(
      SpaceRefusedError,
    );
    // A trial that has ended is on Team Free, which has no Finance.
    await expect(listMyReimbursements(session, { space: pausedId })).rejects.toBeInstanceOf(
      SpaceRefusedError,
    );
    await expect(listMyReimbursements(session, { space: other.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await fx.switchedOff(club.id, () =>
      expect(listMyReimbursements(session, { space: club.id })).rejects.toBeInstanceOf(
        ConnectorRefusedError,
      ),
    );
    await expect(
      listMyReimbursements(await fx.session(alice, { organizationId: pausedId }), {
        space: club.id,
      }),
    ).rejects.toMatchObject({ reason: "scope" });
    await fx.hiding(club.id, ["finance"], async () => {
      await expect(listMyReimbursements(session, { space: club.id })).rejects.toBeInstanceOf(
        SectionHiddenError,
      );
      expect((await listMyReimbursements(await fx!.session(bob), { space: club.id })).total).toBe(
        1,
      );
    });
  });
});

describe("through the MCP server", () => {
  it("returns list_my_reimbursements and an expense's fetch within their output schemas", async () => {
    if (!fx) return;
    const session = await fx.session(fx.alice);
    const args = { space: fx.club.id };
    expect(await fx.call(session, "list_my_reimbursements", args)).toEqual(
      asJson(await listMyReimbursements(session, args)),
    );
    const id = itemId("expense", fx.club.id, ids.pizza);
    expect(await fx.call(session, "fetch", { id })).toEqual(
      asJson(await fetchItem(session, { id })),
    );
  });
});
