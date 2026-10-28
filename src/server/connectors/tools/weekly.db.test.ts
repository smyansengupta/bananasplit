// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * get_weekly_summary against the real roles and policies
 * (src/test/connector-fixture.ts): the member's own week with their
 * private work marked, someone else's week without their private work,
 * and the denials every tool has.
 */

vi.mock("@/lib/auth/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));

import { NotFoundError } from "@/lib/auth/errors";
import { updateWeekStartKey } from "@/lib/tasks/dates";
import { disconnectAll } from "@/server/db/clients";
import { ConnectorRefusedError, SpaceRefusedError } from "@/server/db/context";
import { asJson, setUpConnectorFixture, type ConnectorFixture } from "@/test/connector-fixture";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";

import { itemId } from "./ids";
import { SectionHiddenError } from "./space";
import { getWeeklySummaryTool } from "./weekly";

const now = new Date();
let fx: ConnectorFixture | null = null;
const ids = { done: "", doing: "", stuck: "", mine: "", bobs: "", bobsSecret: "" };

beforeAll(async () => {
  fx = await setUpConnectorFixture("tool-weekly");
  if (!fx) return;
  const { alice, bob, club, tag } = fx;
  const task = async (data: Record<string, unknown> & { title: string }) =>
    (
      await ownerDb.task.create({
        data: { organizationId: club.id, rank: "a0", createdById: bob.id, ...data },
        select: { id: true },
      })
    ).id;
  ids.done = await task({
    title: `Wired the arm ${tag}`,
    ownerId: alice.id,
    status: "COMPLETED",
    completedAt: now,
  });
  ids.doing = await task({
    title: `Tune the PID ${tag}`,
    ownerId: alice.id,
    status: "IN_PROGRESS",
  });
  ids.stuck = await task({
    title: `Order motors ${tag}`,
    ownerId: alice.id,
    status: "BLOCKED",
    blockedReason: "Waiting on the budget",
  });
  ids.mine = await task({
    title: `My private prep ${tag}`,
    ownerId: alice.id,
    createdById: alice.id,
    status: "IN_PROGRESS",
    visibility: "PRIVATE",
  });
  ids.bobs = await task({
    title: `Bob's open work ${tag}`,
    ownerId: bob.id,
    status: "IN_PROGRESS",
  });
  ids.bobsSecret = await task({
    title: `Bob's secret work ${tag}`,
    ownerId: bob.id,
    status: "IN_PROGRESS",
    visibility: "PRIVATE",
  });
});

afterAll(async () => {
  await fx?.cleanup();
  await disconnectAll();
  await disconnectOwnerDb();
});

describe("get_weekly_summary", () => {
  it("drafts the member's own week, done, next and blocked, with their private work marked", async () => {
    if (!fx) return;
    const { alice, club } = fx;
    const week = await getWeeklySummaryTool(await fx.session(alice), { space: club.id }, now);
    expect(week).toMatchObject({
      member: { id: itemId("person", club.id, alice.id), name: alice.name },
      weekStart: updateWeekStartKey(now, "UTC", 0),
      updateDay: "Sunday",
    });
    expect(week.done.map((t) => t.title)).toEqual([`Wired the arm ${fx.tag}`]);
    expect(week.next.map((t) => t.title).sort()).toEqual(
      [`My private prep ${fx.tag}`, `Tune the PID ${fx.tag}`].sort(),
    );
    expect(week.next.find((t) => t.id === itemId("task", club.id, ids.mine))?.private).toBe(true);
    expect(week.blocked).toEqual([
      expect.objectContaining({
        id: itemId("task", club.id, ids.stuck),
        blockedReason: "Waiting on the budget",
        role: "owner",
      }),
    ]);
  });

  it("reads someone else's week without their private work, and clamps a week not begun", async () => {
    if (!fx) return;
    const { alice, bob, club } = fx;
    const session = await fx.session(alice);
    const bobs = await getWeeklySummaryTool(
      session,
      { space: club.id, member: itemId("person", club.id, bob.id) },
      now,
    );
    expect(bobs.next.map((t) => t.title)).toEqual([`Bob's open work ${fx.tag}`]);
    const later = await getWeeklySummaryTool(session, { space: club.id, week: "2099-01-05" }, now);
    expect(later.weekStart).toBe(updateWeekStartKey(now, "UTC", 0));
    const earlier = await getWeeklySummaryTool(
      session,
      { space: club.id, week: "2026-01-07" },
      now,
    );
    expect(earlier).toMatchObject({ weekStart: "2026-01-05", weekEnd: "2026-01-11", done: [] });
  });

  it("refuses someone who isn't a member, Personal, another org, the switch, another scope and hidden Tasks", async () => {
    if (!fx) return;
    const { alice, bob, club, other, personalId } = fx;
    const session = await fx.session(alice);
    const outsider = await fx.user("tool-weekly-dan", "Dan Outsider");
    await expect(
      getWeeklySummaryTool(session, {
        space: club.id,
        member: itemId("person", club.id, outsider.id),
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      getWeeklySummaryTool(session, { space: club.id, member: "somebody" }),
    ).rejects.toMatchObject({ name: "ConnectorInputError" });
    // Weekly updates are teamwork: a club feature.
    await expect(getWeeklySummaryTool(session, { space: personalId })).rejects.toBeInstanceOf(
      SpaceRefusedError,
    );
    await expect(getWeeklySummaryTool(session, { space: other.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await fx.switchedOff(club.id, () =>
      expect(getWeeklySummaryTool(session, { space: club.id })).rejects.toBeInstanceOf(
        ConnectorRefusedError,
      ),
    );
    await expect(
      getWeeklySummaryTool(await fx.session(alice, { organizationId: personalId }), {
        space: club.id,
      }),
    ).rejects.toMatchObject({ reason: "scope" });
    await fx.hiding(club.id, ["tasks"], async () => {
      await expect(getWeeklySummaryTool(session, { space: club.id })).rejects.toBeInstanceOf(
        SectionHiddenError,
      );
      expect(
        (await getWeeklySummaryTool(await fx!.session(bob), { space: club.id }, now)).next,
      ).toHaveLength(2);
    });
  });

  it("reads a paused club's week", async () => {
    if (!fx) return;
    const week = await getWeeklySummaryTool(
      await fx.session(fx.alice),
      { space: fx.pausedId },
      now,
    );
    expect(week).toMatchObject({ done: [], next: [], blocked: [] });
  });
});

describe("through the MCP server", () => {
  it("returns get_weekly_summary within its output schema", async () => {
    if (!fx) return;
    const session = await fx.session(fx.alice);
    const args = { space: fx.club.id };
    expect(await fx.call(session, "get_weekly_summary", args)).toEqual(
      asJson(await getWeeklySummaryTool(session, args)),
    );
  });
});
