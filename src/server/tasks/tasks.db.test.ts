// @vitest-environment node
// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tasks against the real roles and policies on the local database with the
 * seeded Claude Builders Club (the published chart: Jackson > Oliver > Alex,
 * Smyan; Jackson > Lucas > Kristine). Covers the checked assignment path
 * (hand-down classification, flags, the edit matrix and the self-assign
 * carve-out as a MEMBER), reminder idempotency (a MEMBER's due-date edit
 * never cancels; superseded jobs no-op; one send per key), digest
 * idempotency and the hourly trigger. Skipped without the database or seed.
 */

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock }));

process.env.EMAIL_DELIVERY = "sink";

import { NotificationType, TaskStatus, TaskVisibility } from "@/generated/prisma/client";
import { addDaysToKey, localDateKey, zonedInstant } from "@/lib/tasks/dates";
import { mentionToken } from "@/lib/tasks/mentions";

import { authDb, disconnectAll } from "../db/clients";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";
import { withOrgAction, withSystemOrgTx, type SystemContext } from "../db/context";
import type { JobRun } from "../jobs/types";
import { renderTaskNotificationEmail } from "./email";
import { taskDigestJob, taskReminderJob } from "./jobs";
import { reminderKey } from "./reminders";
import { nextOccurrence, scheduleOrgTaskJobs } from "./schedule";
import * as svc from "./service";

interface Person {
  id: string;
  email: string;
  name: string | null;
}
type Key = "jackson" | "oliver" | "alex" | "kristine" | "smyan";

let seeded: { cbcId: string; people: Record<Key, Person> } | null = null;
try {
  const cbc = await ownerDb.organization.findUnique({
    where: { slug: "claude-builders-club" },
    select: { id: true },
  });
  const users = await authDb.user.findMany({
    where: {
      email: {
        in: ["jackson", "oliver", "alex", "kristine", "smyan"].map((k) => `${k}@example.edu`),
      },
    },
    select: { id: true, email: true, name: true },
  });
  const byKey = Object.fromEntries(users.map((u) => [u.email.split("@")[0], u])) as Record<
    Key,
    Person
  >;
  if (cbc && users.length === 5) seeded = { cbcId: cbc.id, people: byKey };
} catch {
  seeded = null;
}

const NY = "America/New_York";

