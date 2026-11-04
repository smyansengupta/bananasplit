// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

/**
 * list_tasks and get_task against the real roles and policies
 * (src/test/connector-fixture.ts): what a member reads of a club's tasks,
 * and the denials: a private task they aren't on, another org's task, a
 * forged id, the club switch, a grant scoped elsewhere, Tasks hidden.
 */

vi.mock("@/lib/auth/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));

import { NotFoundError } from "@/lib/auth/errors";
import { NOT_FOUND_MESSAGE } from "@/server/connectors/errors";
import { disconnectAll } from "@/server/db/clients";
import { ConnectorRefusedError } from "@/server/db/context";
import { asJson, setUpConnectorFixture, type ConnectorFixture } from "@/test/connector-fixture";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";

import { itemId } from "./ids";
import { SectionHiddenError } from "./space";
import { getTask, listTasks } from "./tasks";

let fx: ConnectorFixture | null = null;
const ids = { venue: "", flyers: "", secret: "", done: "", chess: "", paused: "" };

beforeAll(async () => {
  fx = await setUpConnectorFixture("tool-tasks");
  if (!fx) return;
  const { alice, bob, club, other, pausedId, tag } = fx;
  const task = async (organizationId: string, data: Record<string, unknown> & { title: string }) =>
    (
      await ownerDb.task.create({
        data: { organizationId, rank: "a0", createdById: bob.id, ...data },
        select: { id: true },
      })
    ).id;
  ids.venue = await task(club.id, {
    title: `Book the venue ${tag}`,
    description: "Call the hotel about catering.",
    ownerId: bob.id,
    dueDate: new Date("2026-11-01T00:00:00Z"),
    priority: "HIGH",
  });
  ids.flyers = await task(club.id, {
    title: `Print flyers ${tag}`,
    ownerId: alice.id,
    dueDate: new Date("2026-11-20T00:00:00Z"),
  });
  ids.secret = await task(club.id, {
    title: `Budget secrets ${tag}`,
    visibility: "PRIVATE",
    ownerId: bob.id,
  });
  ids.done = await task(club.id, {
    title: `Old checklist ${tag}`,
    status: "COMPLETED",
    completedAt: new Date(),
    ownerId: bob.id,
  });
  ids.chess = await task(other.id, { title: `Chess task ${tag}`, ownerId: bob.id });
  ids.paused = await task(pausedId, {
    title: `Paused task ${tag}`,
    createdById: alice.id,
    ownerId: alice.id,
  });
  await ownerDb.taskComment.create({
    data: {
      organizationId: club.id,
      taskId: ids.venue,
      authorId: bob.id,
      body: "Venue confirmed?",
    },
  });
  await ownerDb.taskComment.create({
    data: { organizationId: club.id, taskId: ids.secret, authorId: bob.id, body: "Keep it quiet" },
  });
});

afterAll(async () => {
  await fx?.cleanup();
  await disconnectAll();
  await disconnectOwnerDb();
});

describe("list_tasks", () => {
  it("lists open tasks soonest due first, names beside ids, and no private task the member isn't on", async () => {
    if (!fx) return;
    const { alice, bob, club } = fx;
    const res = await listTasks(await fx.session(alice), { space: club.id });
    expect(res.space).toEqual({ id: club.id, name: `Robotics ${fx.tag}` });
    expect(res.tasks.map((t) => t.id)).toEqual([
      itemId("task", club.id, ids.venue),
      itemId("task", club.id, ids.flyers),
    ]);
    expect(res.total).toBe(2);
    expect(res.tasks[0]).toEqual({
      id: itemId("task", club.id, ids.venue),
      title: `Book the venue ${fx.tag}`,
      type: "task",
      status: "not_started",
      priority: "high",
      due: "2026-11-01",
      owner: { id: itemId("person", club.id, bob.id), name: bob.name },
      private: false,
      partOf: null,
      tags: [],
      url: `http://localhost:3000/app/${club.slug}/tasks/${ids.venue}`,
    });

    const any = await listTasks(await fx.session(alice), { space: club.id, status: "any" });
    expect(any.tasks.map((t) => t.id)).toContain(itemId("task", club.id, ids.done));
    expect(any.tasks.map((t) => t.id)).not.toContain(itemId("task", club.id, ids.secret));

    // The club's owner sees the private task, marked as such.
    const owners = await listTasks(await fx.session(bob), { space: club.id });
    expect(owners.tasks.find((t) => t.id === itemId("task", club.id, ids.secret))).toMatchObject({
      private: true,
    });
  });

  it("filters by assignee, due day and words, and pages with a cursor that belongs to its list", async () => {
    if (!fx) return;
    const { alice, bob, club, other } = fx;
    const session = await fx.session(alice);
    const titles = async (args: Parameters<typeof listTasks>[1]) =>
      (await listTasks(session, args)).tasks.map((t) => t.title);

    expect(await titles({ space: club.id, assignee: "me" })).toEqual([`Print flyers ${fx.tag}`]);
    expect(await titles({ space: club.id, assignee: itemId("person", club.id, bob.id) })).toEqual([
      `Book the venue ${fx.tag}`,
    ]);
    expect(await titles({ space: club.id, dueBefore: "2026-11-01" })).toEqual([
      `Book the venue ${fx.tag}`,
    ]);
    expect(await titles({ space: club.id, query: `catering ${fx.tag}` })).toEqual([
      `Book the venue ${fx.tag}`,
    ]);
    // A member id from another space isn't an assignee here.
    await expect(
      listTasks(session, { space: club.id, assignee: itemId("person", other.id, bob.id) }),
    ).rejects.toMatchObject({ name: "ConnectorInputError" });

    const first = await listTasks(session, { space: club.id, limit: 1 });
    expect(first.tasks).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    const second = await listTasks(session, {
      space: club.id,
      limit: 1,
      cursor: first.nextCursor!,
    });
    expect(second.tasks.map((t) => t.title)).toEqual([`Print flyers ${fx.tag}`]);
    expect(second.nextCursor).toBeNull();
    await expect(
      listTasks(session, { space: club.id, status: "done", cursor: first.nextCursor! }),
    ).rejects.toMatchObject({ name: "CursorError" });
  });

  it("reads a paused organization's tasks", async () => {
    if (!fx) return;
    const res = await listTasks(await fx.session(fx.alice), { space: fx.pausedId });
    expect(res.tasks.map((t) => t.title)).toEqual([`Paused task ${fx.tag}`]);
  });

  it("answers another org as not found, and refuses the organization switch, another scope and hidden Tasks", async () => {
    if (!fx) return;
    const { alice, bob, club, other, personalId } = fx;
    const session = await fx.session(alice);
    await expect(listTasks(session, { space: other.id })).rejects.toBeInstanceOf(NotFoundError);
    await fx.switchedOff(club.id, () =>
      expect(listTasks(session, { space: club.id })).rejects.toBeInstanceOf(ConnectorRefusedError),
    );
    await expect(
      listTasks(await fx.session(alice, { organizationId: personalId }), { space: club.id }),
    ).rejects.toMatchObject({ name: "ConnectorRefusedError", reason: "scope" });
    await fx.hiding(club.id, ["tasks"], async () => {
      await expect(listTasks(session, { space: club.id })).rejects.toBeInstanceOf(
        SectionHiddenError,
      );
      // Owners and admins still read a section the club hid.
      expect((await listTasks(await fx!.session(bob), { space: club.id })).total).toBe(3);
    });
  });
});

describe("get_task", () => {
  it("gets a task with its owner, comments and link", async () => {
    if (!fx) return;
    const { alice, bob, club } = fx;
    const task = await getTask(await fx.session(alice), { id: itemId("task", club.id, ids.venue) });
    expect(task).toMatchObject({
      title: `Book the venue ${fx.tag}`,
      description: "Call the hotel about catering.",
      space: { id: club.id, name: `Robotics ${fx.tag}` },
      owner: { name: bob.name },
      createdBy: { name: bob.name },
      comments: [{ author: { name: bob.name }, body: "Venue confirmed?", edited: false }],
      olderComments: false,
      url: `http://localhost:3000/app/${club.slug}/tasks/${ids.venue}`,
    });
  });

  it("answers a private task, another org's task, a forged id and another kind as not found", async () => {
    if (!fx) return;
    const { alice, club, other } = fx;
    const session = await fx.session(alice);
    for (const id of [
      itemId("task", club.id, ids.secret),
      itemId("task", other.id, ids.chess),
      // Another org's task under this club's id: the lookup filters on the org.
      itemId("task", club.id, ids.chess),
      itemId("note", club.id, ids.venue),
    ]) {
      await expect(getTask(session, { id })).rejects.toBeInstanceOf(NotFoundError);
    }
    // A malformed id fails the input schema, before any query.
    await expect(getTask(session, { id: "task:not-an-id" })).rejects.toBeInstanceOf(ZodError);
  });
});

describe("through the MCP server", () => {
  it("returns list_tasks and get_task within their output schemas", async () => {
    if (!fx) return;
    const session = await fx.session(fx.alice);
    const list = { space: fx.club.id, status: "any" as const };
    expect(await fx.call(session, "list_tasks", list)).toEqual(
      asJson(await listTasks(session, list)),
    );
    const id = itemId("task", fx.club.id, ids.venue);
    expect(await fx.call(session, "get_task", { id })).toEqual(
      asJson(await getTask(session, { id })),
    );
    await expect(
      fx.call(session, "get_task", { id: itemId("task", fx.club.id, ids.secret) }),
    ).rejects.toThrow(NOT_FOUND_MESSAGE);
  });
});
