// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The write wrapper (tools/write.ts) against the real roles and policies
 * (src/test/connector-fixture.ts), for all nine write tools: what refuses
 * a write before it runs (a read-only grant, a paused club, a club the
 * member isn't in, a grant scoped elsewhere, the club switch, a section
 * hidden from members, the rate limit), that a refused write leaves
 * nothing behind, and the audit row a write leaves.
 */

vi.mock("@/lib/auth/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));

import { NotFoundError } from "@/lib/auth/errors";
import type { SectionId } from "@/lib/nav/sidebar";
import { checkRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { disconnectAll } from "@/server/db/clients";
import { ConnectorRefusedError, SpaceRefusedError } from "@/server/db/context";
import { setUpConnectorFixture, type ConnectorFixture } from "@/test/connector-fixture";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";

import { addDatabaseRecordTool, updateDatabaseRecordTool } from "./database-writes";
import { rsvpToEventTool } from "./event-writes";
import { itemId } from "./ids";
import { createNoteTool } from "./note-writes";
import { voteInPollTool } from "./poll-writes";
import type { ConnectorSession } from "./shared";
import { SectionHiddenError } from "./space";
import { addTaskCommentTool, createTaskTool, updateTaskTool } from "./task-writes";
import { postWeeklyUpdateTool } from "./weekly-writes";
import { ReadOnlyGrantError, WRITE_LIMIT, WriteLimitError } from "./write";

let fx: ConnectorFixture | null = null;
const ids = { task: "", event: "", database: "", row: "", poll: "" };

interface WriteCase {
  tool: string;
  section: SectionId;
  /** Arguments that would write in `spaceId` (its ids are the club's, forged into others). */
  args(spaceId: string): Record<string, unknown>;
  run(session: ConnectorSession, args: Record<string, unknown>): Promise<unknown>;
}

const CASES: WriteCase[] = [
  {
    tool: "create_task",
    section: "tasks",
    args: (space) => ({ space, title: `Refused task ${fx!.tag}` }),
    run: (s, a) => createTaskTool(s, a as never),
  },
  {
    tool: "update_task",
    section: "tasks",
    args: (space) => ({ id: itemId("task", space, ids.task), title: `Refused ${fx!.tag}` }),
    run: (s, a) => updateTaskTool(s, a as never),
  },
  {
    tool: "add_task_comment",
    section: "tasks",
    args: (space) => ({ id: itemId("task", space, ids.task), body: "Refused comment" }),
    run: (s, a) => addTaskCommentTool(s, a as never),
  },
  {
    tool: "rsvp_to_event",
    section: "calendar",
    args: (space) => ({ id: itemId("event", space, ids.event), rsvp: "not_going" }),
    run: (s, a) => rsvpToEventTool(s, a as never),
  },
  {
    tool: "add_database_record",
    section: "databases",
    args: (space) => ({ id: itemId("database", space, ids.database), values: { Item: "Refused" } }),
    run: (s, a) => addDatabaseRecordTool(s, a as never),
  },
  {
    tool: "update_database_record",
    section: "databases",
    args: (space) => ({
      id: itemId("database", space, ids.database),
      row: ids.row,
      values: { Item: "Refused" },
    }),
    run: (s, a) => updateDatabaseRecordTool(s, a as never),
  },
  {
    tool: "post_weekly_update",
    section: "tasks",
    args: (space) => ({ space, note: "Refused" }),
    run: (s, a) => postWeeklyUpdateTool(s, a as never),
  },
  {
    tool: "vote_in_poll",
    section: "polls",
    args: (space) => ({ id: itemId("poll", space, ids.poll), choices: ["Saturday"] }),
    run: (s, a) => voteInPollTool(s, a as never),
  },
  {
    tool: "create_note",
    section: "notes",
    args: (space) => ({ space, title: `Refused note ${fx!.tag}`, markdown: "Nope" }),
    run: (s, a) => createNoteTool(s, a as never),
  },
];

/** Connector audit rows in the fixture's spaces. */
async function connectorAudits(): Promise<number> {
  if (!fx) return 0;
  return ownerDb.orgAuditLog.count({
    where: {
      organizationId: { in: [fx.club.id, fx.other.id, fx.pausedId, fx.personalId] },
      action: { startsWith: "connector." },
    },
  });
}

/** What a refused write might have left: tasks, comments, notes, rows and votes it made. */
async function leftovers(): Promise<number> {
  if (!fx) return 0;
  const tag = fx.tag;
  const spaces = { in: [fx.club.id, fx.other.id, fx.pausedId, fx.personalId] };
  // One after another: the owner client has a small pool.
  const tasks = await ownerDb.task.count({
    where: { organizationId: spaces, title: { contains: "Refused" } },
  });
  const renamed = await ownerDb.task.count({
    where: { id: ids.task, title: { not: `Task ${tag}` } },
  });
  const comments = await ownerDb.taskComment.count({ where: { taskId: ids.task } });
  const notes = await ownerDb.note.count({
    where: { organizationId: spaces, title: `Refused note ${tag}` },
  });
  const rows = await ownerDb.databaseRecord.count({
    where: { organizationId: fx.club.id, NOT: { id: ids.row } },
  });
  const votes = await ownerDb.pollVote.count({ where: { pollId: ids.poll } });
  const rsvp = await ownerDb.eventAttendee.count({ where: { eventId: ids.event, rsvp: "NO" } });
  const posts = await ownerDb.weeklyUpdate.count({ where: { organizationId: fx.club.id } });
  return tasks + renamed + comments + notes + rows + votes + rsvp + posts;
}

beforeAll(async () => {
  fx = await setUpConnectorFixture("tool-writes");
  if (!fx) return;
  const { alice, bob, club, tag } = fx;
  ids.task = (
    await ownerDb.task.create({
      data: {
        organizationId: club.id,
        title: `Task ${tag}`,
        rank: "a0",
        createdById: alice.id,
        ownerId: alice.id,
      },
      select: { id: true },
    })
  ).id;
  ids.event = (
    await ownerDb.event.create({
      data: {
        organizationId: club.id,
        title: `Social ${tag}`,
        startsAt: new Date(Date.now() + 86_400_000),
        endsAt: new Date(Date.now() + 90_000_000),
        createdById: bob.id,
      },
      select: { id: true },
    })
  ).id;
  await ownerDb.eventAttendee.create({
    data: { organizationId: club.id, eventId: ids.event, userId: alice.id },
  });
  ids.database = `gear-${tag}`;
  const database = await ownerDb.databaseDefinition.create({
    data: {
      organizationId: club.id,
      key: ids.database,
      name: `Gear ${tag}`,
      kind: "CUSTOM",
      memberCanEdit: true,
      createdById: bob.id,
    },
    select: { id: true },
  });
  const item = await ownerDb.databaseField.create({
    data: {
      organizationId: club.id,
      databaseId: database.id,
      name: "Item",
      type: "TEXT",
      isPrimary: true,
      sortOrder: 0,
    },
    select: { id: true },
  });
  ids.row = (
    await ownerDb.databaseRecord.create({
      data: {
        organizationId: club.id,
        databaseId: database.id,
        values: { [item.id]: "Soldering iron" },
        createdById: bob.id,
        updatedById: bob.id,
      },
      select: { id: true },
    })
  ).id;
  ids.poll = (
    await ownerDb.poll.create({
      data: {
        organizationId: club.id,
        question: `Which night ${tag}?`,
        createdById: bob.id,
        options: {
          create: [
            { label: "Friday", sortOrder: 0 },
            { label: "Saturday", sortOrder: 1 },
          ],
        },
      },
      select: { id: true },
    })
  ).id;
});

afterAll(async () => {
  await fx?.cleanup();
  await disconnectAll();
  await disconnectOwnerDb();
});

describe("the write wrapper", () => {
  it("refuses every write from a read-only grant", async () => {
    if (!fx) return;
    const session = await fx.session(fx.alice);
    for (const c of CASES) {
      await expect(c.run(session, c.args(fx.club.id)), c.tool).rejects.toBeInstanceOf(
        ReadOnlyGrantError,
      );
    }
  });

  it("refuses every write in a paused club, which still reads", async () => {
    if (!fx) return;
    const session = await fx.session(fx.alice, { access: "WRITE" });
    for (const c of CASES) {
      await expect(c.run(session, c.args(fx.pausedId)), c.tool).rejects.toMatchObject({
        name: "SpaceRefusedError",
        refusal: { refused: "paused" },
      });
    }
  });

  it("answers a club the member isn't in as not found", async () => {
    if (!fx) return;
    const session = await fx.session(fx.alice, { access: "WRITE" });
    for (const c of CASES) {
      await expect(c.run(session, c.args(fx.other.id)), c.tool).rejects.toBeInstanceOf(
        NotFoundError,
      );
    }
  });

  it("refuses a space outside the grant, and a club with AI apps switched off", async () => {
    if (!fx) return;
    const { alice, club, personalId } = fx;
    const scoped = await fx.session(alice, { access: "WRITE", organizationId: personalId });
    for (const c of CASES) {
      await expect(c.run(scoped, c.args(club.id)), c.tool).rejects.toMatchObject({
        name: "ConnectorRefusedError",
        reason: "scope",
      });
    }
    const session = await fx.session(alice, { access: "WRITE" });
    await fx.switchedOff(club.id, async () => {
      for (const c of CASES) {
        await expect(c.run(session, c.args(club.id)), c.tool).rejects.toBeInstanceOf(
          ConnectorRefusedError,
        );
      }
    });
  });

  it("refuses a section the club hid to members", async () => {
    if (!fx) return;
    const session = await fx.session(fx.alice, { access: "WRITE" });
    for (const c of CASES) {
      await fx.hiding(fx.club.id, [c.section], () =>
        expect(c.run(session, c.args(fx!.club.id)), c.tool).rejects.toBeInstanceOf(
          SectionHiddenError,
        ),
      );
    }
  });

  it("leaves nothing behind for a refused write: no change and no audit row", async () => {
    if (!fx) return;
    expect(await leftovers()).toBe(0);
    expect(await connectorAudits()).toBe(0);
  });

  it("lets owners and admins write in a hidden section, and audits the write with the app", async () => {
    if (!fx) return;
    const { bob, club } = fx;
    const session = await fx.session(bob, { access: "WRITE", clientName: "Claude" });
    const made = await fx.hiding(club.id, ["tasks"], () =>
      createTaskTool(session, { space: club.id, title: `Owner's task ${fx!.tag}` }),
    );
    const taskId = made.task.id.split(":")[2];
    const audit = await ownerDb.orgAuditLog.findMany({
      where: { organizationId: club.id, action: { startsWith: "connector." } },
      select: { action: true, actorId: true, targetType: true, targetId: true, diffJson: true },
    });
    expect(audit).toEqual([
      {
        action: "connector.create_task",
        actorId: bob.id,
        targetType: "Task",
        targetId: taskId,
        diffJson: { client: "Claude", clientId: session.connector.clientId },
      },
    ]);
  });

  it(`refuses past ${WRITE_LIMIT.limit} writes an hour per grant, and writes nothing`, async () => {
    if (!fx) return;
    const { alice, club, tag } = fx;
    const grantId = `grant_busy_${tag}`;
    // The real limiter's bucket, filled to its limit as earlier writes would.
    for (let i = 0; i < WRITE_LIMIT.limit; i++) {
      const hit = await checkRateLimit(
        rateLimitKey("connector.write", grantId),
        WRITE_LIMIT.limit,
        WRITE_LIMIT.windowSec,
      );
      expect(hit.allowed).toBe(true);
    }
    const busy = await fx.session(alice, { access: "WRITE", grantId });
    const before = await ownerDb.task.count({ where: { organizationId: club.id } });
    await expect(
      createTaskTool(busy, { space: club.id, title: `Busy task ${tag}` }),
    ).rejects.toBeInstanceOf(WriteLimitError);
    await expect(
      fx.call(busy, "create_task", { space: club.id, title: `Busy task ${tag}` }),
    ).rejects.toThrow(/too many changes/);
    expect(await ownerDb.task.count({ where: { organizationId: club.id } })).toBe(before);
    // Another grant has its own bucket.
    const other = await fx.session(alice, { access: "WRITE", grantId: `grant_calm_${tag}` });
    await expect(
      createTaskTool(other, { space: club.id, title: `Calm task ${tag}` }),
    ).resolves.toMatchObject({ task: { title: `Calm task ${tag}` } });
  });

  it("isn't listed to a read-only grant at all", async () => {
    if (!fx) return;
    const session = await fx.session(fx.alice);
    await expect(
      fx.call(session, "create_task", { space: fx.club.id, title: "Hidden" }),
    ).rejects.toThrow(/create_task/);
  });

  it("refuses a weekly update in Personal, which has no team", async () => {
    if (!fx) return;
    const session = await fx.session(fx.alice, { access: "WRITE" });
    await expect(postWeeklyUpdateTool(session, { space: fx.personalId })).rejects.toBeInstanceOf(
      SpaceRefusedError,
    );
  });
});
