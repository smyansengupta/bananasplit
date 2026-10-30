// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * create_task, update_task and add_task_comment against the real roles and
 * policies (src/test/connector-fixture.ts): the app's task service as the
 * member, with its rules, notifications and activity, and the audit row;
 * a task the member may not edit, a private one they aren't on, an
 * above-level assignment that waits for the member, and the club's rules.
 * The wrapper's own refusals are in write.db.test.ts.
 */

vi.mock("@/lib/auth/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));

import { NotFoundError } from "@/lib/auth/errors";
import { disconnectAll } from "@/server/db/clients";
import { asJson, setUpConnectorFixture, type ConnectorFixture } from "@/test/connector-fixture";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";

import { itemId } from "./ids";
import { addTaskCommentTool, createTaskTool, updateTaskTool } from "./task-writes";
import { WriteRefusedError } from "./write";

let fx: ConnectorFixture | null = null;
const ids = { mine: "", bobs: "", secret: "" };

/** The raw id inside a tool's task id. */
const rawId = (id: string) => id.split(":")[2]!;

beforeAll(async () => {
  fx = await setUpConnectorFixture("tool-task-writes");
  if (!fx) return;
  const { alice, bob, club, tag } = fx;
  const task = async (data: Record<string, unknown> & { title: string }) =>
    (
      await ownerDb.task.create({
        data: { organizationId: club.id, rank: "a0", createdById: bob.id, ...data },
        select: { id: true },
      })
    ).id;
  ids.mine = await task({ title: `Order shirts ${tag}`, createdById: alice.id, ownerId: alice.id });
  ids.bobs = await task({ title: `Book the venue ${tag}`, ownerId: bob.id });
  ids.secret = await task({ title: `Budget ${tag}`, ownerId: bob.id, visibility: "PRIVATE" });
});

afterAll(async () => {
  if (fx) {
    await ownerDb.organization.update({
      where: { id: fx.club.id },
      data: { activeOrgChartVersionId: null },
    });
  }
  await fx?.cleanup();
  await disconnectAll();
  await disconnectOwnerDb();
});

describe("create_task", () => {
  it("creates a task as the member, notifies its owner, and audits it", async () => {
    if (!fx) return;
    const { alice, bob, club, tag } = fx;
    const session = await fx.session(alice, { access: "WRITE", clientName: "Claude" });
    const res = await createTaskTool(session, {
      space: club.id,
      title: `Print flyers ${tag}`,
      description: "Two hundred, **double-sided**.",
      owner: itemId("person", club.id, bob.id),
      due: "2026-11-20",
      priority: "high",
      status: "in_progress",
    });
    const id = rawId(res.task.id);
    expect(res).toEqual({
      space: { id: club.id, name: `Robotics ${tag}` },
      task: {
        id: itemId("task", club.id, id),
        title: `Print flyers ${tag}`,
        type: "task",
        status: "in_progress",
        priority: "high",
        due: "2026-11-20",
        owner: { id: itemId("person", club.id, bob.id), name: bob.name },
        private: false,
        partOf: null,
        tags: [],
        url: `http://localhost:3000/app/${club.slug}/tasks/${id}`,
      },
    });
    // One after another: the owner client has a small pool.
    const row = await ownerDb.task.findUniqueOrThrow({
      where: { id },
      select: { createdById: true, ownerId: true, description: true },
    });
    expect(row).toEqual({
      createdById: alice.id,
      ownerId: bob.id,
      description: "Two hundred, **double-sided**.",
    });
    const notices = await ownerDb.notification.findMany({
      where: { taskId: id },
      select: { userId: true, type: true, actorId: true },
    });
    expect(notices).toEqual([{ userId: bob.id, type: "TASK_ASSIGNED", actorId: alice.id }]);
    const activity = await ownerDb.taskActivity.findMany({
      where: { taskId: id },
      select: { type: true, actorId: true },
    });
    expect(activity).toContainEqual({ type: "CREATED", actorId: alice.id });
    expect(
      await ownerDb.orgAuditLog.findMany({
        where: { organizationId: club.id, targetId: id },
        select: { action: true, actorId: true, targetType: true, diffJson: true },
      }),
    ).toEqual([
      {
        action: "connector.create_task",
        actorId: alice.id,
        targetType: "Task",
        diffJson: { client: "Claude", clientId: session.connector.clientId },
      },
    ]);
  });

  it('takes "me" as the owner, and the defaults the dialog has', async () => {
    if (!fx) return;
    const { alice, club, tag } = fx;
    const session = await fx.session(alice, { access: "WRITE" });
    const res = await createTaskTool(session, {
      space: club.id,
      title: `Sweep up ${tag}`,
      owner: "me",
    });
    expect(res.task).toMatchObject({
      status: "not_started",
      priority: "medium",
      due: null,
      owner: { id: itemId("person", club.id, alice.id) },
    });
  });

  it("refuses what the app refuses, in its words, and saves nothing", async () => {
    if (!fx) return;
    const { alice, club, other, bob, tag } = fx;
    const session = await fx.session(alice, { access: "WRITE" });
    const before = await ownerDb.task.count({ where: { organizationId: club.id } });
    await expect(
      createTaskTool(session, { space: club.id, title: `Stuck ${tag}`, status: "blocked" }),
    ).rejects.toBeInstanceOf(WriteRefusedError);
    await expect(
      createTaskTool(session, {
        space: club.id,
        title: `Elsewhere ${tag}`,
        owner: itemId("person", other.id, bob.id),
      }),
    ).rejects.toMatchObject({ name: "ConnectorInputError" });
    await ownerDb.orgSettings.update({
      where: { organizationId: club.id },
      data: { taskRequireDueDate: true },
    });
    try {
      await expect(
        createTaskTool(session, { space: club.id, title: `No date ${tag}` }),
      ).rejects.toThrow("Every task needs a due date.");
    } finally {
      await ownerDb.orgSettings.update({
        where: { organizationId: club.id },
        data: { taskRequireDueDate: false },
      });
    }
    expect(await ownerDb.task.count({ where: { organizationId: club.id } })).toBe(before);
  });

  it("asks before assigning someone above the member in the org chart", async () => {
    if (!fx) return;
    const { alice, bob, club, tag } = fx;
    const version = await ownerDb.orgChartVersion.create({
      data: {
        organizationId: club.id,
        number: 1,
        status: "PUBLISHED",
        source: "MANUAL",
        createdById: bob.id,
        publishedAt: new Date(),
      },
      select: { id: true },
    });
    const president = await ownerDb.orgChartPosition.create({
      data: {
        organizationId: club.id,
        versionId: version.id,
        key: "president",
        title: "President",
        userId: bob.id,
        rank: "a0",
      },
      select: { id: true },
    });
    await ownerDb.orgChartPosition.create({
      data: {
        organizationId: club.id,
        versionId: version.id,
        key: "secretary",
        title: "Secretary",
        userId: alice.id,
        reportsToId: president.id,
        rank: "a1",
      },
    });
    await ownerDb.organization.update({
      where: { id: club.id },
      data: { activeOrgChartVersionId: version.id },
    });
    const session = await fx.session(alice, { access: "WRITE" });
    const args = {
      space: club.id,
      title: `Sign the forms ${tag}`,
      owner: itemId("person", club.id, bob.id),
    };
    await expect(createTaskTool(session, args)).rejects.toThrow(
      /above the member's place in the club's org chart.*Nothing was saved.*confirmAboveLevel/,
    );
    expect(await ownerDb.task.count({ where: { title: `Sign the forms ${tag}` } })).toBe(0);
    const confirmed = await createTaskTool(session, { ...args, confirmAboveLevel: true });
    const notices = await ownerDb.notification.findMany({
      where: { taskId: rawId(confirmed.task.id) },
      select: { userId: true, type: true },
    });
    expect(notices).toEqual([{ userId: bob.id, type: "TASK_FLAGGED" }]);
    await ownerDb.organization.update({
      where: { id: club.id },
      data: { activeOrgChartVersionId: null },
    });
  });
});

describe("update_task", () => {
  it("changes only the fields given, records the change, and audits it", async () => {
    if (!fx) return;
    const { alice, club, tag } = fx;
    const session = await fx.session(alice, { access: "WRITE" });
    const id = itemId("task", club.id, ids.mine);
    const res = await updateTaskTool(session, { id, status: "done", due: "2026-12-01" });
    expect(res.task).toMatchObject({
      id,
      title: `Order shirts ${tag}`,
      status: "done",
      due: "2026-12-01",
      owner: { id: itemId("person", club.id, alice.id) },
    });
    const activity = await ownerDb.taskActivity.findMany({
      where: { taskId: ids.mine },
      select: { type: true },
    });
    expect(activity.map((a) => a.type).sort()).toEqual(["DUE_CHANGED", "STATUS_CHANGED"]);
    const cleared = await updateTaskTool(session, { id, due: null, description: null });
    expect(cleared.task.due).toBeNull();
    expect(
      await ownerDb.orgAuditLog.count({
        where: { organizationId: club.id, action: "connector.update_task", targetId: ids.mine },
      }),
    ).toBe(2);
  });

  it("hands a task to a new owner, who is notified", async () => {
    if (!fx) return;
    const { alice, bob, club } = fx;
    const session = await fx.session(alice, { access: "WRITE" });
    const id = itemId("task", club.id, ids.mine);
    const res = await updateTaskTool(session, { id, owner: itemId("person", club.id, bob.id) });
    expect(res.task.owner).toEqual({ id: itemId("person", club.id, bob.id), name: bob.name });
    expect(
      await ownerDb.notification.findMany({
        where: { taskId: ids.mine },
        select: { userId: true, type: true },
      }),
    ).toEqual([{ userId: bob.id, type: "TASK_ASSIGNED" }]);
  });

  it("refuses a task the member may not edit, and answers a private one as not found", async () => {
    if (!fx) return;
    const { alice, bob, club, tag } = fx;
    const session = await fx.session(alice, { access: "WRITE" });
    await expect(
      updateTaskTool(session, { id: itemId("task", club.id, ids.bobs), title: `Mine now ${tag}` }),
    ).rejects.toBeInstanceOf(WriteRefusedError);
    await expect(
      updateTaskTool(session, { id: itemId("task", club.id, ids.secret), title: "Peek" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      updateTaskTool(session, { id: itemId("task", club.id, ids.bobs) }),
    ).rejects.toMatchObject({ name: "ConnectorInputError" });
    // The club's owner may edit any task.
    const owners = await fx.session(bob, { access: "WRITE" });
    await expect(
      updateTaskTool(owners, { id: itemId("task", club.id, ids.secret), priority: "low" }),
    ).resolves.toMatchObject({ task: { priority: "low", private: true } });
    const untouched = await ownerDb.task.findUniqueOrThrow({
      where: { id: ids.bobs },
      select: { title: true },
    });
    expect(untouched.title).toBe(`Book the venue ${tag}`);
  });
});

describe("add_task_comment", () => {
  it("comments as the member, notifies the owner, and audits the comment", async () => {
    if (!fx) return;
    const { alice, bob, club, tag } = fx;
    const session = await fx.session(alice, { access: "WRITE" });
    const res = await addTaskCommentTool(session, {
      id: itemId("task", club.id, ids.bobs),
      body: "  The hotel called back.  ",
    });
    expect(res).toMatchObject({
      task: { id: itemId("task", club.id, ids.bobs), title: `Book the venue ${tag}` },
      comment: {
        author: { id: itemId("person", club.id, alice.id), name: alice.name },
        body: "The hotel called back.",
      },
    });
    const comment = await ownerDb.taskComment.findFirstOrThrow({
      where: { taskId: ids.bobs },
      select: { id: true, authorId: true },
    });
    expect(comment.authorId).toBe(alice.id);
    expect(
      await ownerDb.notification.findMany({
        where: { taskId: ids.bobs },
        select: { userId: true, type: true },
      }),
    ).toEqual([{ userId: bob.id, type: "TASK_COMMENTED" }]);
    expect(
      await ownerDb.orgAuditLog.findFirst({
        where: { organizationId: club.id, action: "connector.add_task_comment" },
        select: { targetType: true, targetId: true },
      }),
    ).toEqual({ targetType: "TaskComment", targetId: comment.id });
  });

  it("answers a private task the member isn't on as not found", async () => {
    if (!fx) return;
    const session = await fx.session(fx.alice, { access: "WRITE" });
    await expect(
      addTaskCommentTool(session, { id: itemId("task", fx.club.id, ids.secret), body: "Hi" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await ownerDb.taskComment.count({ where: { taskId: ids.secret } })).toBe(0);
  });
});

describe("through the MCP server", () => {
  it("returns the task tools' results within their output schemas", async () => {
    if (!fx) return;
    const { alice, club, tag } = fx;
    const session = await fx.session(alice, { access: "WRITE" });
    const made = await fx.call(session, "create_task", {
      space: club.id,
      title: `Over the wire ${tag}`,
      owner: "me",
    });
    expect(made).toMatchObject({ task: { title: `Over the wire ${tag}`, status: "not_started" } });
    const id = (made.task as { id: string }).id;
    expect(await fx.call(session, "update_task", { id, priority: "low" })).toEqual(
      asJson(await updateTaskTool(session, { id, priority: "low" })),
    );
    expect(await fx.call(session, "add_task_comment", { id, body: "Done soon." })).toMatchObject({
      comment: { body: "Done soon." },
    });
    await expect(
      fx.call(session, "update_task", { id: itemId("task", club.id, ids.bobs), title: "No" }),
    ).rejects.toThrow(/permission|can't|only/i);
  });
});