describe.skipIf(!seeded)("tasks against the local database (seeded CBC)", () => {
  const s = seeded!;
  const p = s?.people;
  const created: string[] = [];
  const due = (days: number) => addDaysToKey(localDateKey(new Date(), NY), days);

  function as(person: Person) {
    requireUserMock.mockResolvedValue(person);
  }
  const act = <A extends unknown[], R>(fn: (env: svc.TaskEnv, ...args: A) => Promise<R>) =>
    withOrgAction(async (ctx, ...args: A) => fn(await svc.loadTaskEnv(ctx), ...args));

  async function create(input: svc.CreateTaskInput): Promise<string> {
    const result = await act(svc.createTask)(s.cbcId, input);
    expect(result.error).toBeUndefined();
    expect(result.confirm).toBeUndefined();
    created.push(result.taskId!);
    return result.taskId!;
  }

  function run<P>(payload: P): JobRun<P> {
    return {
      id: "test",
      kind: "test",
      organizationId: s.cbcId,
      payload,
      dedupeKey: "test",
      attempt: 1,
      maxAttempts: 8,
      signal: new AbortController().signal,
      deadline: Date.now() + 20_000,
    };
  }

  const read = <T>(fn: (ctx: SystemContext) => Promise<T>) => withSystemOrgTx(s.cbcId, fn);

  beforeAll(() => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
  });
  beforeEach(() => as(p.oliver));
  afterAll(async () => {
    if (created.length) {
      await withSystemOrgTx(s.cbcId, (ctx) =>
        ctx.db.notification.deleteMany({ where: { taskId: { in: created } } }),
      );
      as(p.jackson);
      await withOrgAction(async (ctx) => {
        await ctx.db.task.deleteMany({ where: { parentTaskId: { in: created } } });
        await ctx.db.task.deleteMany({ where: { id: { in: created } } });
      })(s.cbcId);
    }
    await disconnectAll();
    await disconnectOwnerDb();
  });

  it("hands a task down: Oliver to Alex is DOWN_LINE, emails Alex and schedules his reminder", async () => {
    const id = await create({ title: "B6 test: hand down", ownerId: p.alex.id, dueDate: due(10) });
    const state = await read(async ({ db }) => ({
      task: await db.task.findUnique({
        where: { id },
        select: { ownerRelation: true, ownerFlagged: true },
      }),
      notes: await db.notification.findMany({
        where: { taskId: id },
        select: { userId: true, type: true, linkUrl: true },
      }),
      job: await db.job.findFirst({
        where: { dedupeKey: `task-reminder:${reminderKey(id, due(10), p.alex.id)}` },
        select: { status: true, runAt: true },
      }),
    }));
    expect(state.task).toEqual({ ownerRelation: "DOWN_LINE", ownerFlagged: false });
    expect(state.notes).toEqual([
      {
        userId: p.alex.id,
        type: NotificationType.TASK_ASSIGNED,
        linkUrl: `/app/claude-builders-club/tasks/${id}`,
      },
    ]);
    expect(state.job?.status).toBe("PENDING");
    // 09:00 New York, one day before the due date.
    expect(state.job?.runAt.toISOString()).toBe(zonedInstant(due(9), 9, NY).toISOString());
  });

  it("assigning above your level asks first, then saves it flagged and notifies", async () => {
    as(p.alex);
    const input = { title: "B6 test: above", ownerId: p.oliver.id, dueDate: due(10) };
    const first = await act(svc.createTask)(s.cbcId, input);
    expect(first.taskId).toBeUndefined();
    expect(first.confirm?.flagged).toEqual([{ userId: p.oliver.id, name: p.oliver.name }]);

    const id = await create({ ...input, confirmFlagged: true });
    const state = await read(async ({ db }) => ({
      task: await db.task.findUnique({
        where: { id },
        select: { ownerRelation: true, ownerFlagged: true },
      }),
      note: await db.notification.findFirst({
        where: { taskId: id },
        select: { type: true, userId: true },
      }),
    }));
    expect(state.task).toEqual({ ownerRelation: "ABOVE", ownerFlagged: true });
    expect(state.note).toEqual({ type: NotificationType.TASK_FLAGGED, userId: p.oliver.id });

    // Alex (not the flagged person, not an admin) can't acknowledge; Oliver can.
    await expect(act(svc.acknowledgeFlag)(s.cbcId, id, p.oliver.id)).rejects.toThrow(/acknowledge/);
    as(p.oliver);
    await act(svc.acknowledgeFlag)(s.cbcId, id, p.oliver.id);
    const after = await read(({ db }) =>
      db.task.findUnique({ where: { id }, select: { ownerFlagged: true } }),
    );
    expect(after?.ownerFlagged).toBe(false);
  });

  it("a MEMBER outside the task can only add or remove themselves (the carve-out)", async () => {
    const id = await create({
      title: "B6 test: carve-out",
      ownerId: p.oliver.id,
      dueDate: due(12),
    });
    as(p.kristine);
    await expect(act(svc.updateTask)(s.cbcId, id, { title: "Hijacked" })).rejects.toThrow(
      /can't edit/,
    );
    await expect(act(svc.updateTask)(s.cbcId, id, { ownerId: p.kristine.id })).rejects.toThrow();
    await expect(
      act(svc.bulkAssign)(s.cbcId, { taskIds: [id], userId: p.smyan.id }),
    ).rejects.toThrow();
    const joined = await act(svc.selfAssign)(s.cbcId, id, "join");
    expect(joined.error).toBeUndefined();
    const left = await act(svc.selfAssign)(s.cbcId, id, "leave");
    expect(left.error).toBeUndefined();
  });

  it("bulk assign refuses another org's task and writes nothing", async () => {
    const other = await ownerDb.task.findFirst({
      where: { organization: { slug: "robotics-club" } },
      select: { id: true },
    });
    const id = await create({ title: "B6 test: bulk", ownerId: p.oliver.id, dueDate: due(12) });
    await expect(
      act(svc.bulkAssign)(s.cbcId, { taskIds: [id, other!.id], userId: p.alex.id }),
    ).rejects.toThrow(/don't exist in this organization/);
    const task = await read(({ db }) =>
      db.task.findUnique({ where: { id }, select: { ownerId: true } }),
    );
    expect(task?.ownerId).toBe(p.oliver.id);
  });

  it("reminders, as a MEMBER: a due-date edit commits without cancelling, the superseded job no-ops, the new key sends once", async () => {
    as(p.oliver);
    const id = await create({ title: "B6 test: reminders", ownerId: p.alex.id, dueDate: due(10) });
    as(p.alex); // a MEMBER, the owner
    const moved = await act(svc.updateTask)(s.cbcId, id, { dueDate: due(11) });
    expect(moved.error).toBeUndefined();

    const jobs = await read(({ db }) =>
      db.job.findMany({
        where: { dedupeKey: { startsWith: `task-reminder:${id}:` } },
        select: { dedupeKey: true, status: true },
        orderBy: { dedupeKey: "asc" },
      }),
    );
    // Nothing was cancelled from the user path: both keys are still pending.
    expect(jobs.map((j) => j.status)).toEqual(["PENDING", "PENDING"]);

    // The superseded date's job no-ops when it runs.
    const stale = await taskReminderJob(run({ taskId: id, userId: p.alex.id, dueDate: due(10) }));
    expect(stale).toMatchObject({ status: "CANCELLED" });

    // The live key notifies once, even when two drains run it at the same time.
    await Promise.all([
      taskReminderJob(run({ taskId: id, userId: p.alex.id, dueDate: due(11) })),
      taskReminderJob(run({ taskId: id, userId: p.alex.id, dueDate: due(11) })),
    ]);
    const reminders = await read(({ db }) =>
      db.notification.count({ where: { taskId: id, type: NotificationType.TASK_DUE_REMINDER } }),
    );
    expect(reminders).toBe(1);
  });

  it("moving a due date away and back coalesces into the still-pending job", async () => {
    const id = await create({
      title: "B6 test: away and back",
      ownerId: p.alex.id,
      dueDate: due(10),
    });
    const key = `task-reminder:${reminderKey(id, due(10), p.alex.id)}`;
    const before = await read(({ db }) =>
      db.job.findFirst({ where: { dedupeKey: key }, select: { id: true } }),
    );
    await act(svc.updateTask)(s.cbcId, id, { dueDate: due(13) });
    await act(svc.updateTask)(s.cbcId, id, { dueDate: due(10) });
    const after = await read(({ db }) =>
      db.job.findMany({ where: { dedupeKey: key }, select: { id: true, status: true } }),
    );
    expect(after).toEqual([{ id: before!.id, status: "PENDING" }]);
  });

  it("after an owner change the old owner's reminder no-ops; a completed task's reminder no-ops", async () => {
    const id = await create({
      title: "B6 test: owner change",
      ownerId: p.alex.id,
      dueDate: due(10),
    });
    await act(svc.updateTask)(s.cbcId, id, { ownerId: p.smyan.id });
    expect(
      await taskReminderJob(run({ taskId: id, userId: p.alex.id, dueDate: due(10) })),
    ).toMatchObject({
      status: "CANCELLED",
    });
    await act(svc.setTaskStatus)(s.cbcId, id, TaskStatus.COMPLETED);
    expect(
      await taskReminderJob(run({ taskId: id, userId: p.smyan.id, dueDate: due(10) })),
    ).toMatchObject({
      status: "CANCELLED",
    });
  });

  it("subtasks get distinct sibling ranks and are handed down with their own owner", async () => {
    const parent = await create({
      title: "B6 test: parent",
      ownerId: p.oliver.id,
      dueDate: due(14),
    });
    const a = await create({
      title: "B6 test: sub a",
      parentTaskId: parent,
      ownerId: p.alex.id,
      dueDate: due(12),
    });
    const b = await create({
      title: "B6 test: sub b",
      parentTaskId: parent,
      ownerId: p.smyan.id,
      dueDate: due(13),
    });
    const subs = await read(({ db }) =>
      db.task.findMany({
        where: { id: { in: [a, b] } },
        select: { rank: true, ownerRelation: true },
      }),
    );
    expect(new Set(subs.map((x) => x.rank)).size).toBe(2);
    expect(subs.map((x) => x.ownerRelation)).toEqual(["DOWN_LINE", "DOWN_LINE"]);
  });

  it("mentions notify only new, non-self, member mentions", async () => {
    const id = await create({
      title: "B6 test: mentions",
      ownerId: p.oliver.id,
      dueDate: due(12),
      description: `Hi @[Alex](user:${p.alex.id}) and @[Me](user:${p.oliver.id}) and @[Ghost](user:not_a_member)`,
    });
    const first = await read(({ db }) =>
      db.notification.findMany({
        where: { taskId: id, type: NotificationType.TASK_MENTIONED },
        select: { userId: true },
      }),
    );
    expect(first).toEqual([{ userId: p.alex.id }]);
    await act(svc.updateTask)(s.cbcId, id, {
      description: `Hi @[Alex](user:${p.alex.id}) and @[Smyan](user:${p.smyan.id})`,
    });
    const second = await read(({ db }) =>
      db.notification.findMany({
        where: { taskId: id, type: NotificationType.TASK_MENTIONED },
        select: { userId: true },
        orderBy: { createdAt: "asc" },
      }),
    );
    expect(second).toEqual([{ userId: p.alex.id }, { userId: p.smyan.id }]);
  });

  it("the digest records once per local date, however often it runs", async () => {
    // Opt Oliver into the digest for this test, then restore his preferences.
    const original = await authDb.user.findUnique({
      where: { id: p.oliver.id },
      select: { emailPreferences: true },
    });
    await authDb.user.update({
      where: { id: p.oliver.id },
      data: {
        emailPreferences: {
          v: 2,
          types: {},
          digest: { enabled: true, hourLocal: 8 },
          reminderLeadDays: 1,
        },
      },
    });
    try {
      const localDate = "2099-01-15";
      await taskDigestJob(run({ userId: p.oliver.id, localDate }));
      await taskDigestJob(run({ userId: p.oliver.id, localDate }));
      const n = await read(({ db }) =>
        db.notification.findMany({
          where: { userId: p.oliver.id, dedupeKey: `digest:${localDate}` },
          select: { id: true, readAt: true },
        }),
      );
      expect(n).toHaveLength(1);
      expect(n[0]!.readAt).toBeInstanceOf(Date);
      await withSystemOrgTx(s.cbcId, ({ db }) =>
        db.notification.deleteMany({ where: { id: n[0]!.id } }),
      );

      // The hourly trigger enqueues at 08:00 New York and not at 09:00.
      const eight = zonedInstant("2099-03-02", 8, NY);
      const nine = zonedInstant("2099-03-02", 9, NY);
      expect(nextOccurrence(nine, NY, 8, "hourly")).toBeNull();
      expect(nextOccurrence(eight, NY, 8, "hourly")).toEqual({
        dateKey: "2099-03-02",
        runAt: eight,
      });
      const summary = await scheduleOrgTaskJobs(s.cbcId, eight, "hourly");
      expect(summary.digests).toBeGreaterThanOrEqual(1);
      const again = await scheduleOrgTaskJobs(s.cbcId, eight, "hourly");
      expect(again.digests).toBe(summary.digests); // coalesced into the same pending job
      const jobs = await read(({ db }) =>
        db.job.count({
          where: { dedupeKey: `task-digest:${p.oliver.id}:2099-03-02`, status: "PENDING" },
        }),
      );
      expect(jobs).toBe(1);
      expect((await scheduleOrgTaskJobs(s.cbcId, nine, "hourly")).digests).toBe(0);
    } finally {
      await authDb.user.update({
        where: { id: p.oliver.id },
        data: { emailPreferences: original?.emailPreferences ?? {} },
      });
    }
  });

  // ---- C4: task visibility -------------------------------------------------

  it("a private task is invisible to a member outside it, and visible to the people on it", async () => {
    as(p.oliver);
    const id = await create({
      title: "C4 test: private",
      ownerId: p.oliver.id,
      assigneeIds: [p.alex.id],
      dueDate: due(9),
      visibility: TaskVisibility.PRIVATE,
    });

    // RLS is what hides it: read through the request path as each person.
    const seenBy = async (person: Person) => {
      as(person);
      return withOrgAction((ctx) => ctx.db.task.findFirst({ where: { id }, select: { id: true } }))(
        s.cbcId,
      );
    };
    expect(await seenBy(p.oliver)).not.toBeNull(); // owner and creator
    expect(await seenBy(p.alex)).not.toBeNull(); // collaborator
    expect(await seenBy(p.jackson)).not.toBeNull(); // OWNER
    expect(await seenBy(p.kristine)).toBeNull(); // uninvolved MEMBER
    expect(await seenBy(p.smyan)).toBeNull();
  });

  it("a subtask inherits its parent's visibility, and follows when the parent opens up", async () => {
    as(p.oliver);
    const parent = await create({
      title: "C4 test: private parent",
      ownerId: p.oliver.id,
      dueDate: due(9),
      visibility: TaskVisibility.PRIVATE,
    });
    // Asks for ORG on purpose; the service and the database both overrule it.
    const child = await create({
      title: "C4 test: inherited subtask",
      parentTaskId: parent,
      ownerId: p.alex.id,
      visibility: TaskVisibility.ORG,
    });
    const visibilityOf = (taskId: string) =>
      read(({ db }) => db.task.findUnique({ where: { id: taskId }, select: { visibility: true } }));
    expect(await visibilityOf(child)).toEqual({ visibility: TaskVisibility.PRIVATE });

    // Opening the parent cascades to the child.
    const opened = await act(svc.updateTask)(s.cbcId, parent, {
      visibility: TaskVisibility.ORG,
    });
    expect(opened.error).toBeUndefined();
    expect(await visibilityOf(child)).toEqual({ visibility: TaskVisibility.ORG });
  });

  it("only the owner, the creator or an admin flips the flag; a collaborator cannot publish it", async () => {
    as(p.oliver);
    const id = await create({
      title: "C4 test: who may publish",
      ownerId: p.oliver.id,
      assigneeIds: [p.alex.id],
      dueDate: due(9),
      visibility: TaskVisibility.PRIVATE,
    });

    as(p.alex); // a collaborator: may edit, may not publish
    await expect(
      act(svc.updateTask)(s.cbcId, id, { visibility: TaskVisibility.ORG }),
    ).rejects.toThrow(/owner, its creator or an admin/i);

    const titleEdit = await act(svc.updateTask)(s.cbcId, id, { title: "C4 test: still private" });
    expect(titleEdit.error).toBeUndefined();
    expect(
      await read(({ db }) => db.task.findUnique({ where: { id }, select: { visibility: true } })),
    ).toEqual({ visibility: TaskVisibility.PRIVATE });

    as(p.jackson); // an OWNER may
    const byAdmin = await act(svc.updateTask)(s.cbcId, id, { visibility: TaskVisibility.ORG });
    expect(byAdmin.error).toBeUndefined();
  });

  it("a mention on a private task never reaches somebody outside it", async () => {
    as(p.oliver);
    const id = await create({
      title: "C4 test: mention audience",
      ownerId: p.oliver.id,
      assigneeIds: [p.alex.id],
      dueDate: due(9),
      visibility: TaskVisibility.PRIVATE,
    });

    const result = await act(svc.updateTask)(s.cbcId, id, {
      description: `Ping ${mentionToken("Alex Green", p.alex.id)} and ${mentionToken("Kristine Min", p.kristine.id)}`,
    });
    expect(result.error).toBeUndefined();
    // Kristine cannot see the task, so she is reported as dropped...
    expect(result.droppedMentions).toEqual([p.kristine.id]);

    const state = await read(async ({ db }) => ({
      mentioned: (
        await db.taskMention.findMany({ where: { taskId: id }, select: { mentionedUserId: true } })
      ).map((m) => m.mentionedUserId),
      notified: (
        await db.notification.findMany({
          where: { taskId: id, type: NotificationType.TASK_MENTIONED },
          select: { userId: true },
        })
      ).map((n) => n.userId),
    }));
    // ... and no row, no notification and therefore no email exists for her.
    expect(state.mentioned).toEqual([p.alex.id]);
    expect(state.notified).toEqual([p.alex.id]);
  });

  it("making an open task private stops mentioning somebody who is no longer in the audience", async () => {
    as(p.oliver);
    const id = await create({
      title: "C4 test: closing the door",
      ownerId: p.oliver.id,
      dueDate: due(9),
      description: `Heads up ${mentionToken("Kristine Min", p.kristine.id)}`,
    });
    const before = await read(({ db }) => db.taskMention.count({ where: { taskId: id } }));
    expect(before).toBe(1);

    const closed = await act(svc.updateTask)(s.cbcId, id, { visibility: TaskVisibility.PRIVATE });
    expect(closed.error).toBeUndefined();
    expect(closed.droppedMentions).toEqual([p.kristine.id]);
    expect(await read(({ db }) => db.taskMention.count({ where: { taskId: id } }))).toBe(0);
  });

  it("an email already queued is dropped at send time once the task is out of the recipient's reach", async () => {
    // The outbox is the last gate: a notification is written while somebody
    // can see the task, but the drain can run after it went private or
    // after they were taken off it. renderTaskNotificationEmail runs on the
    // service path, which sees the whole org, so it re-checks itself.
    as(p.oliver);
    const id = await create({
      title: "C4 test: the outbox gate",
      ownerId: p.oliver.id,
      assigneeIds: [p.kristine.id],
      dueDate: due(9),
    });
    const notification = {
      userId: p.kristine.id,
      type: NotificationType.TASK_ASSIGNED,
      title: "C4 test: the outbox gate",
      body: null,
      linkUrl: `/app/claude-builders-club/tasks/${id}`,
      taskId: id,
      actorId: p.oliver.id,
      dedupeKey: null,
    };

    // While she is on it, the mail renders and carries the title.
    const open = await renderTaskNotificationEmail(s.cbcId, notification);
    expect(open).not.toBe("skip");
    expect(open).not.toBeNull();
    expect(typeof open === "object" && open?.subject).toContain("C4 test: the outbox gate");

    // Take her off it and make it private: the same queued row now sends nothing.
    await act(svc.updateTask)(s.cbcId, id, {
      assigneeIds: [],
      visibility: TaskVisibility.PRIVATE,
    });
    expect(await renderTaskNotificationEmail(s.cbcId, notification)).toBe("skip");

    // An admin is in the standing audience, so theirs still renders.
    expect(
      await renderTaskNotificationEmail(s.cbcId, { ...notification, userId: p.jackson.id }),
    ).not.toBe("skip");
  });
});
