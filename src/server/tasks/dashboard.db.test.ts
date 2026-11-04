// @vitest-environment node
// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The status dashboard against the real roles and policies on the local
 * database with the seeded Claude Builders Club (Jackson > Oliver > Alex,
 * Smyan; Jackson > Lucas > Kristine). The seed has tasks of its own, so each
 * check compares the dashboard before and after this file's tasks.
 * Skipped without the database or seed.
 */

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock }));

process.env.EMAIL_DELIVERY = "sink";

import { TaskStatus } from "@/generated/prisma/client";
import { addDaysToKey, localDateKey } from "@/lib/tasks/dates";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";

import { authDb, disconnectAll } from "../db/clients";
import { withOrgAction, withOrgTx, withSystemOrgTx } from "../db/context";
import { getTaskDashboard, type TaskDashboard } from "./dashboard";
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

describe.skipIf(!seeded)("task dashboard against the local database (seeded CBC)", () => {
  const s = seeded!;
  const p = s?.people;
  const created: string[] = [];
  const todayKey = localDateKey(new Date(), NY);
  const team = () => [p.oliver.id, p.alex.id, p.smyan.id];

  const as = (person: Person) => requireUserMock.mockResolvedValue(person);
  const act = <A extends unknown[], R>(fn: (env: svc.TaskEnv, ...args: A) => Promise<R>) =>
    withOrgAction(async (ctx, ...args: A) => fn(await svc.loadTaskEnv(ctx), ...args));

  async function create(by: Person, input: svc.CreateTaskInput): Promise<string> {
    as(by);
    const result = await act(svc.createTask)(s.cbcId, input);
    expect(result.error).toBeUndefined();
    expect(result.confirm).toBeUndefined();
    created.push(result.taskId!);
    return result.taskId!;
  }

  // As the board's My team / Everyone: the scope's people filter the tasks and name the rows.
  function dashboard(peopleIds?: string[]): Promise<TaskDashboard> {
    as(p.oliver);
    return withOrgTx(s.cbcId, ({ db }) =>
      getTaskDashboard(db, s.cbcId, {
        filters: { peopleIds },
        people: peopleIds,
        todayKey,
        now: new Date(),
      }),
    );
  }

  const row = (d: TaskDashboard, userId: string) => d.people.find((r) => r.userId === userId);

  let before: { team: TaskDashboard; club: TaskDashboard };
  let after: { team: TaskDashboard; club: TaskDashboard };
  let ids: { overdue: string; blocked: string; done: string; outside: string };

  beforeAll(async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    before = { team: await dashboard(team()), club: await dashboard() };
    ids = {
      overdue: await create(p.oliver, {
        title: "Dashboard test: overdue",
        ownerId: p.alex.id,
        dueDate: addDaysToKey(todayKey, -3),
      }),
      blocked: await create(p.oliver, {
        title: "Dashboard test: blocked",
        ownerId: p.alex.id,
        status: TaskStatus.BLOCKED,
        blockedReason: "Waiting on the venue",
        // The seeded club requires a due date: far enough off to stay out of "due soon".
        dueDate: addDaysToKey(todayKey, 30),
      }),
      done: await create(p.oliver, {
        title: "Dashboard test: done",
        ownerId: p.smyan.id,
        status: TaskStatus.COMPLETED,
        dueDate: addDaysToKey(todayKey, 30),
      }),
      // Kristine is under Lucas, not Oliver: the club's, not Oliver's team's.
      outside: await create(p.jackson, {
        title: "Dashboard test: another team",
        ownerId: p.kristine.id,
        dueDate: addDaysToKey(todayKey, 2),
      }),
    };
    after = { team: await dashboard(team()), club: await dashboard() };
  });

  afterAll(async () => {
    if (created.length) {
      await withSystemOrgTx(s.cbcId, (ctx) =>
        ctx.db.notification.deleteMany({ where: { taskId: { in: created } } }),
      );
      as(p.jackson);
      await withOrgAction(async (ctx) => {
        await ctx.db.task.deleteMany({ where: { id: { in: created } } });
      })(s.cbcId);
    }
    await disconnectAll();
    await disconnectOwnerDb();
  });

  it("counts the team's open, overdue, blocked and finished tasks", () => {
    const d = (k: "open" | "overdue" | "blocked" | "doneRecently" | "dueSoon") =>
      after.team.totals[k] - before.team.totals[k];
    expect(d("open")).toBe(2);
    expect(d("overdue")).toBe(1);
    expect(d("blocked")).toBe(1);
    expect(d("doneRecently")).toBe(1);
    // Kristine's task is due in two days, but she isn't on Oliver's team.
    expect(d("dueSoon")).toBe(0);
  });

  it("has a row for each person on the team, and nobody from outside it", () => {
    const alex = row(after.team, p.alex.id)!;
    const alexBefore = row(before.team, p.alex.id)!;
    expect(alex.overdue - alexBefore.overdue).toBe(1);
    expect(alex.blocked - alexBefore.blocked).toBe(1);
    expect(row(after.team, p.smyan.id)!.doneRecently).toBe(
      row(before.team, p.smyan.id)!.doneRecently + 1,
    );
    // Oliver leads the team and owns nothing here, but is still listed.
    expect(row(after.team, p.oliver.id)).toBeDefined();
    expect(row(after.team, p.kristine.id)).toBeUndefined();
  });

  it("lists the blocked and overdue tasks under Needs attention", () => {
    const attention = after.team.attention.map((t) => t.id);
    expect(attention).toContain(ids.overdue);
    expect(attention).toContain(ids.blocked);
    expect(attention).not.toContain(ids.done);
  });

  it("covers the whole organization without a team", () => {
    expect(after.club.totals.open - before.club.totals.open).toBe(3);
    expect(after.club.totals.dueSoon - before.club.totals.dueSoon).toBe(1);
    const kristine = row(after.club, p.kristine.id)!;
    const kristineBefore = row(before.club, p.kristine.id);
    expect(kristine.notStarted - (kristineBefore?.notStarted ?? 0)).toBe(1);
  });
});
