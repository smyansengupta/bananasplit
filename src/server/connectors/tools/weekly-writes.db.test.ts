// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * post_weekly_update against the real roles and policies
 * (src/test/connector-fixture.ts): the member's own week as the updates
 * view posts it, private tasks left out, a re-post replacing the post, and
 * the audit row; a week that hasn't begun. The wrapper's own refusals
 * (Personal among them) are in write.db.test.ts.
 */

vi.mock("@/lib/auth/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));

import { addDaysToKey, localDateKey } from "@/lib/tasks/dates";
import { disconnectAll } from "@/server/db/clients";
import { asJson, setUpConnectorFixture, type ConnectorFixture } from "@/test/connector-fixture";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";

import { WriteRefusedError } from "./write";
import { postWeeklyUpdateTool } from "./weekly-writes";

let fx: ConnectorFixture | null = null;

beforeAll(async () => {
  fx = await setUpConnectorFixture("tool-weekly-writes");
  if (!fx) return;
  const { alice, club, tag } = fx;
  const task = (data: Record<string, unknown> & { title: string }) =>
    ownerDb.task.create({
      data: {
        organizationId: club.id,
        rank: "a0",
        createdById: alice.id,
        ownerId: alice.id,
        ...data,
      },
    });
  // One after another: the owner client has a small pool.
  await task({
    title: `Shipped the newsletter ${tag}`,
    status: "COMPLETED",
    completedAt: new Date(),
  });
  await task({ title: `Drafting the budget ${tag}`, status: "IN_PROGRESS" });
  await task({
    title: `Venue contract ${tag}`,
    status: "BLOCKED",
    blockedAt: new Date(),
    blockedReason: "Waiting on quotes",
  });
  await task({ title: `Surprise party ${tag}`, status: "IN_PROGRESS", visibility: "PRIVATE" });
});

afterAll(async () => {
  await fx?.cleanup();
  await disconnectAll();
  await disconnectOwnerDb();
});

describe("post_weekly_update", () => {
  it("posts the member's week without their private tasks, and audits it", async () => {
    if (!fx) return;
    const { alice, club, tag } = fx;
    const session = await fx.session(alice, { access: "WRITE" });
    const res = await postWeeklyUpdateTool(session, { space: club.id, note: "  Good week.  " });
    expect(res).toMatchObject({
      space: { id: club.id, name: `Robotics ${tag}` },
      done: [expect.stringContaining(`Shipped the newsletter ${tag}`)],
      next: [expect.stringContaining(`Drafting the budget ${tag}`)],
      blocked: [expect.stringContaining(`Venue contract ${tag}`)],
      note: "Good week.",
      url: `http://localhost:3000/app/${club.slug}/tasks?view=updates&week=${res.weekStart}`,
    });
    expect(res.weekEnd).toBe(addDaysToKey(res.weekStart, 6));
    expect(JSON.stringify(res)).not.toContain("Surprise party");
    // One after another: the owner client has a small pool.
    const posts = await ownerDb.weeklyUpdate.findMany({
      where: { organizationId: club.id },
      select: { id: true, userId: true, note: true },
    });
    expect(posts).toEqual([{ id: posts[0]!.id, userId: alice.id, note: "Good week." }]);
    expect(
      await ownerDb.orgAuditLog.findFirst({
        where: { organizationId: club.id, action: "connector.post_weekly_update" },
        select: { actorId: true, targetType: true, targetId: true },
      }),
    ).toEqual({ actorId: alice.id, targetType: "WeeklyUpdate", targetId: posts[0]!.id });
  });

  it("replaces the week's post when it's posted again, and takes any day of the week", async () => {
    if (!fx) return;
    const { alice, club } = fx;
    const session = await fx.session(alice, { access: "WRITE" });
    const today = localDateKey(new Date(), "UTC");
    const again = await postWeeklyUpdateTool(session, { space: club.id, week: today });
    expect(again.note).toBeNull();
    expect(
      await ownerDb.weeklyUpdate.findMany({
        where: { organizationId: club.id },
        select: { note: true },
      }),
    ).toEqual([{ note: null }]);
  });

  it("refuses a week that hasn't begun, and posts nothing for it", async () => {
    if (!fx) return;
    const { alice, club } = fx;
    const session = await fx.session(alice, { access: "WRITE" });
    const later = addDaysToKey(localDateKey(new Date(), "UTC"), 14);
    await expect(postWeeklyUpdateTool(session, { space: club.id, week: later })).rejects.toEqual(
      new WriteRefusedError("You can't post an update for a future week."),
    );
    expect(await ownerDb.weeklyUpdate.count({ where: { organizationId: club.id } })).toBe(1);
  });

  it("returns its result within its output schema through the MCP server", async () => {
    if (!fx) return;
    const session = await fx.session(fx.alice, { access: "WRITE" });
    const now = new Date();
    const wire = await fx.call(session, "post_weekly_update", { space: fx.club.id, note: "Hi" });
    const direct = asJson(
      await postWeeklyUpdateTool(session, { space: fx.club.id, note: "Hi" }, now),
    ) as Record<string, unknown>;
    expect({ ...wire, postedAt: null }).toEqual({ ...direct, postedAt: null });
  });
});
